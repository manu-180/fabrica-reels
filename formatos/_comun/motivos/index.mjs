// @ts-check
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))

/**
 * @typedef {{ css: string, fondo: string, hoja: string, profundo: string, luces: string }} Capas
 *   fondo: primero en #root (quieto). hoja: adentro de #riel, viaja con la cámara (mide ≥ 7 pantallas
 *   para cubrir lo que recorre). profundo: adentro de #camara antes de #riel, parallax lento.
 *   luces: después del contenido (viñeta, grano), con z-index 40. Los ids son fijos: las plantillas
 *   animan #riel, #profundo y #hoja.
 */

/**
 * El módulo de un motivo (`motivos/<nombre>.mjs`, que exporta `capas(tema) → Capas`). Si todavía no
 * existe, el fondo de base, para que nunca salga plano.
 * @param {string} nombre
 * @returns {Promise<{ nombre: string, capas: (tema: import('../tema.mjs').Tema) => Capas }>}
 */
export async function motivoDe(nombre) {
  const propio = join(AQUI, `${nombre}.mjs`)
  const ruta = /^[a-z]+$/.test(nombre) && existsSync(propio) ? propio : join(AQUI, 'base.mjs')
  const m = await import(pathToFileURL(ruta).href)
  if (typeof m.capas !== 'function') throw new Error(`el motivo ${nombre} no exporta capas(tema)`)
  return { nombre: ruta === propio ? nombre : 'base', capas: m.capas }
}
