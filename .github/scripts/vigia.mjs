// @ts-check
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cargarCuenta, listarCuentas } from '../../nucleo/cuenta.mjs'
import { variableActiva } from './matriz.mjs'

/*
  El chequeo diario de mantenimiento.yml: una cuenta prendida cuyo estado no se movió en 26 h es una
  fábrica que dejó de correr (cron desactivado, job roto) aunque nadie lo haya notado. El mismo umbral
  que usa Kairo.
*/

export const VIEJO_H = 26

/**
 * @param {{ cuentas: { id: string, activa: boolean }[], estados: Record<string, { actualizado?: string, pausado?: string | null } | null>,
 *   env: Record<string, string | undefined>, ahora: Date }} p
 * @returns {{ problemas: string[], notas: string[] }}
 */
export function revisar({ cuentas, estados, env, ahora }) {
  /** @type {string[]} */
  const problemas = []
  /** @type {string[]} */
  const notas = []
  for (const c of cuentas) {
    if (!c.activa || env[variableActiva(c.id)] !== '1') continue
    const e = estados[c.id]
    if (!e) {
      notas.push(`${c.id}: prendida y todavía sin estado en la rama estado`)
      continue
    }
    if (e.pausado) notas.push(`${c.id}: pausada (${e.pausado})`)
    const t = Date.parse(e.actualizado ?? '')
    const horas = Number.isFinite(t) ? (ahora.getTime() - t) / 3_600_000 : Infinity
    if (horas > VIEJO_H) problemas.push(`${c.id}: el estado no se actualiza hace ${Number.isFinite(horas) ? `${Math.round(horas)} h` : 'nunca'} (más de ${VIEJO_H} h): la fábrica dejó de correr para esta cuenta`)
  }
  return { problemas, notas }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const raiz = resolve(process.env.GITHUB_WORKSPACE ?? '.')
  const dirEstado = resolve(process.env.FABRICA_ESTADO ?? join(raiz, '.estado'))
  const cuentas = listarCuentas(raiz).map((id) => ({ id, activa: cargarCuenta(id, raiz).activa }))
  /** @type {Record<string, any>} */
  const estados = {}
  for (const { id } of cuentas) {
    const ruta = join(dirEstado, 'cuentas', id, 'estado.json')
    estados[id] = existsSync(ruta) ? JSON.parse(readFileSync(ruta, 'utf8')) : null
  }
  const r = revisar({ cuentas, estados, env: process.env, ahora: new Date() })
  for (const n of r.notas) console.log(`::notice::[fabrica] ${n}`)
  for (const p of r.problemas) console.log(`::error::[fabrica] ${p}`)
  if (r.problemas.length) process.exitCode = 1
}
