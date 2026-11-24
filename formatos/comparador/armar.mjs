// @ts-check
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FPS, buscarFrase, copiarVoz, derivar, escribirDatos, esTexto, gruposDeVoz, layoutDe, lienzo, palabrasDe, palabrasDelHook,
  prepararSalida, rellenar, sfxHtml, texto, validarBase, vozHtml,
} from '../_comun/index.mjs'

/*
  A contra B en pantalla partida, que se resuelve. Cómo tiene que estar escrita la voz:
  - Compara de a un punto por vez: dice el punto de A y el de B de la misma fila (en cualquier orden),
    y pasa a la fila siguiente. Cada celda se enciende cuando la voz la dice.
  - Cierra con el `veredicto` (esas palabras, o casi): ahí la pantalla se resuelve a favor del `ganador`.
*/

const AQUI = dirname(fileURLToPath(import.meta.url))
const PLANTILLA = join(AQUI, 'plantilla.html')
export const LAYOUTS = ['columnas', 'rondas']
export const layouts = LAYOUTS.map((id) => ({ id, apto: () => true }))
const QUIETO_FINAL = 0.3
const r3 = (/** @type {number} */ x) => Math.round(x * 1000) / 1000

/** @param {string} voz */
const palabrasDeTexto = (voz) => voz.split(/\s+/).filter(Boolean).map((texto, k) => ({ texto, inicio: k, fin: k + 0.5 }))

/** @param {any} lado @param {string} n @param {string[]} p */
function validarLado(lado, n, p) {
  if (!lado || typeof lado !== 'object') return p.push(`contenido.${n} falta`)
  if (!esTexto(lado.etiqueta) || lado.etiqueta.length > 20) p.push(`${n}.etiqueta: 1 a 20 caracteres`)
  if (!Array.isArray(lado.puntos) || lado.puntos.length !== 3) p.push(`${n}.puntos: exactamente 3`)
  else lado.puntos.forEach((/** @type {unknown} */ x, /** @type {number} */ i) => { if (!esTexto(x) || x.length > 32) p.push(`${n}.puntos[${i}]: 1 a 32 caracteres`) })
}

/** @param {any} guion @returns {string[]} */
export function validar(guion) {
  const p = validarBase(guion, 'comparador')
  const c = guion?.contenido
  if (!c || typeof c !== 'object') return p
  validarLado(c.a, 'a', p)
  validarLado(c.b, 'b', p)
  if (c.ganador !== 'a' && c.ganador !== 'b') p.push('contenido.ganador: "a" o "b"')
  if (!esTexto(c.veredicto) || c.veredicto.length > 70) p.push('contenido.veredicto: 1 a 70 caracteres')
  if (p.length || !esTexto(guion.voz)) return p
  const dichas = palabrasDeTexto(guion.voz)
  if (!buscarFrase(dichas, c.veredicto)) p.push('la voz no dice el veredicto')
  return p
}

/** @param {string} t @param {{ inicio: number }[]} palabras @param {{ i: number, j: number }} tramo */
function encendidos(t, palabras, tramo) {
  const enPantalla = t.split(/\s+/).filter(Boolean)
  const n = tramo.j - tramo.i + 1
  return enPantalla.map((_, k) => r3(/** @type {{ inicio: number }} */ (palabras[tramo.i + Math.min(n - 1, Math.floor((k * n) / enPantalla.length))]).inicio))
}

