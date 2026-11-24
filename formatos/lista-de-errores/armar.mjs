// @ts-check
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FPS, buscarFrase, copiarVoz, derivar, escribirDatos, esTexto, gruposDeVoz, layoutDe, lienzo, palabrasDe, palabrasDelHook,
  prepararSalida, rellenar, sfxHtml, texto, tokens, validarBase, vozHtml,
} from '../_comun/index.mjs'

/*
  Tres errores que se tachan. Cómo tiene que estar escrita la voz (lo lee quien escribe guiones):
  - Dice cada `error` con esas palabras (o casi), en orden, y después su `arreglo`.
  - El error se tacha cuando la voz termina de decirlo; el arreglo sube cuando lo empieza.
  Lo que se lee en pantalla no se repite en el subtítulo.
*/

const AQUI = dirname(fileURLToPath(import.meta.url))
const PLANTILLA = join(AQUI, 'plantilla.html')
export const LAYOUTS = ['pila', 'tarjetas', 'tachon']
export const layouts = LAYOUTS.map((id) => ({ id, apto: () => true }))
const QUIETO_FINAL = 0.3
const r3 = (/** @type {number} */ x) => Math.round(x * 1000) / 1000

/** @param {string} voz */
const palabrasDeTexto = (voz) => voz.split(/\s+/).filter(Boolean).map((texto, k) => ({ texto, inicio: k, fin: k + 0.5 }))

/** @param {any} guion @returns {string[]} */
export function validar(guion) {
  const p = validarBase(guion, 'lista-de-errores')
  const c = guion?.contenido
  if (!c || typeof c !== 'object') return p
  if (c.titulo !== undefined && (!esTexto(c.titulo) || c.titulo.length > 40)) p.push('contenido.titulo: opcional, 1 a 40 caracteres')
  const e = c.errores
  if (!Array.isArray(e) || e.length !== 3) {
    p.push('contenido.errores: exactamente 3')
    return p
  }
  e.forEach((x, i) => {
    if (!x || typeof x !== 'object') return p.push(`errores[${i}] no es un objeto`)
    if (!esTexto(x.error) || x.error.length > 48) p.push(`errores[${i}].error: 1 a 48 caracteres`)
    else if (tokens(x.error).length < 2) p.push(`errores[${i}].error: al menos 2 palabras`)
    if (!esTexto(x.arreglo) || x.arreglo.length > 64) p.push(`errores[${i}].arreglo: 1 a 64 caracteres`)
  })
  if (p.length || !esTexto(guion.voz)) return p
  const dichas = palabrasDeTexto(guion.voz)
  let desde_i = 0
  e.forEach((x, i) => {
    const m = buscarFrase(dichas, x.error, { desde_i })
    if (!m) p.push(`la voz no dice el error de errores[${i}] ("${x.error}") o no va en orden`)
    else desde_i = m.j + 1
  })
  return p
}

/**
 * Tiempo en que se enciende cada palabra de un texto en pantalla, repartiendo las dichas del tramo.
 * @param {string} t @param {{ inicio: number }[]} palabras @param {{ i: number, j: number }} tramo
 */
function encendidos(t, palabras, tramo) {
  const enPantalla = t.split(/\s+/).filter(Boolean)
  const n = tramo.j - tramo.i + 1
  return enPantalla.map((_, k) => r3(/** @type {{ inicio: number }} */ (palabras[tramo.i + Math.min(n - 1, Math.floor((k * n) / enPantalla.length))]).inicio))
}

/**
 * El plan sobre los tiempos de la voz: cuándo entra, se tacha y se arregla cada error.
 * @param {any} guion @param {number} hook @param {{ palabras: any[] }} voz
 */
