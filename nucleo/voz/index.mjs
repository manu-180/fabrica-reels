// @ts-check
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FRECUENCIA, acortarSilencios, bordesDeVoz, decodificarAudio, pcmAWav, unirTramos } from './audio.mjs'
import { claveDeFrase, crearCacheVoz } from './cache.mjs'
import { SinEleven, dormir, leerSuscripcion, sintetizarEleven } from './eleven.mjs'
import { sintetizarGemini } from './gemini.mjs'
import { palabrasRepartidas } from './tiempos.mjs'
import { pausasCompletas, planDeFrases } from './texto.mjs'

export { claveVoz, blobEnMemoria } from './cache.mjs'
export { presupuesto, costoVoz, priorizarPorPresupuesto } from './presupuesto.mjs'
export { blobVercel } from './blob.mjs'

/** No hay voz posible sin pasarse (o sin respaldo permitido): el creativo queda para otro día. */
export class SinPresupuesto extends Error {}

/** @typedef {{ texto: string, inicio_s: number, fin_s: number }} Palabra */

/**
 * Hook + cuerpo locutados frase por frase con la voz de la cuenta y unidos con las pausas de la
 * cuenta. Cada frase pasa por la caché del Blob antes de pedirse: una frase ya pagada no se vuelve a
 * pagar. Si ElevenLabs no alcanza o falla, toda la locución sale con el respaldo Gemini (mezclar dos
 * voces en un reel suena roto), y queda anotado en `respaldo`.
 *
 * `quedan`: caracteres que se pueden gastar (de `presupuesto`); sin pasarlo se lee la suscripción,
 * pero sólo si falta pagar algo. `respaldo: false` prohíbe Gemini (la prueba y la normal de APEX).
 * @param {{ cuenta: any, hook: string, cuerpo: string | null, env?: Record<string, string | undefined>, fetch?: typeof fetch,
 *   blob: import('./cache.mjs').BlobVoz, log?: (m: string) => void, dir?: string, quedan?: number | null, respaldo?: boolean,
 *   decodificar?: (audio: Buffer) => Promise<Int16Array>, espera?: (ms: number) => Promise<unknown>, reloj?: () => Date }} p
 * @returns {Promise<{ wav: string, duracion_s: number, palabras: Palabra[], proveedor: string, caracteres_pagados: number,
 *   caracteres_cache: number, caracteres_respaldo: number, respaldo: string | null, tiempos: 'elevenlabs' | 'repartidos' }>}
 */
export async function locutar({
  cuenta, hook, cuerpo, env = process.env, fetch: f = fetch, blob, log = () => {}, dir, quedan, respaldo = true,
  decodificar = decodificarAudio, espera = dormir, reloj = () => new Date(),
}) {
  const v = cuenta.voz
  const frases = planDeFrases({ hook, cuerpo, pausas: v.pausas })
  if (!frases.length) throw new Error('no hay texto para locutar')
  const cache = crearCacheVoz({ blob, cuenta: cuenta.id })
  const puedeRespaldo = respaldo && Boolean(v.respaldo)

  /** @type {string | null} */
  let motivo = null
  /** @type {'elevenlabs' | 'gemini'} */
  let usar = v.proveedor === 'gemini' ? 'gemini' : 'elevenlabs'
  if (usar === 'elevenlabs') {
    const claves = frases.map((fr) => claveDeFrase(cuenta, fr, 'elevenlabs'))
    const enCache = await Promise.all(claves.map((h) => cache.existe(h)))
    const faltan = frases.reduce((a, fr, i) => a + (enCache[i] ? 0 : fr.texto.length), 0)
    if (faltan > 0) {
      const clave = env.ELEVENLABS_API_KEY?.trim()
      if (!clave) motivo = 'falta ELEVENLABS_API_KEY'
      else {
        const q = quedan !== undefined ? quedan : (await leerSuscripcion({ clave, fetch: f }))?.quedan ?? null
        if (q !== null && faltan > q) motivo = `ElevenLabs no alcanza: faltan ${faltan} caracteres y quedan ${q}`
      }
    }
    if (motivo) {
      if (!puedeRespaldo) throw new SinPresupuesto(motivo)
      usar = 'gemini'
    }
  }

  const entrada = { cuenta, frases, cache, env, fetch: f, decodificar, espera, reloj }
  /** @type {Awaited<ReturnType<typeof tramosCon>>} */
  let r
  try {
    r = await tramosCon({ ...entrada, proveedor: usar })
  } catch (e) {
    if (!(e instanceof SinEleven)) throw e
    motivo = e.message
    if (!puedeRespaldo) throw new SinPresupuesto(motivo)
    const pagadoAntes = /** @type {any} */ (e).pagados ?? 0
    usar = 'gemini'
    r = await tramosCon({ ...entrada, proveedor: usar })
    r.pagados += pagadoAntes
  }
  if (motivo) log(`${motivo}: voz de respaldo con Gemini`)

  const p = pausasCompletas(v.pausas)
  const u = acortarSilencios(unirTramos(r.tramos), Math.max(p.tras_hook, p.entre, p.pregunta, p.antes_cta) + 0.05)
  const huella = createHash('sha256').update(r.claves.join('|')).digest('hex').slice(0, 16)
  const carpeta = dir ?? mkdtempSync(join(tmpdir(), 'voz-'))
  const wav = join(carpeta, `voz-${huella}.wav`)
  writeFileSync(wav, pcmAWav(u.pcm))
  return {
    wav,
    duracion_s: Math.round((u.pcm.length / FRECUENCIA) * 1000) / 1000,
    palabras: u.palabras.map((w) => ({ texto: w.texto, inicio_s: w.inicio, fin_s: w.fin })),
    proveedor: usar,
    caracteres_pagados: r.pagados,
    caracteres_cache: r.cacheados,
    caracteres_respaldo: usar === 'gemini' ? r.respaldo : 0,
    respaldo: motivo,
    tiempos: usar === 'elevenlabs' ? 'elevenlabs' : 'repartidos',
  }
}

