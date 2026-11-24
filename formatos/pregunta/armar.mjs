// @ts-check
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FPS, buscarFrase, copiarVoz, derivar, escribirDatos, esTexto, gruposDeVoz, layoutDe, lienzo, palabrasDe, palabrasDelHook,
  prepararSalida, rellenar, sfxHtml, texto, validarBase, vozHtml,
} from '../_comun/index.mjs'

/*
  Una pregunta de comentario y su respuesta visual. Cómo tiene que estar escrita la voz:
  - Lee la `pregunta` (las mismas palabras, o casi) después del hook.
  - Después dice la `respuesta` y cada una de las `claves`, en orden: cada una entra cuando se dice.
  La pregunta no es de nadie: no lleva usuario, nombre ni foto.
*/

const AQUI = dirname(fileURLToPath(import.meta.url))
const PLANTILLA = join(AQUI, 'plantilla.html')
export const LAYOUTS = ['comentario', 'titular']
export const layouts = LAYOUTS.map((id) => ({ id, apto: () => true }))
const QUIETO_FINAL = 0.3
const r3 = (/** @type {number} */ x) => Math.round(x * 1000) / 1000

/** @param {string} voz */
const palabrasDeTexto = (voz) => voz.split(/\s+/).filter(Boolean).map((texto, k) => ({ texto, inicio: k, fin: k + 0.5 }))

/** @param {any} guion @returns {string[]} */
export function validar(guion) {
  const p = validarBase(guion, 'pregunta')
  const c = guion?.contenido
  if (!c || typeof c !== 'object') return p
  if (!esTexto(c.pregunta) || c.pregunta.length > 100) p.push('contenido.pregunta: 1 a 100 caracteres')
  else if (!/\?\s*$/.test(c.pregunta.trim())) p.push('contenido.pregunta: termina en "?"')
  if (!esTexto(c.respuesta) || c.respuesta.length > 70) p.push('contenido.respuesta: 1 a 70 caracteres')
  if (!Array.isArray(c.claves) || c.claves.length < 2 || c.claves.length > 3) p.push('contenido.claves: 2 o 3')
  else c.claves.forEach((/** @type {unknown} */ x, /** @type {number} */ i) => { if (!esTexto(x) || x.length > 44) p.push(`claves[${i}]: 1 a 44 caracteres`) })
  if (p.length || !esTexto(guion.voz)) return p
  const dichas = palabrasDeTexto(guion.voz)
  const q = buscarFrase(dichas, c.pregunta.replace(/[¿?]/g, ''))
  if (!q) p.push('la voz no lee la pregunta')
  else if (!buscarFrase(dichas, c.respuesta, { desde_i: q.j + 1 })) p.push('la voz no dice la respuesta después de la pregunta')
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
  const duracion = Math.ceil((ultima.fin + 0.4 + QUIETO_FINAL) * FPS) / FPS
  const nHook = palabrasDelHook(palabras, textoHook)
  const finHook = nHook ? /** @type {{ fin: number }} */ (palabras[nHook - 1]).fin : 1.2
  const cuerpo0 = nHook && palabras[nHook] ? /** @type {{ inicio: number }} */ (palabras[nHook]).inicio : finHook + 0.3
  const tramo = Math.max(4, ultima.fin - cuerpo0)
  /** @type {Set<number>} */
  const leidas = new Set()
  const marcar = (/** @type {{ i: number, j: number } | null} */ m) => { if (m) for (let i = m.i; i <= m.j; i++) leidas.add(i) }
  const q = buscarFrase(palabras, c.pregunta.replace(/[¿?]/g, ''), { desde_i: nHook })
  marcar(q)
  const r = buscarFrase(palabras, c.respuesta, { desde_i: q ? q.j + 1 : nHook })
  marcar(r)
  let desde_i = r ? r.j + 1 : q ? q.j + 1 : nHook
  const tPregunta = q ? q.inicio : cuerpo0
  const finPregunta = q ? q.fin : cuerpo0 + tramo * 0.35
  const tRespuesta = r3(Math.max(finPregunta + 0.55, (r ? r.inicio : cuerpo0 + tramo * 0.45) - 0.25))
  /** @type {string[]} */
  const lista = c.claves
  const claves = lista.map((t, k) => {
    const m = buscarFrase(palabras, t, { desde_i })
    if (m) { desde_i = m.j + 1; marcar(m) }
    const base = tRespuesta + 1.2 + k * Math.max(1, (ultima.fin - tRespuesta - 1.2) / lista.length)
    return { texto: t.trim(), t: r3(Math.max(tRespuesta + 0.9 + k * 0.5, (m ? m.inicio : base) - 0.1)), luces: m ? encendidos(t, palabras, m) : null }
  })
  return {
    duracion: r3(duracion), finHook: r3(finHook), textoHook, leidas,
    entra: r3(Math.max(finHook + 0.05, tPregunta - 0.55)),
    pregunta: { texto: c.pregunta.trim(), luces: q ? encendidos(c.pregunta, palabras, q) : null, fin: r3(finPregunta) },
    respuesta: { texto: c.respuesta.trim(), t: tRespuesta, luces: r ? encendidos(c.respuesta, palabras, r) : null },
    claves,
  }
}

/**
 * @param {{ guion: any, hook: 0 | 1 | 2, voz: { wav: string, duracion_s: number, palabras: { texto: string, inicio_s: number, fin_s: number }[] } | null,
 *   salida: string, diseno?: { ronda?: number, layout?: string }, tema: import('../_comun/tema.mjs').Tema }} p
 * @returns {Promise<{ duracion_s: number }>}
 */
export async function armar({ guion, hook, voz, salida, diseno, tema }) {
  const problemas = validar(guion)
  if (problemas.length) throw new Error(`guion inválido para pregunta: ${problemas.join('; ')}`)
  if (!voz || !voz.wav) throw new Error('pregunta necesita voz')
  if (!tema) throw new Error('falta el tema')
  const plan = planificar(guion, hook, voz)
  const { dir, logo } = prepararSalida(salida, tema)
  copiarVoz(voz.wav, dir)
  const layout = layoutDe(LAYOUTS, diseno)
  const pal = { ...tema.paleta, ...derivar(tema.paleta) }
  const { grupos } = gruposDeVoz(voz.palabras, { hook: plan.textoHook, hasta: plan.duracion - QUIETO_FINAL, excluir: plan.leidas })
  const hookGrupo = grupos.find((g) => g.hook)
  const sfx = [
    { tipo: /** @type {const} */ ('notification'), t: plan.entra + 0.3, volumen: 0.32 },
    { tipo: /** @type {const} */ ('whoosh-cinematic'), t: plan.respuesta.t + 0.2, volumen: 0.3 },
    ...plan.claves.map((k) => ({ tipo: /** @type {const} */ ('pop'), t: k.t + 0.15, volumen: 0.38 })),
  ].slice(0, 5)

  escribirDatos(dir, tema, {
    t: texto(tema.idioma, 'pregunta'),
    logo,
    duracion: plan.duracion,
    layout,
    tono: pal.tono,
    resalte: pal.resalte,
    tinta: pal.tinta,
    hook: { palabras: hookGrupo?.palabras ?? plan.textoHook.split(/\s+/).map((t) => ({ texto: t, inicio: 0, fin: 0 })), resaltar: Boolean(hookGrupo), fin: plan.entra },
    grupos: grupos.filter((g) => !g.hook),
    entra: plan.entra, pregunta: plan.pregunta, respuesta: plan.respuesta, claves: plan.claves,
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
