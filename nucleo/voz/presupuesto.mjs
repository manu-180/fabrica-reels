// @ts-check
import { claveDeFrase, crearCacheVoz } from './cache.mjs'
import { leerSuscripcion } from './eleven.mjs'
import { planDeFrases } from './texto.mjs'

/** @param {Date} d */
const mesAR = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit' }).format(d)

/**
 * Lo que queda para pagar voz: del ciclo de ElevenLabs (null si no se pudo leer) y del
 * `presupuesto_mes` de la cuenta (lo pagado por sus creativos en el mes de Buenos Aires).
 * @param {{ cuenta: any, estado: any, env: Record<string, string | undefined>, fetch: typeof fetch, reloj?: () => Date }} p
 * @returns {Promise<{ quedan_ciclo: number | null, quedan_mes_cuenta: number, reinicia_at: string | null, disponible: number | null }>}
 */
export async function presupuesto({ cuenta, estado, env, fetch: f, reloj = () => new Date() }) {
  const clave = env.ELEVENLABS_API_KEY?.trim()
  const sub = clave ? await leerSuscripcion({ clave, fetch: f }) : null
  const mes = mesAR(reloj())
  const pagado = Object.values(estado?.creativos ?? {})
    .filter((c) => typeof c?.fecha === 'string' && c.fecha.startsWith(mes))
    .reduce((a, c) => a + (Number(c?.voz?.caracteres_pagados) || 0), 0)
  const quedan_mes_cuenta = Math.max(0, cuenta.voz.presupuesto_mes - pagado)
  const quedan_ciclo = sub ? sub.quedan : null
  return {
    quedan_ciclo, quedan_mes_cuenta, reinicia_at: sub?.reinicia_at ?? null,
    disponible: quedan_ciclo === null ? null : Math.min(quedan_ciclo, quedan_mes_cuenta),
  }
}

/**
 * Cuántos caracteres de ElevenLabs costaría locutar este hook y cuerpo hoy: sólo las frases que no
 * están en la caché. Hace `head` al Blob, no llama a ElevenLabs.
 * @param {{ cuenta: any, hook: string, cuerpo: string | null, blob: import('./cache.mjs').BlobVoz }} p
 */
export async function costoVoz({ cuenta, hook, cuerpo, blob }) {
  const cache = crearCacheVoz({ blob, cuenta: cuenta.id })
  let total = 0
  let faltan = 0
  for (const fr of planDeFrases({ hook, cuerpo, pausas: cuenta.voz.pausas })) {
    total += fr.texto.length
    if (!(await cache.existe(claveDeFrase(cuenta, fr, 'elevenlabs')))) faltan += fr.texto.length
  }
  return { total, faltan, cacheados: total - faltan }
}

/**
 * Qué guiones se pueden hacer con lo que queda. Primero los que no pagan (cacheados y `chat`), después
 * de menor a mayor costo mientras entren en `disponible` (null = no se pudo leer: se intenta todo y el
 * que no alcance cae al respaldo). Los que no entran quedan para el respaldo o para otro día.
 * @template {{ formato: string, faltan: number }} C
 * @param {{ candidatos: C[], disponible: number | null }} p
 * @returns {{ con_voz: C[], sin_presupuesto: C[], usados: number }}
 */
export function priorizarPorPresupuesto({ candidatos, disponible }) {
  const costo = (/** @type {C} */ c) => (c.formato === 'chat' ? 0 : c.faltan)
  const orden = candidatos.map((c, i) => ({ c, i })).sort((a, b) => costo(a.c) - costo(b.c) || a.i - b.i)
  /** @type {C[]} */
  const con_voz = []
  /** @type {C[]} */
  const sin_presupuesto = []
  let usados = 0
  for (const { c } of orden) {
    if (disponible === null || usados + costo(c) <= disponible) {
      con_voz.push(c)
      usados += costo(c)
    } else sin_presupuesto.push(c)
  }
  return { con_voz, sin_presupuesto, usados }
}
