// @ts-check
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NEUTROS, derivar, escaparHtml, escribirDatos, layoutDe, lienzo, mezclar, prepararSalida, rellenar, sfxHtml, texto, validarBase } from '../_comun/index.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const PLANTILLAS = { telefono: join(AQUI, 'plantilla', 'telefono.html'), hoja: join(AQUI, 'plantilla', 'hoja.html') }
export const LAYOUTS = /** @type {const} */ (['telefono', 'hoja'])
export const layouts = LAYOUTS.map((id) => ({ id, apto: () => true }))
/** En la hoja el gancho queda solo en pantalla antes de que arranque la charla. */
const INTRO_HOJA = 1.4

// Tiempos de la comedia: lo que tarda en leerse cada mensaje (pedido de Manuel: ≈ 0,9 s + 0,045 s por carácter).
export const LECTURA = { base: 0.9, por_caracter: 0.045 }
export const TOPE_CUERPO_S = 26
const COLA_QUIETA = 0.3

/**
 * Los colores del teléfono, derivados de la paleta del tema. El cuerpo del aparato es el fondo
 * llevado casi a negro: un teléfono de la familia de la paleta, no un negro de catálogo.
 * @param {import('../_comun/tema.mjs').Paleta} p
 */
export function coloresChat(p) {
  const d = derivar(p)
  const oscuro = d.oscura
  return {
    oscuro,
    acento: p.acento,
    acento_tinta: d.sobreAcento,
    acento_texto: d.acentoTexto,
    pantalla: oscuro ? mezclar(p.fondo, NEUTROS.negro, 0.18) : mezclar(p.fondo, p.superficie, 0.2),
    cabecera: p.superficie,
    burbuja: oscuro ? mezclar(p.superficie, p.tinta, 0.07) : p.superficie,
    campo: oscuro ? mezclar(p.superficie, p.tinta, 0.1) : p.superficie,
    teclado: oscuro ? mezclar(p.fondo, p.tinta, 0.04) : mezclar(p.fondo, p.tinta, 0.05),
    tecla: oscuro ? mezclar(p.superficie, p.tinta, 0.1) : p.superficie,
    avatar: mezclar(p.superficie, p.acento, oscuro ? 0.22 : 0.18),
    aparato: mezclar(p.fondo, NEUTROS.negro, oscuro ? 0.6 : 0.92),
    isla: mezclar(p.fondo, NEUTROS.negro, 0.97),
  }
}

/** @param {string} s */
const palabras = (s) => s.trim().split(/\s+/).filter(Boolean)
/** @param {number} x @param {number} a @param {number} b */
const entre = (x, a, b) => Math.min(b, Math.max(a, x))
/** @param {number} x */
const r3 = (x) => Math.round(x * 1000) / 1000


/**
 * Lo común del guion (todas las piezas lo validan igual) + lo propio de chat.
 * @param {any} guion @returns {string[]}
 */
export function validar(guion) {
  const mal = validarBase(guion, 'chat')
  if (!guion || typeof guion !== 'object') return mal
  const c = guion.contenido
  if (!c || typeof c !== 'object') return mal
  if (typeof c.contacto !== 'string' || !c.contacto.trim() || c.contacto.length > 24) mal.push('contenido.contacto: 1 a 24 caracteres')
  if (!Array.isArray(c.mensajes) || c.mensajes.length < 5 || c.mensajes.length > 9) mal.push('contenido.mensajes: 5 a 9')
  else {
    c.mensajes.forEach((/** @type {any} */ m, /** @type {number} */ i) => {
      if (!m || !['ellos', 'yo'].includes(m.de)) mal.push(`mensajes[${i}].de: "ellos" o "yo"`)
      if (!m || typeof m.texto !== 'string' || !m.texto.trim() || m.texto.length > 90) mal.push(`mensajes[${i}].texto: 1 a 90 caracteres`)
    })
    const de = new Set(c.mensajes.map((/** @type {any} */ m) => m?.de))
    if (!de.has('ellos') || !de.has('yo')) mal.push('el chat necesita mensajes de los dos lados')
  }
  if (c.hora !== undefined && !(typeof c.hora === 'string' && /^[0-9]{1,2}:[0-9]{2}$/.test(c.hora))) mal.push('contenido.hora: HH:MM, o sin el campo')
  if (c.remate !== null && (typeof c.remate !== 'string' || !c.remate.trim() || c.remate.length > 60)) mal.push('contenido.remate: 1 a 60 caracteres, o null')


  if (!mal.length) {
    const d = planificar(guion, 0).duracion
    if (d > TOPE_CUERPO_S) mal.push(`el chat dura ${d.toFixed(1)} s y el tope del cuerpo es ${TOPE_CUERPO_S} s: acortá mensajes o sacá alguno`)
  }
  return mal
}

