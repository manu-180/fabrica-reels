// @ts-check
import { todasLasPublicaciones, tocarPublicacion } from '../estado.mjs'
import { DIA, HORA } from '../tiempo.mjs'
import { ErrorGraph, crearGraph } from './graph.mjs'

/*
  Cómo anda cada publicación de los últimos 14 días, con pocas llamadas: likes, comentarios y permalink
  de 50 medias por llamada (?ids=), los insights en la misma llamada si el token los deja leer (se prueba
  una vez por corrida) y los comentarios sólo de las que tienen alguno. Las historias, sólo con
  insights y antes de que Instagram las borre a las 24 h. Lo que no se puede leer queda null, nunca 0.
*/

export const DIAS_MEDIR = 14
const FOTO_REEL_H = 72
const FOTO_HISTORIA_H = 20
const VIDA_HISTORIA_H = 24
const LOTE = 50
const CAMPOS = 'like_count,comments_count,permalink'
const CAMPOS_INSIGHTS = 'insights.metric(views,reach,shares,saved,ig_reels_avg_watch_time,total_interactions)'
const PAGINAS_COMENTARIOS = 10
const MAX_PREGUNTAS = 10

/** @template T @param {T[]} lista @param {number} n @returns {T[][]} */
const lotes = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, (i + 1) * n))

/** @param {unknown} v */
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** `insights.data` a { métrica: número } (y los desgloses de navegación). @param {any} ins */
export function leerInsights(ins) {
  if (!Array.isArray(ins?.data)) return null
  /** @type {Record<string, number>} */
  const salida = {}
  for (const m of ins.data) {
    const valor = m?.total_value?.value ?? m?.values?.[0]?.value
    if (typeof m?.name === 'string' && typeof valor === 'number') salida[m.name] = valor
    for (const b of m?.total_value?.breakdowns ?? []) {
      for (const r of b?.results ?? []) {
        const k = r?.dimension_values?.[0]
        if (typeof k === 'string' && typeof r?.value === 'number') salida[`${m.name}:${k}`] = r.value
      }
    }
  }
  return salida
}

/**
 * Comentarios que dicen la palabra clave como palabra, sin los de la cuenta propia.
 * @param {{ text?: string, username?: string }[]} comentarios @param {string | null} propio @param {string} palabra
 */
export function contarClave(comentarios, propio, palabra) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu')
  return comentarios.filter((c) => re.test(String(c.text ?? '')) && String(c.username ?? '').toLowerCase() !== String(propio ?? '').toLowerCase()).length
}

/**
 * Los comentarios con pregunta, para el informe de ideas. El estado es público: sin usuarios, sin
 * @menciones, mails ni teléfonos.
 * @param {{ text?: string, username?: string }[]} comentarios @param {string | null} propio @returns {string[]}
 */
