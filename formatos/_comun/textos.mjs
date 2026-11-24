// @ts-check
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
export const IDIOMAS = /** @type {const} */ (['es-AR', 'en-US'])
/** @type {Map<string, any>} */
const cache = new Map()

/**
 * El diccionario de rótulos fijos de las plantillas (`textos.<idioma>.json`): ningún texto visible
 * se escribe en una plantilla, sale de acá según el idioma de la cuenta.
 * @param {string} idioma
 */
export function textos(idioma) {
  if (!IDIOMAS.includes(/** @type {any} */ (idioma))) throw new Error(`idioma sin textos: ${idioma} (hay ${IDIOMAS.join(', ')})`)
  if (!cache.has(idioma)) cache.set(idioma, JSON.parse(readFileSync(join(AQUI, `textos.${idioma}.json`), 'utf8')))
  return cache.get(idioma)
}

/**
 * Un texto por ruta ("chat.en_linea"). Tira si falta: un rótulo vacío en pantalla es peor que un error.
 * @param {string} idioma @param {string} ruta
 */
export function texto(idioma, ruta) {
  /** @type {any} */
  let v = textos(idioma)
  for (const k of ruta.split('.')) v = v?.[k]
  if (v === undefined || v === null) throw new Error(`falta el texto ${ruta} en textos.${idioma}.json`)
  return v
}
