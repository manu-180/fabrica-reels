// @ts-check

/** @typedef {{ fondo: string, superficie: string, tinta: string, tenue: string, acento: string }} Base */

/**
 * Los únicos colores escritos en código: casi negro y blanco para tinta sobre un color, y los dos
 * neutros del resaltador cuando el acento no da contraste. No son de ninguna marca; el test de
 * neutralidad los deja pasar por nombre.
 */
export const NEUTROS = Object.freeze({ negro: '#0c0c0e', blanco: '#ffffff', claro: '#f5f3ee', oscuro: '#141210' })

/** @param {string} hex @returns {[number, number, number]} */
export function rgb(hex) {
  const h = String(hex).replace('#', '')
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** @param {number[]} c */
const aHex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')

/** Luminancia relativa WCAG. @param {string} hex */
export function luminancia(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * /** @type {number} */ (r) + 0.7152 * /** @type {number} */ (g) + 0.0722 * /** @type {number} */ (b)
}

/** @param {string} a @param {string} b */
export function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m)
  return (/** @type {number} */ (x) + 0.05) / (/** @type {number} */ (y) + 0.05)
}

/** @param {string} hex @param {number} alfa */
export function rgba(hex, alfa) {
  const [r, g, b] = rgb(hex)
  return `rgba(${r},${g},${b},${alfa})`
}

/** @param {string} a @param {string} b @param {number} t 0 = a, 1 = b */
export function mezclar(a, b, t) {
  const x = rgb(a)
  const y = rgb(b)
  return aHex(x.map((v, i) => v + (/** @type {number} */ (y[i]) - v) * t))
}

/** La tinta (casi negro o blanco) que más contrasta sobre un color. @param {string} hex */
export function tintaSobre(hex) {
  return contraste(hex, NEUTROS.blanco) >= contraste(hex, NEUTROS.negro) ? NEUTROS.blanco : NEUTROS.negro
}

/** Tono HSL en grados. @param {string} hex */
export function tono(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255)
  const R = /** @type {number} */ (r), G = /** @type {number} */ (g), B = /** @type {number} */ (b)
  const max = Math.max(R, G, B)
  const d = max - Math.min(R, G, B)
  if (d === 0) return 0
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return (h * 60 + 360) % 360
}

/** Aclara (o oscurece, si `hacia` es oscuro) hasta separarse de `fondo` 4,5:1. @param {string} hex @param {string} fondo */
export function separarDe(hex, fondo) {
  const hacia = luminancia(fondo) < 0.25 ? NEUTROS.blanco : NEUTROS.negro
  let c = hex
  for (let k = 0; k < 14 && contraste(c, fondo) < 4.5; k++) c = mezclar(c, hacia, 0.18)
  return c
}

/**
 * Resaltador de la palabra activa (skill `subtitulos-premium` § 4): el acento si tiene saturación
 * ≥ 0,3, luminosidad 0,22 a 0,82, ≥ 4,5:1 con su tinta y ≥ 3:1 contra el fondo; si no, el neutro del tono.
 * @param {Base} p
 */
export function resalteDe(p) {
  const oscura = luminancia(p.fondo) < 0.25
  const neutro = oscura ? { fondo: NEUTROS.claro, tinta: NEUTROS.negro } : { fondo: NEUTROS.oscuro, tinta: NEUTROS.blanco }
  const [r, g, b] = rgb(p.acento).map((c) => c / 255)
  const max = Math.max(/** @type {number} */ (r), /** @type {number} */ (g), /** @type {number} */ (b))
  const min = Math.min(/** @type {number} */ (r), /** @type {number} */ (g), /** @type {number} */ (b))
  const l = (max + min) / 2
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
  if (s < 0.3 || l < 0.22 || l > 0.82) return neutro
  const tinta = tintaSobre(p.acento)
  if (contraste(p.acento, tinta) < 4.5 || contraste(p.acento, p.fondo) < 3) return neutro
  return { fondo: p.acento.toLowerCase(), tinta }
}

/** Lo que se deriva de una paleta (el tono del subtítulo, el resaltador, la tinta sobre el acento). @param {Base} p */
export function derivar(p) {
  const oscura = luminancia(p.fondo) < 0.25
  return {
    oscura,
    tono: /** @type {'claro' | 'oscuro'} */ (oscura ? 'oscuro' : 'claro'),
    sobreAcento: tintaSobre(p.acento),
    resalte: resalteDe(p),
    // El acento como texto o trazo fino: si no separa 3:1 del fondo y de la superficie, la tinta.
    acentoTexto: contraste(p.acento, p.superficie) >= 3 && contraste(p.acento, p.fondo) >= 3 ? p.acento : p.tinta,
  }
}