/**
 * Los tiempos de la conversación. Cada mensaje se lee ≥ LECTURA desde que cae; mientras, del otro
 * lado ya están escribiendo. El último "ellos" duda (escribe, para, vuelve): es el golpe de la comedia.
 * @param {any} guion @param {number} hook
 */
export function planificar(guion, hook) {
  const c = guion.contenido
  /** @type {any[]} */
  const mensajes = []
  const ultimoEllos = c.mensajes.map((/** @type {any} */ m) => m.de).lastIndexOf('ellos')
  let previo = null
  for (const [i, m] of c.mensajes.entries()) {
    const n = m.texto.length
    const lectura = LECTURA.base + LECTURA.por_caracter * n
    const escribir = m.de === 'ellos' ? entre(0.55 + 0.01 * n, 0.6, 1.2) : entre(0.25 + 0.016 * n, 0.5, 1.4)
    const duda = m.de === 'ellos' && i === ultimoEllos && i >= 2 ? { escribe: 0.85, calla: 0.6 } : null
    const extra = duda ? duda.escribe + duda.calla : 0
    let desde
    if (!previo) desde = 0
    else {
      const solapa = m.de === 'ellos' ? escribir + extra : 0.6 * escribir
      desde = Math.max(previo.llega + 0.45, previo.llega + previo.lectura - solapa)
    }
    const llega = desde + extra + escribir
    const item = {
      de: m.de,
      texto: m.texto.trim(),
      desde: r3(desde),
      escribe: r3(desde + extra),
      llega: r3(llega),
      lectura: r3(lectura),
      duda: duda ? { aparece: r3(desde), calla: r3(desde + duda.escribe), vuelve: r3(desde + extra) } : null,
    }
    mensajes.push(item)
    previo = item
  }
  const ultimo = mensajes[mensajes.length - 1]
  const finChat = ultimo.llega + ultimo.lectura
  let remate = null
  let duracion
  if (c.remate) {
    const t = finChat + 0.2
    const n = palabras(c.remate).length
    const sostiene = Math.max(1.4, 0.5 + 0.25 * n)
    remate = { texto: c.remate.trim(), t: r3(t), golpe: r3(t + 0.38) }
    duracion = t + 0.38 + 0.5 + sostiene + COLA_QUIETA
  } else {
    duracion = finChat + 0.4 + COLA_QUIETA
  }
  return {
    duracion: r3(Math.ceil(duracion * 30) / 30),
    hook: String(guion.hooks[hook]).trim(),
    contacto: c.contacto.trim(),
    mensajes,
    remate,
  }
}

/**
 * Los sfx en el cuadro de su causa: pop cuando cae un mensaje de ellos, teclas suaves mientras
 * escribo (tres como mucho), el envío cuando se manda y un golpe grave con el remate.
 * @param {ReturnType<typeof planificar>} plan
 */