export function preguntasDe(comentarios, propio) {
  return comentarios
    .filter((c) => String(c.username ?? '').toLowerCase() !== String(propio ?? '').toLowerCase())
    .map((c) => String(c.text ?? ''))
    .filter((t) => t.includes('?'))
    .map((t) => t.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[mail]').replace(/@[\w.]+/g, '@…').replace(/\+?\d[\d\s().-]{6,}\d/g, '[número]').replace(/\s+/g, ' ').trim().slice(0, 200))
    .slice(0, MAX_PREGUNTAS)
}

/**
 * @param {{ media: any, insights: Record<string, number> | null, comentarios_web: number | null, preguntas: string[] | null, ahora: Date }} p
 * @returns {import('../estado.mjs').Metricas}
 */
export function metricasDe({ media, insights, comentarios_web, preguntas, ahora }) {
  const visto = numero(insights?.ig_reels_avg_watch_time)
  return {
    medido_at: ahora.toISOString(),
    vistas: numero(insights?.views),
    alcance: numero(insights?.reach),
    likes: numero(media?.like_count),
    comentarios: numero(media?.comments_count),
    compartidos: numero(insights?.shares),
    guardados: numero(insights?.saved),
    comentarios_web,
    promedio_visto_s: visto === null ? null : Math.round(visto / 10) / 100,
    respuestas: null, avances: null, salidas: null,
    preguntas,
  }
}

/** @param {Record<string, number> | null} ins @param {Date} ahora @returns {import('../estado.mjs').Metricas} */
function metricasHistoria(ins, ahora) {
  const nav = (/** @type {string} */ k) => numero(ins?.[`navigation:${k}`])
  return {
    medido_at: ahora.toISOString(), vistas: numero(ins?.views), alcance: numero(ins?.reach), likes: null, comentarios: null,
    compartidos: numero(ins?.shares), guardados: null, comentarios_web: null, promedio_visto_s: null,
    respuestas: numero(ins?.replies), avances: nav('TAP_FORWARD') ?? nav('tap_forward'), salidas: nav('TAP_EXIT') ?? nav('tap_exit'), preguntas: null,
  }
}

/**
 * @param {{ cuenta: import('../cuenta.mjs').Cuenta, estado: import('../estado.mjs').EstadoV2, ahora?: Date, env?: Record<string, string | undefined>,
 *   fetch?: typeof fetch, espera?: (ms: number) => Promise<unknown>, log?: (m: string) => void }} p
 * @returns {Promise<{ estado: import('../estado.mjs').EstadoV2, medidas: number }>}
 */
export async function medir({ cuenta, estado, ahora = new Date(), env = process.env, fetch: f = fetch, espera, log = () => {} }) {
  // El token que publica puede no tener instagram_manage_insights: si hay uno aparte, se mide con ese.
  const token = (cuenta.secretos.ig_insights ? env[cuenta.secretos.ig_insights]?.trim() : '') || env[cuenta.secretos.ig_token]?.trim()
  const igUser = env[cuenta.secretos.ig_user]?.trim()
  if (!igUser || !token) return { estado, medidas: 0 }
  const desde = ahora.getTime() - DIAS_MEDIR * DIA
  const todas = todasLasPublicaciones(estado).filter((x) => x.pub.ig_media_id && x.pub.publicado_at && Date.parse(x.pub.publicado_at) >= desde)
  const reels = todas.filter((x) => x.ref.destino !== 'historia')
  const historias = todas.filter((x) => x.ref.destino === 'historia' && ahora.getTime() - Date.parse(/** @type {string} */ (x.pub.publicado_at)) < VIDA_HISTORIA_H * HORA)
  if (!reels.length && !historias.length) return { estado, medidas: 0 }
  const graph = crearGraph({ token, fetch: f, ...(espera ? { espera } : {}) })

  let insights = estado.insights
  const masNueva = [...todas].sort((a, b) => String(b.pub.publicado_at).localeCompare(String(a.pub.publicado_at)))[0]
  try {
    await graph.llamar('GET', `/${masNueva?.pub.ig_media_id}/insights`, { metric: 'reach' })
    insights = { disponible: true, motivo: null }
  } catch (e) {
    if (!(e instanceof ErrorGraph)) throw e
    if (e.codigo === 10 || (e.codigo !== undefined && e.codigo >= 200 && e.codigo <= 299)) insights = { disponible: false, motivo: `el token no tiene instagram_manage_insights (${e.message.slice(0, 120)})` }
    else if (e.transitorio) insights = { disponible: false, motivo: `no se pudo probar esta vez: ${e.message.slice(0, 120)}` }
    else insights = { disponible: false, motivo: e.message.slice(0, 200) }
  }

  /** @type {Record<string, any>} */
  const datos = {}
  for (const lote of lotes(reels, LOTE)) {
    const ids = lote.map((r) => r.pub.ig_media_id).join(',')
    try {
      Object.assign(datos, await graph.conReintentos(() => graph.llamar('GET', '/', { ids, fields: insights.disponible ? `${CAMPOS},${CAMPOS_INSIGHTS}` : CAMPOS })))
    } catch (e) {
      if (!(e instanceof ErrorGraph)) throw e
      if (!insights.disponible) {
        log(`no se pudieron leer ${lote.length} medias: ${e.message}`)
        continue
      }
      // Una métrica que Meta no da para alguna de estas medias tumba la llamada entera: sin insights, lo demás sí se lee.
      log(`insights del lote falló (${e.message}): se leen sin insights`)
      try {
        Object.assign(datos, await graph.conReintentos(() => graph.llamar('GET', '/', { ids, fields: CAMPOS })))
      } catch (e2) {
        log(`no se pudieron leer ${lote.length} medias: ${/** @type {Error} */ (e2).message}`)
      }
    }
  }

  const conComentarios = reels.filter((r) => (datos[String(r.pub.ig_media_id)]?.comments_count ?? 0) > 0)
  /** @type {Record<string, any[] | null>} */
  const comentarios = {}
  /** @type {string | null} */
  let propio = cuenta.usuario
  if (conComentarios.length) {
    for (const lote of lotes(conComentarios, LOTE)) {
      /** @type {Record<string, any>} */
      let r = {}
      try {
        r = await graph.conReintentos(() => graph.llamar('GET', '/', { ids: lote.map((x) => x.pub.ig_media_id).join(','), fields: `comments.limit(${LOTE}){text,username}` }))
      } catch (e) {
        log(`no se pudieron leer los comentarios: ${/** @type {Error} */ (e).message}`)
      }
      for (const x of lote) {
        const id = String(x.pub.ig_media_id)
        const c = r[id]?.comments
        if (!c) {
          comentarios[id] = null
          continue
        }
        /** @type {any[]} */
        const lista = [...(c.data ?? [])]
        let despues = c.paging?.cursors?.after
        for (let pagina = 1; despues && c.paging?.next && lista.length < (datos[id]?.comments_count ?? 0) && pagina < PAGINAS_COMENTARIOS; pagina++) {
          try {
            const mas = await graph.llamar('GET', `/${id}/comments`, { fields: 'text,username', limit: String(LOTE), after: despues })
            lista.push(...(mas.data ?? []))
            despues = mas.paging?.next ? mas.paging?.cursors?.after : null
          } catch {
            break
          }
        }
        comentarios[id] = lista
      }
    }
  }

  let medidas = 0
  let e = { ...estado, insights }
  /** @param {import('../estado.mjs').Ref} ref @param {import('../estado.mjs').Publicacion} pub @param {import('../estado.mjs').Metricas} m @param {number} fotoH @param {string | null} permalink */
  const anotar = (ref, pub, m, fotoH, permalink) => {
    const edad = ahora.getTime() - Date.parse(/** @type {string} */ (pub.publicado_at))
    e = tocarPublicacion(e, ref, { metricas: m, permalink: pub.permalink ?? permalink, ...(edad >= fotoH * HORA && !pub.metricas_72h ? { metricas_72h: m } : {}) })
    medidas++
  }
  for (const { ref, pub } of reels) {
    const d = datos[String(pub.ig_media_id)]
    if (!d) continue
    const lista = d.comments_count === 0 ? [] : (comentarios[String(pub.ig_media_id)] ?? null)
    const web = cuenta.cierre.palabra_clave ? (lista ? contarClave(lista, propio, cuenta.cierre.palabra_clave) : null) : null
    const m = metricasDe({ media: d, insights: insights.disponible ? leerInsights(d.insights) : null, comentarios_web: web, preguntas: lista ? preguntasDe(lista, propio) : null, ahora })
    anotar(ref, pub, m, FOTO_REEL_H, d.permalink ?? null)
  }
  if (insights.disponible) {
    for (const { ref, pub } of historias) {
      try {
        const ins = await graph.llamar('GET', `/${pub.ig_media_id}/insights`, { metric: 'reach,replies,shares,navigation', breakdown: 'story_navigation_action_type', metric_type: 'total_value' })
        anotar(ref, pub, metricasHistoria(leerInsights(ins), ahora), FOTO_HISTORIA_H, null)
      } catch (err) {
        log(`no se pudo medir la historia ${pub.ig_media_id}: ${/** @type {Error} */ (err).message}`)
      }
    }
  }
  return { estado: e, medidas }
}
