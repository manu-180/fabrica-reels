// @ts-check
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cargarCuenta, listarCuentas } from '../../nucleo/cuenta.mjs'

/*
  Entre `correr.mjs planear` y los jobs de fabrica.yml. Parte la matriz en producir y publicar (cada una
  con su cola de concurrencia), deja afuera las cuentas sin su variable FABRICA_ACTIVA_<ID>=1 y le suma
  a cada cuenta los nombres de sus secretos de Instagram, que el job usa con secrets[nombre].
*/

export const FIXTURES = 'nucleo/__fixtures__'

/** @param {string} id */
export const variableActiva = (id) => `FABRICA_ACTIVA_${id.toUpperCase().replace(/-/g, '_')}`

/**
 * Dónde vive la cuenta: `.` (cuentas/) o la de prueba de los fixtures, que sólo corre en dry_run.
 * @param {string} raizRepo @param {string} id @returns {string | null}
 */
export function raizDe(raizRepo, id) {
  if (existsSync(join(raizRepo, 'cuentas', id, 'cuenta.json'))) return '.'
  if (existsSync(join(raizRepo, FIXTURES, 'cuentas', id, 'cuenta.json'))) return FIXTURES
  return null
}

/**
 * @typedef {{ cuenta: string, producir: boolean, publicar: boolean, medir: boolean }} Plan
 * @typedef {Plan & { raiz: string, ig_user: string, ig_token: string, ig_insights: string }} Fila
 */

/**
 * @param {{ planes: Plan[] | null, ids: string[], dry: boolean, esMain: boolean, env: Record<string, string | undefined>,
 *   raizDe: (id: string) => string | null, secretosDe: (id: string, raiz: string) => { ig_user: string, ig_token: string, ig_insights?: string | null } }} p
 * @returns {{ producir: Fila[], publicar: Fila[], avisos: string[], errores: string[] }}
 */
export function partir({ planes, ids, dry, esMain, env, raizDe, secretosDe }) {
  /** @type {string[]} */
  const avisos = []
  /** @type {string[]} */
  const errores = []
  /** @type {Fila[]} */
  const filas = []
  const fila = (/** @type {Plan} */ p, /** @type {string} */ raiz) => {
    const s = secretosDe(p.cuenta, raiz)
    filas.push({ ...p, raiz, ig_user: s.ig_user, ig_token: s.ig_token, ig_insights: s.ig_insights ?? '' })
  }
  if (dry) {
    for (const id of ids) {
      const raiz = raizDe(id)
      if (!raiz) errores.push(`no existe la cuenta ${id} (ni en cuentas/ ni en ${FIXTURES}/cuentas/)`)
      else fila({ cuenta: id, producir: true, publicar: false, medir: false }, raiz)
    }
  } else if (!esMain) {
    avisos.push('fuera de main sólo corre dry_run: producir y publicar se lanzan desde main')
  } else {
    for (const p of planes ?? []) {
      const raiz = raizDe(p.cuenta)
      if (raiz !== '.') {
        errores.push(`${p.cuenta} es una cuenta de prueba: sólo corre con dry_run`)
        continue
      }
      if (env[variableActiva(p.cuenta)] !== '1') {
        avisos.push(`${p.cuenta} apagada: falta la variable del repo ${variableActiva(p.cuenta)}=1`)
        continue
      }
      fila(p, raiz)
    }
  }
  return { producir: filas.filter((f) => f.producir), publicar: filas.filter((f) => f.publicar || f.medir), avisos, errores }
}

/** @param {string} texto @returns {Plan[]} */
export function leerPlan(texto) {
  const linea = texto.split('\n').find((l) => l.startsWith('matriz='))
  if (!linea) throw new Error('planear no escribió la matriz')
  return JSON.parse(linea.slice('matriz='.length)).include
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const env = process.env
  const raizRepo = resolve(env.GITHUB_WORKSPACE ?? '.')
  const dry = env.DRY_RUN === 'true'
  const pedida = env.CUENTA?.trim() || null
  /** @type {Plan[] | null} */
  let planes = null
  if (!dry) {
    const archivo = env.PLAN ?? ''
    planes = existsSync(archivo) ? leerPlan(readFileSync(archivo, 'utf8')) : []
  }
  const r = partir({
    planes,
    ids: pedida ? [pedida] : listarCuentas(raizRepo),
    dry,
    esMain: env.GITHUB_REF === 'refs/heads/main',
    env,
    raizDe: (id) => raizDe(raizRepo, id),
    secretosDe: (id, raiz) => cargarCuenta(id, join(raizRepo, raiz)).secretos,
  })
  for (const a of r.avisos) console.log(`::notice::[fabrica] ${a}`)
  for (const e of r.errores) console.log(`::error::[fabrica] ${e}`)
  const matriz = (/** @type {Fila[]} */ f) => JSON.stringify({ include: f })
  const salida = [`producir=${matriz(r.producir)}`, `publicar=${matriz(r.publicar)}`, `hay_producir=${r.producir.length > 0}`, `hay_publicar=${r.publicar.length > 0}`].join('\n')
  if (env.GITHUB_OUTPUT) writeFileSync(env.GITHUB_OUTPUT, `${salida}\n`, { flag: 'a' })
  else console.log(salida)
  if (r.errores.length) process.exitCode = 1
}
