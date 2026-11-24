// @ts-check

/** @typedef {{ tras_hook: number, entre: number, antes_cta: number, coma: number, pregunta?: number, cola?: number }} Pausas */
/** @typedef {{ texto: string, previo: string, siguiente: string, pausa: number, parte: 'hook' | 'cuerpo' }} Frase */

/** NFC, sin espacios de más. @param {string} t */
export const normalizarTexto = (t) => String(t ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()

/** @param {string} t */
const contarPalabras = (t) => t.split(' ').filter(Boolean).length

/**
 * Oraciones con su puntuación. Una de menos de 3 palabras se pega a la anterior: sola suena cortada.
 * @param {string} texto @returns {string[]}
 */
export function partirOraciones(texto) {
  const crudas = normalizarTexto(texto).split(/(?<=[.!?…])\s+(?=[¿¡"“]?[\p{Lu}\p{N}])/u)
  /** @type {string[]} */
  const salida = []
  for (const o of crudas) {
    if (!o) continue
    if (salida.length && contarPalabras(o) < 3) salida[salida.length - 1] += ` ${o}`
    else salida.push(o)
  }
  return salida
}

/** @param {Pausas} p */
export const pausasCompletas = (p) => ({ pregunta: p.entre + 0.05, cola: 0.5, ...p })

/**
 * Silencio después de la oración i de n del cuerpo: la última deja la cola, la anterior al cierre
 * respira más (es donde entra el CTA), una pregunta un poco más que una afirmación.
 * @param {number} i @param {number} n @param {string} oracion @param {Required<Pausas>} p
 */
export function pausaTras(i, n, oracion, p) {
  if (i === n - 1) return p.cola
  if (i === n - 2) return p.antes_cta
  return /\?$/.test(oracion.trim()) ? p.pregunta : p.entre
}

/**
 * Frases de un texto: cada oración y, adentro, sus comas cuando a los dos lados quedan 3 palabras o más.
 * `ultima` es el silencio tras la última frase; el de las demás lo da `tras`.
 * @param {string} texto @param {Required<Pausas>} p @param {(i: number, n: number, oracion: string) => number} tras
 */
function frasesDe(texto, p, tras) {
  const oraciones = partirOraciones(texto)
  /** @type {{ texto: string, pausa: number }[]} */
  const frases = []
  oraciones.forEach((o, i) => {
    /** @type {string[]} */
    const juntas = []
    for (const parte of o.split(/(?<=,)\s+/u)) {
      const previa = juntas[juntas.length - 1]
      if (previa !== undefined && (contarPalabras(previa) < 3 || contarPalabras(parte) < 3)) juntas[juntas.length - 1] = `${previa} ${parte}`
      else juntas.push(parte)
    }
    juntas.forEach((t, k) => frases.push({ texto: t, pausa: k < juntas.length - 1 ? p.coma : tras(i, oraciones.length, o) }))
  })
  return frases
}

/**
 * Lo que se sintetiza, frase por frase, con el contexto que recibe ElevenLabs.
 * El cuerpo no ve al hook en su `previo`: así su clave de caché es la misma con cualquier hook y las
 * variantes de APEX (mismo cuerpo, hooks distintos) pagan el cuerpo una sola vez.
 * @param {{ hook: string, cuerpo: string | null, pausas: Pausas }} p @returns {Frase[]}
 */
export function planDeFrases({ hook, cuerpo, pausas }) {
  const p = pausasCompletas(pausas)
  const delCuerpo = cuerpo ? frasesDe(cuerpo, p, (i, n, o) => pausaTras(i, n, o, p)) : []
  const delHook = normalizarTexto(hook)
    ? frasesDe(hook, p, (i, n, o) => (i === n - 1 ? (delCuerpo.length ? p.tras_hook : p.cola) : /\?$/.test(o.trim()) ? p.pregunta : p.entre))
    : []
  /** @param {{ texto: string }[]} lista @param {number} i @param {{ texto: string }[]} [despues] */
  const contexto = (lista, i, despues = []) => ({
    previo: lista.slice(Math.max(0, i - 2), i).map((x) => x.texto).join(' '),
    siguiente: [...lista.slice(i + 1), ...despues].slice(0, 2).map((x) => x.texto).join(' '),
  })
  return [
    ...delHook.map((f, i) => ({ ...f, ...contexto(delHook, i, delCuerpo), parte: /** @type {const} */ ('hook') })),
    ...delCuerpo.map((f, i) => ({ ...f, ...contexto(delCuerpo, i), parte: /** @type {const} */ ('cuerpo') })),
  ]
}