export function eventosDeSonido(plan) {
  /** @type {{ tipo: 'pop' | 'click-soft' | 'whoosh-short' | 'impact-bass-1', t: number, volumen: number }[]} */
  const ev = []
  // Medidos sobre los archivos: pop −24, envío −21, teclas −38 y golpe −17 LUFS momentáneos, debajo de una voz a −16/−14.
  const vol = [1, 0.88, 1.1]
  let k = 0
  for (const m of plan.mensajes) {
    if (m.de === 'ellos') ev.push({ tipo: 'pop', t: m.llega, volumen: 0.7 * (vol[k++ % vol.length] ?? 1) })
    else {
      const ps = palabras(m.texto)
      const paso = (m.llega - m.escribe - 0.1) / ps.length
      const cada = Math.max(1, Math.ceil(ps.length / 3))
      for (let j = 0; j < ps.length; j += cada) ev.push({ tipo: 'click-soft', t: m.escribe + j * paso, volumen: 0.25 })
      ev.push({ tipo: 'whoosh-short', t: m.llega - 0.04, volumen: 0.5 * (vol[k++ % vol.length] ?? 1) })
    }
  }
  if (plan.remate) ev.push({ tipo: 'impact-bass-1', t: plan.remate.golpe, volumen: 0.24 })
  return ev
}

/**
 * Corre todos los tiempos del plan `d` segundos (la portada de la hoja va antes de la charla).
 * @param {ReturnType<typeof planificar>} plan @param {number} d
 */
function desplazar(plan, d) {
  const mas = (/** @type {number} */ x) => r3(x + d)
  for (const m of plan.mensajes) {
    m.desde = mas(m.desde); m.escribe = mas(m.escribe); m.llega = mas(m.llega)
    if (m.duda) m.duda = { aparece: mas(m.duda.aparece), calla: mas(m.duda.calla), vuelve: mas(m.duda.vuelve) }
  }
  if (plan.remate) plan.remate = { ...plan.remate, t: mas(plan.remate.t), golpe: mas(plan.remate.golpe) }
  plan.duracion = r3(Math.ceil((plan.duracion + d) * 30) / 30)
  return plan
}

/**
 * @param {{ guion: any, hook: 0|1|2, voz: null, salida: string, diseno?: { ronda?: number, layout?: string }, tema: import('../_comun/tema.mjs').Tema }} p
 * @returns {Promise<{ duracion_s: number }>}
 */
export async function armar({ guion, hook, salida, diseno, tema }) {
  const problemas = validar(guion)
  if (problemas.length) throw new Error(`guion de chat inválido: ${problemas.join('; ')}`)
  if (![0, 1, 2].includes(hook)) throw new Error('hook tiene que ser 0, 1 o 2')
  if (!tema) throw new Error('falta el tema')
  const layout = /** @type {typeof LAYOUTS[number]} */ (layoutDe(LAYOUTS, diseno))
  const d = derivar(tema.paleta)

  const plan = planificar(guion, hook)
  if (layout === 'hoja') desplazar(plan, INTRO_HOJA)
  const primero = plan.mensajes[0]
  const sube = layout === 'hoja' ? INTRO_HOJA : r3(Math.max(1.8, (primero?.llega ?? 1) + 0.7))
  // edicion-reels: 5 sfx como mucho. Primero el golpe del remate, después lo que llega del otro lado.
  const sfx = eventosDeSonido(plan)
    .map((e, k) => ({ ...e, prioridad: e.tipo === 'impact-bass-1' ? 9 : e.tipo === 'pop' ? 5 - k / 100 : e.tipo === 'whoosh-short' ? 3 - k / 100 : 1 }))
    .sort((a, b) => b.prioridad - a.prioridad)
    .slice(0, 5)
    .sort((a, b) => a.t - b.t)
  const { dir } = prepararSalida(salida, tema)
  escribirDatos(dir, tema, { ...plan, sube, layout, resalte: d.resalte, tinta: tema.paleta.tinta, colores: coloresChat(tema.paleta), teclado: texto(tema.idioma, 'chat.teclado') })
  const capas = await lienzo(tema)
  const html = rellenar(readFileSync(PLANTILLAS[layout], 'utf8'), {
    css: capas.css,
    fondo: capas.fondo,
    hoja: capas.hoja,
    profundo: capas.profundo,
    luces: capas.luces,
    audio: sfxHtml(sfx, plan.duracion),
    duracion: plan.duracion.toFixed(3),
    hora: escaparHtml(guion.contenido.hora ?? texto(tema.idioma, 'chat.hora')),
  }, tema.idioma)
  writeFileSync(join(dir, 'index.html'), html)
  return { duracion_s: plan.duracion }
}