/**
 * Cada frase como tramo PCM, de la caché o pedida al proveedor (y guardada). Si ElevenLabs corta a
 * mitad de camino, el error lleva cuántos caracteres ya se pagaron: esos quedan en la caché igual.
 * @param {{ cuenta: any, frases: import('./texto.mjs').Frase[], cache: ReturnType<typeof crearCacheVoz>, proveedor: 'elevenlabs' | 'gemini',
 *   env: Record<string, string | undefined>, fetch: typeof fetch, decodificar: (a: Buffer) => Promise<Int16Array>, espera: (ms: number) => Promise<unknown>, reloj: () => Date }} p
 */
async function tramosCon({ cuenta, frases, cache, proveedor, env, fetch: f, decodificar, espera, reloj }) {
  const v = cuenta.voz
  /** @type {{ pcm: Int16Array, palabras: import('./audio.mjs').PalabraT[], pausa: number }[]} */
  const tramos = []
  /** @type {string[]} */
  const claves = []
  let pagados = 0
  let cacheados = 0
  let respaldo = 0
  for (const fr of frases) {
    const h = claveDeFrase(cuenta, fr, proveedor)
    claves.push(h)
    const guardado = await cache.leer(h)
    if (guardado) {
      if (proveedor === 'elevenlabs') cacheados += fr.texto.length
      tramos.push({ pcm: await decodificar(guardado.audio), palabras: guardado.entrada.palabras, pausa: fr.pausa })
      continue
    }
    /** @type {Buffer} */
    let audio
    /** @type {import('./audio.mjs').PalabraT[] | null} */
    let palabras = null
    if (proveedor === 'elevenlabs') {
      try {
        const s = await sintetizarEleven({
          texto: fr.texto, voz: v.voice_id, modelo: v.modelo, ajustes: v.ajustes, previo: fr.previo, siguiente: fr.siguiente,
          clave: String(env.ELEVENLABS_API_KEY ?? '').trim(), fetch: f, espera,
        })
        audio = s.audio
        palabras = s.palabras
      } catch (e) {
        if (e instanceof SinEleven) Object.assign(e, { pagados })
        throw e
      }
      pagados += fr.texto.length
    } else {
      audio = await sintetizarGemini({ texto: fr.texto, voz: v.respaldo.voz, estilo: v.respaldo.estilo, clave: env.GEMINI_API_KEY?.trim(), fetch: f, espera })
      respaldo += fr.texto.length
    }
    const pcm = await decodificar(audio)
    const b = bordesDeVoz(pcm, palabras?.length ? { inicio: palabras[0]?.inicio ?? 0, fin: palabras.at(-1)?.fin ?? 0 } : null)
    const finales = palabras?.length ? palabras : palabrasRepartidas(fr.texto, b)
    await cache.guardar(h, audio, {
      texto: fr.texto, proveedor, formato: proveedor === 'elevenlabs' ? 'mp3' : 'wav', duracion_s: pcm.length / FRECUENCIA,
      palabras: finales, bordes: { inicio_s: b.inicio, fin_s: b.fin }, caracteres: fr.texto.length, creado_at: reloj().toISOString(),
    })
    tramos.push({ pcm, palabras: finales, pausa: fr.pausa })
  }
  return { tramos, claves, pagados, cacheados, respaldo }
}