export function planificar(guion, hook, voz) {
  const palabras = palabrasDe(voz.palabras)
  if (!palabras.length) throw new Error('voz.palabras vacío')
  const textoHook = String(guion.hooks[hook] ?? guion.hooks[0]).trim()
  const ultima = /** @type {{ fin: number }} */ (palabras[palabras.length - 1])
  const duracion = Math.ceil((ultima.fin + 0.4 + QUIETO_FINAL) * FPS) / FPS
  const nHook = palabrasDelHook(palabras, textoHook)
  const finHook = nHook ? /** @type {{ fin: number }} */ (palabras[nHook - 1]).fin : 1.2
  const cuerpo0 = nHook && palabras[nHook] ? /** @type {{ inicio: number }} */ (palabras[nHook]).inicio : finHook + 0.3
  const tramo = Math.max(3, ultima.fin - cuerpo0)
  /** @type {Set<number>} */
  const leidas = new Set()
  /** @type {{ error: string, arreglo: string }[]} */
  const lista = guion.contenido.errores
  let desde_i = nHook
  const items = lista.map((x, k, todas) => {
    const m = buscarFrase(palabras, x.error, { desde_i })
    if (m) desde_i = m.j + 1
    const sig = todas[k + 1] ? buscarFrase(palabras, todas[k + 1].error, { desde_i }) : null
    const a = buscarFrase(palabras, x.arreglo, { desde_i, hasta_s: sig ? sig.inicio : Infinity })
    if (a) desde_i = a.j + 1
    if (m) for (let i = m.i; i <= m.j; i++) leidas.add(i)
    if (a) for (let i = a.i; i <= a.j; i++) leidas.add(i)
    const base = cuerpo0 + (tramo * k) / lista.length
    const dicho = m ?? { i: -1, j: -1, inicio: base + 0.1, fin: base + (tramo / lista.length) * 0.4 }
    const tacha = dicho.fin + 0.08
    const arregla = a ? Math.max(tacha + 0.45, a.inicio - 0.12) : tacha + 0.6
    return {
      error: x.error.trim(), arreglo: x.arreglo.trim(),
      dice: r3(dicho.inicio), luces: m ? encendidos(x.error, palabras, m) : null,
      tacha: r3(tacha), arregla: r3(arregla), lucesArreglo: a ? encendidos(x.arreglo, palabras, a) : null,
      fin: r3(a ? a.fin : arregla + 1.2), entra: 0,
    }
  })
  items.forEach((it, k) => {
    const previo = k === 0 ? finHook + 0.05 : /** @type {{ fin: number }} */ (items[k - 1]).fin + 0.1
    it.entra = r3(Math.max(previo, it.dice - 0.6))
  })
  return { duracion: r3(duracion), finHook: r3(finHook), nHook, items, leidas, textoHook }
}

/**
 * @param {{ guion: any, hook: 0 | 1 | 2, voz: { wav: string, duracion_s: number, palabras: { texto: string, inicio_s: number, fin_s: number }[] } | null,
 *   salida: string, diseno?: { ronda?: number, layout?: string }, tema: import('../_comun/tema.mjs').Tema }} p
 * @returns {Promise<{ duracion_s: number }>}
 */
export async function armar({ guion, hook, voz, salida, diseno, tema }) {
  const problemas = validar(guion)
  if (problemas.length) throw new Error(`guion inválido para lista-de-errores: ${problemas.join('; ')}`)
  if (!voz || !voz.wav) throw new Error('lista-de-errores necesita voz')
  if (!tema) throw new Error('falta el tema')
  const plan = planificar(guion, hook, voz)
  const { dir } = prepararSalida(salida, tema)
  copiarVoz(voz.wav, dir)
  const layout = layoutDe(LAYOUTS, diseno)
  const pal = { ...tema.paleta, ...derivar(tema.paleta) }
  const { grupos } = gruposDeVoz(voz.palabras, { hook: plan.textoHook, hasta: plan.duracion - QUIETO_FINAL, excluir: plan.leidas })
  const hookGrupo = grupos.find((g) => g.hook)
  const T = texto(tema.idioma, 'lista_errores')

  /** @type {{ tipo: any, t: number, volumen: number, prioridad: number }[]} */
  const cand = []
  plan.items.forEach((it, k) => {
    cand.push({ tipo: 'whoosh-short', t: it.tacha + 0.05, volumen: 0.45, prioridad: 3 })
    cand.push({ tipo: 'pop', t: it.arregla + 0.18, volumen: 0.4, prioridad: 2 })
    if (layout !== 'pila') cand.push({ tipo: 'whoosh-cinematic', t: it.entra + 0.3, volumen: 0.26, prioridad: k === 0 ? 2 : 1 })
  })
  const sfx = cand.sort((a, b) => b.prioridad - a.prioridad || a.t - b.t).slice(0, 5).sort((a, b) => a.t - b.t)

  escribirDatos(dir, tema, {
    t: { error: T.error, mejor: T.mejor },
    titulo: guion.contenido.titulo ? String(guion.contenido.titulo).trim() : T.titulo,
    duracion: plan.duracion,
    layout,
    tono: pal.tono,
    resalte: pal.resalte,
    tinta: pal.tinta,
    hook: { palabras: hookGrupo?.palabras ?? plan.textoHook.split(/\s+/).map((t) => ({ texto: t, inicio: 0, fin: 0 })), resaltar: Boolean(hookGrupo), fin: r3(plan.items[0]?.entra ?? plan.finHook) },
    grupos: grupos.filter((g) => !g.hook),
    items: plan.items,
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
