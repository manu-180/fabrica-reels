// @ts-check
import { createHash } from 'node:crypto'
import { normalizarTexto } from './texto.mjs'

/**
 * Lo que la caché necesita del Blob. `head` devuelve null si no existe; `get`, los bytes o null.
 * @typedef {{
 *   head: (ruta: string) => Promise<{ url: string } | null>,
 *   get: (ruta: string) => Promise<Buffer | null>,
 *   put: (ruta: string, cuerpo: Buffer | string, opciones: { contentType: string }) => Promise<{ url: string }>,
 * }} BlobVoz
 */

/**
 * @typedef {{ texto: string, proveedor: string, formato: 'mp3' | 'wav', duracion_s: number,
 *   palabras: { texto: string, inicio: number, fin: number }[], bordes: { inicio_s: number, fin_s: number },
 *   caracteres: number, creado_at: string }} EntradaVoz
 */

/** @param {unknown} v @returns {unknown} */
function canonico(v) {
  if (Array.isArray(v)) return v.map(canonico)
  if (v && typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const salida = {}
    for (const k of Object.keys(v).sort()) {
      const x = /** @type {Record<string, unknown>} */ (v)[k]
      if (x !== undefined) salida[k] = canonico(x)
    }
    return salida
  }
  return v
}

/**
 * sha256 hex del JSON canónico (claves ordenadas); los textos normalizados (NFC, trim, espacios simples).
 * @param {{ proveedor: string, modelo: string, voice_id: string, ajustes: object, pausas: object, texto: string, previo?: string, siguiente?: string }} p
 */
export function claveVoz({ proveedor, modelo, voice_id, ajustes, pausas, texto, previo = '', siguiente = '' }) {
  const datos = canonico({
    proveedor, modelo, voice_id, ajustes, pausas,
    texto: normalizarTexto(texto), previo: normalizarTexto(previo), siguiente: normalizarTexto(siguiente),
  })
  return createHash('sha256').update(JSON.stringify(datos)).digest('hex')
}

/**
 * La clave de una frase para la voz de la cuenta (o su respaldo Gemini, que nunca comparte clave).
 * @param {{ voz: { modelo: string, voice_id: string | null, ajustes: object, pausas: object, respaldo: { voz: string, estilo: string } | null } }} cuenta
 * @param {{ texto: string, previo: string, siguiente: string }} frase @param {'elevenlabs' | 'gemini'} proveedor
 */
export function claveDeFrase(cuenta, frase, proveedor) {
  const v = cuenta.voz
  if (proveedor === 'gemini') {
    if (!v.respaldo) throw new Error('la cuenta no tiene voz de respaldo')
    return claveVoz({ proveedor, modelo: 'gemini-tts', voice_id: v.respaldo.voz, ajustes: { estilo: v.respaldo.estilo }, pausas: v.pausas, ...frase })
  }
  if (!v.voice_id) throw new Error('la cuenta no tiene voice_id (falta la audición)')
  return claveVoz({ proveedor, modelo: v.modelo, voice_id: v.voice_id, ajustes: v.ajustes, pausas: v.pausas, ...frase })
}

/**
 * Caché de frases en Blob: `voz/<cuenta>/<hash>.json` (tiempos y bordes) y el audio al lado.
 * El json se escribe después del audio: si existe, el audio también.
 * @param {{ blob: BlobVoz, cuenta: string }} p
 */
export function crearCacheVoz({ blob, cuenta }) {
  const base = (/** @type {string} */ hash) => `voz/${cuenta}/${hash}`
  return {
    /** @param {string} hash */
    async existe(hash) {
      return Boolean(await blob.head(`${base(hash)}.json`))
    },
    /** @param {string} hash @returns {Promise<{ entrada: EntradaVoz, audio: Buffer } | null>} */
    async leer(hash) {
      const json = await blob.get(`${base(hash)}.json`)
      if (!json) return null
      /** @type {EntradaVoz} */
      const entrada = JSON.parse(json.toString('utf8'))
      const audio = await blob.get(`${base(hash)}.${entrada.formato}`)
      return audio ? { entrada, audio } : null
    },
    /** @param {string} hash @param {Buffer} audio @param {EntradaVoz} entrada */
    async guardar(hash, audio, entrada) {
      await blob.put(`${base(hash)}.${entrada.formato}`, audio, { contentType: entrada.formato === 'mp3' ? 'audio/mpeg' : 'audio/wav' })
      await blob.put(`${base(hash)}.json`, JSON.stringify(entrada), { contentType: 'application/json' })
    },
  }
}

/** Blob en memoria para tests y corridas `--seco`. @returns {BlobVoz & { archivos: Map<string, Buffer> }} */
export function blobEnMemoria() {
  /** @type {Map<string, Buffer>} */
  const archivos = new Map()
  return {
    archivos,
    async head(ruta) {
      return archivos.has(ruta) ? { url: `memoria://${ruta}` } : null
    },
    async get(ruta) {
      return archivos.get(ruta) ?? null
    },
    async put(ruta, cuerpo) {
      archivos.set(ruta, Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo))
      return { url: `memoria://${ruta}` }
    },
  }
}
