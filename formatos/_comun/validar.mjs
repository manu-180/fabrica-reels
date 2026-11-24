// @ts-check
import { contarPalabras } from './tiempos.mjs'

/** @param {unknown} v @returns {v is string} */
export const esTexto = (v) => typeof v === 'string' && v.trim().length > 0

/**
 * Lo estructural que el formato necesita para armar. Lo de la cuenta (categoría, paleta, palabras
 * de la voz, captions, hechos) lo revisa `nucleo/banco.mjs`; acá no hay nada de una marca.
 * @param {any} g @param {string} formato
 * @returns {string[]}
 */
export function validarBase(g, formato) {
  /** @type {string[]} */
  const p = []
  if (!g || typeof g !== 'object' || Array.isArray(g)) return ['el guion no es un objeto']
  if (g.version !== 1) p.push('version tiene que ser 1')
  if (g.formato !== formato) p.push(`formato es "${g.formato}" y este armador es "${formato}"`)
  if (!Array.isArray(g.hooks) || g.hooks.length !== 3) p.push('hooks: exactamente 3')
  else
    g.hooks.forEach((/** @type {unknown} */ h, /** @type {number} */ i) => {
      if (!esTexto(h)) p.push(`hooks[${i}] vacío`)
      else if (contarPalabras(h) > 8) p.push(`hooks[${i}] tiene ${contarPalabras(h)} palabras (máximo 8)`)
    })
  if (formato === 'chat') {
    if (g.voz !== null) p.push('voz tiene que ser null en chat')
  } else if (!esTexto(g.voz)) p.push('voz: falta el texto locutado')
  if (!g.contenido || typeof g.contenido !== 'object' || Array.isArray(g.contenido)) p.push('contenido: falta el objeto del formato')
  const todo = JSON.stringify([g.hooks, g.voz, g.contenido])
  if (/\$\s?\d|\d\s?(pesos|usd|d[oó]lares|dollars)\b/i.test(todo)) p.push('sin precios: cambian y los reels quedan')
  if (/(^|[^\p{L}])che([^\p{L}]|$)/iu.test(todo)) p.push('aparece "che": voseo natural, sin "che"')
  return p
}

/** La paleta de un guion no se valida acá (es de la cuenta); el diseño la trae en `diseno.paleta`. */
export const ARCHIVO_CLAVE = /^[a-z0-9]+(-[a-z0-9]+)*$/
