// @ts-check
import { palabrasDeCaracteres } from './tiempos.mjs'

export const BASE_ELEVEN = 'https://api.elevenlabs.io'

/** ElevenLabs no puede (sin crédito, sin permiso, saturado o caído): toca el respaldo. */
export class SinEleven extends Error {}

/** @param {number} ms */
export const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Una frase con su alineación. `previous_text`/`next_text` no se cobran y mantienen una sola lectura.
 * @param {{ texto: string, voz: string, modelo: string, ajustes: object, previo?: string, siguiente?: string,
 *   clave: string, fetch: typeof fetch, espera?: (ms: number) => Promise<unknown> }} p
 * @returns {Promise<{ audio: Buffer, palabras: import('./audio.mjs').PalabraT[] }>}
 */
export async function sintetizarEleven({ texto, voz, modelo, ajustes, previo = '', siguiente = '', clave, fetch: f, espera = dormir }) {
  let ultimo = ''
  for (let intento = 0; intento < 3; intento++) {
    /** @type {Response} */
    let r
    try {
      r = await f(`${BASE_ELEVEN}/v1/text-to-speech/${encodeURIComponent(voz)}/with-timestamps?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': clave },
        body: JSON.stringify({
          text: texto,
          model_id: modelo,
          voice_settings: ajustes,
          ...(previo ? { previous_text: previo } : {}),
          ...(siguiente ? { next_text: siguiente } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      })
    } catch (e) {
      ultimo = `sin respuesta (${String(/** @type {Error} */ (e).message).slice(0, 80)})`
      await espera(3000 * (intento + 1))
      continue
    }
    const cuerpo = await r.text()
    if (r.ok) {
      const d = JSON.parse(cuerpo)
      if (!d?.audio_base64) throw new Error('ElevenLabs no devolvió audio')
      return { audio: Buffer.from(d.audio_base64, 'base64'), palabras: palabrasDeCaracteres(d.alignment) }
    }
    let estado = ''
    try {
      estado = String(JSON.parse(cuerpo)?.detail?.status ?? '')
    } catch {
      estado = ''
    }
    ultimo = `HTTP ${r.status}${estado ? ` ${estado}` : ''}`
    if (r.status === 401 || r.status === 402 || /quota|credit|payment/i.test(estado)) throw new SinEleven(`ElevenLabs ${ultimo}`)
    if (r.status === 429 || r.status >= 500) {
      await espera(5000 * (intento + 1))
      continue
    }
    throw new Error(`ElevenLabs ${ultimo}`)
  }
  throw new SinEleven(`ElevenLabs ${ultimo}`)
}

/**
 * Lo que queda del ciclo de la suscripción. null si no se pudo leer (no es 0: no se sabe).
 * @param {{ clave: string, fetch: typeof fetch }} p
 * @returns {Promise<{ quedan: number, usados: number, limite: number, reinicia_at: string | null, plan: string | null } | null>}
 */
export async function leerSuscripcion({ clave, fetch: f }) {
  try {
    const r = await f(`${BASE_ELEVEN}/v1/user/subscription`, { headers: { 'xi-api-key': clave }, signal: AbortSignal.timeout(20_000) })
    if (!r.ok) return null
    const d = await r.json()
    const usados = Number(d?.character_count)
    const limite = Number(d?.character_limit)
    if (!Number.isFinite(usados) || !Number.isFinite(limite)) return null
    const reinicio = Number(d?.next_character_count_reset_unix)
    return {
      quedan: Math.max(0, limite - usados), usados, limite,
      reinicia_at: Number.isFinite(reinicio) && reinicio > 0 ? new Date(reinicio * 1000).toISOString() : null,
      plan: typeof d?.tier === 'string' ? d.tier : null,
    }
  } catch {
    return null
  }
}