/** @param {any} guion @param {number} hook @param {{ palabras: any[] }} voz */
export function planificar(guion, hook, voz) {
  const c = guion.contenido
  const palabras = palabrasDe(voz.palabras)
  if (!palabras.length) throw new Error('voz.palabras vacío')
  const textoHook = String(guion.hooks[hook] ?? guion.hooks[0]).trim()
  const ultima = /** @type {{ fin: number }} */ (palabras[palabras.length - 1])
  const duracion = Math.ceil((ultima.fin + 0.45 + QUIETO_FINAL) * FPS) / FPS
  const nHook = palabrasDelHook(palabras, textoHook)
  const finHook = nHook ? /** @type {{ fin: number }} */ (palabras[nHook - 1]).fin : 1.2
  const cuerpo0 = nHook && palabras[nHook] ? /** @type {{ inicio: number }} */ (palabras[nHook]).inicio : finHook + 0.3
  /** @type {Set<number>} */
  const leidas = new Set()
  const marcar = (/** @type {{ i: number, j: number } | null} */ m) => { if (m) for (let i = m.i; i <= m.j; i++) leidas.add(i) }
  const v = buscarFrase(palabras, c.veredicto, { desde_i: nHook })
  const tVeredicto = v ? v.inicio : cuerpo0 + (ultima.fin - cuerpo0) * 0.8
  marcar(v)
  const tramo = Math.max(3, tVeredicto - cuerpo0)
  let desde_i = nHook
  const filas = [0, 1, 2].map((k) => {
    const ma = buscarFrase(palabras, c.a.puntos[k], { desde_i, hasta_s: tVeredicto })
    const mb = buscarFrase(palabras, c.b.puntos[k], { desde_i, hasta_s: tVeredicto })
    const encontrados = [ma, mb].filter(Boolean)
    if (encontrados.length) desde_i = Math.max(...encontrados.map((m) => /** @type {{ j: number }} */ (m).j)) + 1
    marcar(ma); marcar(mb)
    const base = cuerpo0 + 0.6 + (tramo * k) / 3
    const ta = ma ? ma.inicio : base
    const tb = mb ? mb.inicio : base + tramo / 6
    const fin = Math.max(ma ? ma.fin : ta + 0.8, mb ? mb.fin : tb + 0.8)
    return {
      a: { texto: c.a.puntos[k].trim(), t: r3(ta - 0.08), luces: ma ? encendidos(c.a.puntos[k], palabras, ma) : null },
      b: { texto: c.b.puntos[k].trim(), t: r3(tb - 0.08), luces: mb ? encendidos(c.b.puntos[k], palabras, mb) : null },
      entra: r3(Math.min(ta, tb) - 0.35), marca: r3(fin + 0.08),
    }
  })
  return {
    duracion: r3(duracion), textoHook, leidas,
    entra: r3(Math.max(finHook + 0.05, cuerpo0 - 0.4)),
    filas,
    veredicto: { texto: c.veredicto.trim(), t: r3(Math.max(/** @type {any} */ (filas[2]).marca + 0.5, tVeredicto - 0.35)), luces: v ? encendidos(c.veredicto, palabras, v) : null },
  }
}

/**
 * @param {{ guion: any, hook: 0 | 1 | 2, voz: { wav: string, duracion_s: number, palabras: { texto: string, inicio_s: number, fin_s: number }[] } | null,
 *   salida: string, diseno?: { ronda?: number, layout?: string }, tema: import('../_comun/tema.mjs').Tema }} p
 * @returns {Promise<{ duracion_s: number }>}
 */
export async function armar({ guion, hook, voz, salida, diseno, tema }) {
  const problemas = validar(guion)
  if (problemas.length) throw new Error(`guion inválido para comparador: ${problemas.join('; ')}`)
  if (!voz || !voz.wav) throw new Error('comparador necesita voz')
  if (!tema) throw new Error('falta el tema')
  const c = guion.contenido
  const plan = planificar(guion, hook, voz)
  const { dir } = prepararSalida(salida, tema)
  copiarVoz(voz.wav, dir)
  const layout = layoutDe(LAYOUTS, diseno)
  const pal = { ...tema.paleta, ...derivar(tema.paleta) }
  const { grupos } = gruposDeVoz(voz.palabras, { hook: plan.textoHook, hasta: plan.duracion - QUIETO_FINAL, excluir: plan.leidas })
  const hookGrupo = grupos.find((g) => g.hook)
  const sfx = [
    { tipo: /** @type {const} */ ('whoosh-short'), t: plan.entra + 0.2, volumen: 0.4 },
    ...plan.filas.map((f) => ({ tipo: /** @type {const} */ ('click-soft'), t: f.marca, volumen: 0.6 })),
    { tipo: /** @type {const} */ ('impact-bass-1'), t: plan.veredicto.t + 0.35, volumen: 0.3 },
  ]
  escribirDatos(dir, tema, {
    t: texto(tema.idioma, 'comparador'),
    duracion: plan.duracion,
    layout,
    tono: pal.tono,
    resalte: pal.resalte,
    tinta: pal.tinta,
    hook: { palabras: hookGrupo?.palabras ?? plan.textoHook.split(/\s+/).map((t) => ({ texto: t, inicio: 0, fin: 0 })), resaltar: Boolean(hookGrupo), fin: plan.entra },
    grupos: grupos.filter((g) => !g.hook),
    a: c.a.etiqueta.trim(), b: c.b.etiqueta.trim(), ganador: c.ganador,
    entra: plan.entra, filas: plan.filas, veredicto: plan.veredicto,
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
