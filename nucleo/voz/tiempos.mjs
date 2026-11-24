// @ts-check

/** @typedef {import('./audio.mjs').PalabraT} PalabraT */

/**
 * Palabras desde la alineación por carácter de ElevenLabs: cortan los espacios; la puntuación queda
 * pegada a su palabra.
 * @param {any} alineacion @returns {PalabraT[]}
 */
export function palabrasDeCaracteres(alineacion) {
  const letras = Array.isArray(alineacion?.characters) ? alineacion.characters : []
  const inicios = alineacion?.character_start_times_seconds ?? []
  const fines = alineacion?.character_end_times_seconds ?? []
  /** @type {PalabraT[]} */
  const salida = []
  /** @type {PalabraT | null} */
  let actual = null
  letras.forEach((/** @type {string} */ c, /** @type {number} */ k) => {
    if (/\s/.test(c)) {
      actual = null
      return
    }
    const ini = Number(inicios[k]) || 0
    const fin = Number(fines[k]) || ini
    if (!actual) {
      actual = { texto: c, inicio: ini, fin }
      salida.push(actual)
    } else {
      actual.texto += c
      actual.fin = fin
    }
  })
  return salida
}

/**
 * Sin alineación (respaldo Gemini): las palabras de la frase repartidas por largo dentro de la voz.
 * Es aproximado; el que lo usa queda avisado con `tiempos: 'repartidos'`.
 * @param {string} texto @param {{ vozIni: number, vozFin: number }} voz @returns {PalabraT[]}
 */
export function palabrasRepartidas(texto, { vozIni, vozFin }) {
  const tokens = texto.split(/\s+/).filter(Boolean)
  const pesos = tokens.map((t) => Math.max(1, t.replace(/[^\p{L}\p{N}]/gu, '').length) + 1)
  const total = pesos.reduce((a, b) => a + b, 0)
  const largo = Math.max(0, vozFin - vozIni)
  let t = vozIni
  return tokens.map((texto, i) => {
    const d = (largo * (pesos[i] ?? 1)) / total
    const p = { texto, inicio: Math.round(t * 1000) / 1000, fin: Math.round((t + d * 0.92) * 1000) / 1000 }
    t += d
    return p
  })
}
