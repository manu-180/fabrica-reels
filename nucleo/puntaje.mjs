// @ts-check
import { textoRef, todasLasPublicaciones } from './estado.mjs'
import { DIA } from './tiempo.mjs'

/**
 * Versión inicial del puntaje (docs/CONTRATO.md § 7). La completa y el informe para Kairo son de F7.
 * @typedef {import('./estado.mjs').EstadoV2} EstadoV2
 * @typedef {import('./estado.mjs').Metricas} Metricas
 */

const VENTANA_DIAS = 30
const K_TEMA = 3

/** @param {number[]} xs */
function zs(xs) {
  const n = xs.length
  if (!n) return []
  const media = xs.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - media) ** 2, 0) / n)
  return xs.map((x) => (sd ? (x - media) / sd : 0))
}

/** @param {number | null} a @param {number | null} b */
const razon = (a, b) => (a === null || !b ? null : a / b)

/**
 * @param {{ estado: EstadoV2, cuenta: import('./cuenta.mjs').Cuenta, ahora: Date }} p
 * @returns {{ publicaciones: Record<string, number | null>, creativos: Record<string, number | null>, temas: Record<string, { puntaje: number, n: number }>, con_insights: boolean }}
 */
export function puntuar({ estado, cuenta, ahora }) {
  const desde = ahora.getTime() - VENTANA_DIAS * DIA
  const conClave = Boolean(cuenta.cierre.palabra_clave)
  const filas = todasLasPublicaciones(estado).filter((x) => x.pub.metricas_72h && x.pub.publicado_at && Date.parse(x.pub.publicado_at) >= desde && x.ref.destino !== 'historia')
  const conInsights = estado.insights.disponible && filas.some((x) => x.pub.metricas_72h?.alcance !== null)
  /** @type {Record<string, number | null>} */
  const publicaciones = {}
  for (const x of todasLasPublicaciones(estado)) publicaciones[textoRef(x.ref)] = null

  /** @type {Map<string, typeof filas>} */
  const grupos = new Map()
  for (const x of filas) {
    const clave = conInsights ? x.ref.destino : `${x.ref.destino}|${x.creativo.fecha}`
    grupos.set(clave, [...(grupos.get(clave) ?? []), x])
  }
  for (const grupo of grupos.values()) {
    if (conInsights) {
      const m = grupo.map((x) => /** @type {Metricas} */ (x.pub.metricas_72h))
      const ejes = /** @type {[number, (m: Metricas, x: any) => number | null][]} */ ([
        [0.35, (m, x) => razon(m.promedio_visto_s, x.variante.duracion_s)],
        [0.25, (m) => razon(m.compartidos, m.alcance)],
        [0.2, (m) => razon(m.guardados, m.alcance)],
        [0.1, (m) => razon(m.comentarios, m.alcance)],
        [0.1, (m) => razon(m.likes, m.alcance)],
        ...(conClave ? /** @type {[number, (m: Metricas) => number | null][]} */ ([[0.3, (m) => razon(m.comentarios_web, m.alcance)]]) : []),
      ])
      const totales = grupo.map(() => 0)
      for (const [peso, valor] of ejes) {
        const vs = m.map((mm, i) => valor(mm, grupo[i]))
        const idx = vs.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0)
        const z = zs(idx.map((i) => /** @type {number} */ (vs[i])))
        idx.forEach((i, k) => (totales[i] = /** @type {number} */ (totales[i]) + peso * /** @type {number} */ (z[k])))
      }
      grupo.forEach((x, i) => (publicaciones[textoRef(x.ref)] = Math.round(/** @type {number} */ (totales[i]) * 1000) / 1000))
    } else {
      const crudo = grupo.map((x) => {
        const m = /** @type {Metricas} */ (x.pub.metricas_72h)
        return (m.likes ?? 0) + 3 * (m.comentarios ?? 0) + 10 * (m.comentarios_web ?? 0)
      })
      grupo.forEach((x, i) => {
        const v = /** @type {number} */ (crudo[i])
        const debajo = crudo.filter((c) => c < v).length + crudo.filter((c) => c === v).length / 2 - 0.5
        publicaciones[textoRef(x.ref)] = grupo.length > 1 ? Math.round((debajo / (grupo.length - 1)) * 1000) / 1000 : 0.5
      })
    }
  }

  /** @type {Record<string, number | null>} */
  const creativos = {}
  /** @type {Record<string, { suma: number, n: number }>} */
  const acumTemas = {}
  for (const [id, c] of Object.entries(estado.creativos)) {
    const ps = (c.variantes ?? []).flatMap((v) => Object.keys(v.publicaciones ?? {}).map((d) => publicaciones[`${id}/${v.indice}/${d}`])).filter((p) => typeof p === 'number')
    creativos[id] = ps.length ? Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 1000) / 1000 : null
    const tema = c.tema ?? c.categoria
    if (tema && creativos[id] !== null) {
      const t = (acumTemas[tema] ??= { suma: 0, n: 0 })
      t.suma += /** @type {number} */ (creativos[id])
      t.n++
    }
  }
  const temas = Object.fromEntries(Object.entries(acumTemas).map(([k, t]) => [k, { puntaje: Math.round((t.suma / (t.n + K_TEMA)) * 1000) / 1000, n: t.n }]))
  return { publicaciones, creativos, temas, con_insights: conInsights }
}
