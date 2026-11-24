// @ts-check
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FPS, buscarFrase, copiarVoz, derivar, escribirDatos, esTexto, gruposDeVoz, layoutDe, lienzo, palabrasDe, palabrasDelHook,
  prepararSalida, rellenar, sfxHtml, texto, validarBase, vozHtml,
} from '../_comun/index.mjs'

/*
  Cuenta regresiva a una fecha de calendario (aguinaldo, inicio de clases, Black Friday). Cómo tiene que
  estar escrita la voz:
  - Tres pasos de más lejos a más cerca de la fecha; cada uno se dice con las palabras de su `que`.
  - `dias` (opcional) es cuántos días antes de la `fecha` va el paso: si está, el contador lo muestra y
    el calendario lo marca. Si la cifra no sale de un hecho de la cuenta, mejor dejarlo afuera y usar `cuando`.
  - La fecha se dice al final ("el dieciocho de diciembre"): ahí se clava en el calendario.
*/

const AQUI = dirname(fileURLToPath(import.meta.url))
const PLANTILLA = join(AQUI, 'plantilla.html')
export const LAYOUTS = ['calendario', 'reloj']
export const layouts = LAYOUTS.map((id) => ({ id, apto: () => true }))
const QUIETO_FINAL = 0.3
const r3 = (/** @type {number} */ x) => Math.round(x * 1000) / 1000

/** @param {string} voz */
const palabrasDeTexto = (voz) => voz.split(/\s+/).filter(Boolean).map((texto, k) => ({ texto, inicio: k, fin: k + 0.5 }))

/** @param {unknown} f */
function fechaValida(f) {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return null
  const d = new Date(`${f}T12:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== f ? null : d
}

/** @param {any} guion @returns {string[]} */
export function validar(guion) {
  const p = validarBase(guion, 'cuenta-regresiva')
  const c = guion?.contenido
  if (!c || typeof c !== 'object') return p
  if (!esTexto(c.evento) || c.evento.length > 36) p.push('contenido.evento: 1 a 36 caracteres')
  if (!fechaValida(c.fecha)) p.push('contenido.fecha: AAAA-MM-DD válida')
  if (!Array.isArray(c.pasos) || c.pasos.length !== 3) {
    p.push('contenido.pasos: exactamente 3')
    return p
  }
  let previo = Infinity
  c.pasos.forEach((/** @type {any} */ x, /** @type {number} */ i) => {
    if (!x || typeof x !== 'object') return p.push(`pasos[${i}] no es un objeto`)
    if (!esTexto(x.cuando) || x.cuando.length > 24) p.push(`pasos[${i}].cuando: 1 a 24 caracteres`)
    if (!esTexto(x.que) || x.que.length > 50) p.push(`pasos[${i}].que: 1 a 50 caracteres`)
    if (x.dias !== undefined) {
      if (!Number.isInteger(x.dias) || x.dias < 0 || x.dias > 400) p.push(`pasos[${i}].dias: entero de 0 a 400`)
      else if (x.dias >= previo) p.push(`pasos[${i}].dias: de más lejos a más cerca (va bajando)`)
      else previo = x.dias
    }
  })
  if (p.length || !esTexto(guion.voz)) return p
  const dichas = palabrasDeTexto(guion.voz)
  let desde_i = 0
  c.pasos.forEach((/** @type {any} */ x, /** @type {number} */ i) => {
    const m = buscarFrase(dichas, x.que, { desde_i })
    if (!m) p.push(`la voz no dice el paso ${i} ("${x.que}") o no va en orden`)
    else desde_i = m.j + 1
  })
  return p
}

/** @param {string} t @param {{ inicio: number }[]} palabras @param {{ i: number, j: number }} tramo */
function encendidos(t, palabras, tramo) {
  const enPantalla = t.split(/\s+/).filter(Boolean)
  const n = tramo.j - tramo.i + 1
  return enPantalla.map((_, k) => r3(/** @type {{ inicio: number }} */ (palabras[tramo.i + Math.min(n - 1, Math.floor((k * n) / enPantalla.length))]).inicio))
}

/**
 * La grilla del mes de la fecha (lunes primero): 6 semanas de 7, con el día o null.
 * @param {Date} d
 */
export function grillaDelMes(d) {
  const anio = d.getUTCFullYear()
  const mes = d.getUTCMonth()
  const primero = (new Date(Date.UTC(anio, mes, 1)).getUTCDay() + 6) % 7
  const dias = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()
  /** @type {(number | null)[]} */
  const celdas = []
  for (let k = 0; k < 42; k++) {
    const n = k - primero + 1
    celdas.push(n >= 1 && n <= dias ? n : null)
  }
  const semanas = Math.ceil((primero + dias) / 7)
  return { anio, mes, celdas: celdas.slice(0, semanas * 7), semanas }
}

/** @param {any} guion @param {number} hook @param {{ palabras: any[] }} voz @param {string} idioma */
export function planificar(guion, hook, voz, idioma) {
  const c = guion.contenido
  const palabras = palabrasDe(voz.palabras)
  if (!palabras.length) throw new Error('voz.palabras vacío')
  const textoHook = String(guion.hooks[hook] ?? guion.hooks[0]).trim()
  const ultima = /** @type {{ fin: number }} */ (palabras[palabras.length - 1])
  const duracion = Math.ceil((ultima.fin + 0.45 + QUIETO_FINAL) * FPS) / FPS
  const nHook = palabrasDelHook(palabras, textoHook)
  const finHook = nHook ? /** @type {{ fin: number }} */ (palabras[nHook - 1]).fin : 1.2
  const cuerpo0 = nHook && palabras[nHook] ? /** @type {{ inicio: number }} */ (palabras[nHook]).inicio : finHook + 0.3
  const tramo = Math.max(4, ultima.fin - cuerpo0)
  const fecha = /** @type {Date} */ (fechaValida(c.fecha))
  const T = texto(idioma, 'cuenta_regresiva')
  /** @type {Set<number>} */
  const leidas = new Set()
  let desde_i = nHook
  const pasos = c.pasos.map((/** @type {any} */ x, /** @type {number} */ k) => {
    const m = buscarFrase(palabras, x.que, { desde_i })
    if (m) { desde_i = m.j + 1; for (let i = m.i; i <= m.j; i++) leidas.add(i) }
    const base = cuerpo0 + (tramo * 0.8 * k) / 3
    const dia = Number.isInteger(x.dias) ? new Date(fecha.getTime() - x.dias * 86400000) : null
    return {
      cuando: x.cuando.trim(), que: x.que.trim(), dias: Number.isInteger(x.dias) ? x.dias : null,
      dia: dia && dia.getUTCMonth() === fecha.getUTCMonth() && dia.getUTCFullYear() === fecha.getUTCFullYear() ? dia.getUTCDate() : null,
      t: r3(Math.max(finHook + 0.5 + k * 1.2, (m ? m.inicio : base) - 0.45)), luces: m ? encendidos(x.que, palabras, m) : null, fin: m ? m.fin : base + 1.5,
    }
  })
  const finPasos = /** @type {{ fin: number }} */ (pasos[2]).fin
  const fechaTexto = String(T.fecha).replace('{d}', String(fecha.getUTCDate())).replace('{m}', T.meses[fecha.getUTCMonth()])
  return {
    duracion: r3(duracion), textoHook, leidas,
    entra: r3(Math.max(finHook + 0.05, cuerpo0 - 0.45)),
    pasos,
    llega: r3(Math.min(duracion - 1.6, Math.max(finPasos + 0.35, /** @type {any} */ (pasos[2]).t + 1.4))),
    fecha: { ...grillaDelMes(fecha), texto: fechaTexto, dia: fecha.getUTCDate(), mes: T.meses[fecha.getUTCMonth()] },
  }
}

/**
 * @param {{ guion: any, hook: 0 | 1 | 2, voz: { wav: string, duracion_s: number, palabras: { texto: string, inicio_s: number, fin_s: number }[] } | null,
 *   salida: string, diseno?: { ronda?: number, layout?: string }, tema: import('../_comun/tema.mjs').Tema }} p
 * @returns {Promise<{ duracion_s: number }>}
 */
export async function armar({ guion, hook, voz, salida, diseno, tema }) {
  const problemas = validar(guion)
  if (problemas.length) throw new Error(`guion inválido para cuenta-regresiva: ${problemas.join('; ')}`)
  if (!voz || !voz.wav) throw new Error('cuenta-regresiva necesita voz')
  if (!tema) throw new Error('falta el tema')
  const plan = planificar(guion, hook, voz, tema.idioma)
  const { dir } = prepararSalida(salida, tema)
  copiarVoz(voz.wav, dir)
  const layout = layoutDe(LAYOUTS, diseno)
  const pal = { ...tema.paleta, ...derivar(tema.paleta) }
  const { grupos } = gruposDeVoz(voz.palabras, { hook: plan.textoHook, hasta: plan.duracion - QUIETO_FINAL, excluir: plan.leidas })
  const hookGrupo = grupos.find((g) => g.hook)
  const sfx = [
    ...plan.pasos.map((x) => ({ tipo: /** @type {const} */ ('click-soft'), t: x.t + 0.4, volumen: 0.6 })),
    { tipo: /** @type {const} */ ('impact-bass-1'), t: plan.llega + 0.3, volumen: 0.32 },
  ]
  escribirDatos(dir, tema, {
    t: texto(tema.idioma, 'cuenta_regresiva'),
    evento: guion.contenido.evento.trim(),
    duracion: plan.duracion,
    layout,
    tono: pal.tono,
    resalte: pal.resalte,
    tinta: pal.tinta,
    hook: { palabras: hookGrupo?.palabras ?? plan.textoHook.split(/\s+/).map((t) => ({ texto: t, inicio: 0, fin: 0 })), resaltar: Boolean(hookGrupo), fin: plan.entra },
    grupos: grupos.filter((g) => !g.hook),
    entra: plan.entra, pasos: plan.pasos, llega: plan.llega, fecha: plan.fecha,
  })
  const capas = await lienzo(tema)
  const html = rellenar(readFileSync(PLANTILLA, 'utf8'), {
    css: capas.css, fondo: capas.fondo, hoja: capas.hoja, profundo: capas.profundo, luces: capas.luces,
    duracion: plan.duracion.toFixed(3),
    audio: [vozHtml(Math.min(voz.duracion_s, plan.duracion)), sfxHtml(sfx, plan.duracion)].join('\n'),
  }, tema.idioma)
  writeFileSync(join(dir, 'index.html'), html)
  return { duracion_s: plan.duracion }
}
