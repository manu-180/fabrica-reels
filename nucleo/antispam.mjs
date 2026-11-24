// @ts-check
import { porDiaHoy } from './cuenta.mjs'
import { todasLasPublicaciones } from './estado.mjs'
import { ErrorGraph, crearGraph } from './meta/graph.mjs'
import { DIA, HORA, MIN, diaAR } from './tiempo.mjs'

/**
 * @typedef {{ id: string, at: string, tipo: string, propia: boolean }} PublicacionReal
 * @typedef {{ publicaciones_24h: PublicacionReal[], ultima_at: string | null, cupo: { usado: number, total: number } | null,
 *   username: string | null, recientes: { id: string, caption: string, permalink: string | null, timestamp: string }[],
 *   historias: { id: string, at: string }[] | null }} CuentaReal
 * @typedef {import('./cuenta.mjs').Cuenta} Cuenta
 * @typedef {import('./estado.mjs').EstadoV2} EstadoV2
 */

// En @apex.stack, con 30 publicaciones por día, 15 medias no alcanzaban para encontrar un caption de ayer.
const RECIENTES_H = 48
const RECIENTES_TOPE = 150
const DIAS_ESCALON = 7
const PAUSA_ANTISPAM_H = 48

/** @param {any} t */
const iso = (t) => {
  const ms = Date.parse(String(t ?? ''))
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** La respuesta de /content_publishing_limit. @param {any} r @returns {{ total: number, usado: number } | null} */
export function leerCupo(r) {
  const d = r?.data?.[0]
  if (!d || typeof d.quota_usage !== 'number') return null
  return { total: Number(d.config?.quota_total ?? 100), usado: d.quota_usage }
}

/** Los ids de media que la fábrica publicó en esta cuenta. @param {EstadoV2 | null | undefined} estado */
const idsPropios = (estado) => new Set(estado ? todasLasPublicaciones(estado).map((x) => x.pub.ig_media_id).filter(Boolean) : [])

/**
 * Todo lo que hay en la cuenta de las últimas 24 h, lo haya publicado quien lo haya publicado (D5),
 * más las medias de 48 h con su caption (para no publicar dos veces) y el cupo de Meta.
 * @param {{ igUser: string, token: string, ahora: Date, fetch?: typeof fetch, espera?: (ms: number) => Promise<unknown>, estado?: EstadoV2 | null }} p
 * @returns {Promise<CuentaReal>}
 */
export async function leerCuentaReal({ igUser, token, ahora, fetch: f = fetch, espera, estado = null }) {
  const graph = crearGraph({ token, fetch: f, ...(espera ? { espera } : {}) })
  const propios = idsPropios(estado)
  const yo = await graph.conReintentos(() => graph.llamar('GET', `/${igUser}`, { fields: 'username' }))
  const desde48 = ahora.getTime() - RECIENTES_H * HORA
  /** @type {any[]} */
  const medias = []
  /** @type {string | undefined} */
  let despues
  while (medias.length < RECIENTES_TOPE) {
    const d = await graph.conReintentos(() => graph.llamar('GET', `/${igUser}/media`, { fields: 'id,caption,permalink,timestamp,media_product_type', limit: '50', ...(despues ? { after: despues } : {}) }))
    /** @type {any[]} */
    const pagina = d.data ?? []
    medias.push(...pagina)
    const ultima = pagina.at(-1)
    despues = d.paging?.next ? d.paging?.cursors?.after : undefined
    if (!despues || !ultima || !(Date.parse(String(ultima.timestamp)) >= desde48)) break
  }
  /** @type {{ id: string, at: string }[] | null} */
  let historias = null
  try {
    const s = await graph.conReintentos(() => graph.llamar('GET', `/${igUser}/stories`, { fields: 'id,timestamp' }))
    historias = (s.data ?? []).map((/** @type {any} */ x) => ({ id: String(x.id), at: iso(x.timestamp) })).filter((/** @type {any} */ x) => x.at)
  } catch (e) {
    if (!(e instanceof ErrorGraph) || e.token) throw e
  }
  const cupo = leerCupo(await graph.conReintentos(() => graph.llamar('GET', `/${igUser}/content_publishing_limit`, { fields: 'config,quota_usage' })))
  const desde24 = ahora.getTime() - DIA
  /** @type {PublicacionReal[]} */
  const publicaciones_24h = []
  for (const m of medias) {
    const at = iso(m.timestamp)
    if (at && Date.parse(at) >= desde24) publicaciones_24h.push({ id: String(m.id), at, tipo: String(m.media_product_type ?? 'FEED'), propia: propios.has(String(m.id)) })
  }
  for (const h of historias ?? []) if (Date.parse(h.at) >= desde24) publicaciones_24h.push({ id: h.id, at: h.at, tipo: 'STORY', propia: propios.has(h.id) })
  publicaciones_24h.sort((a, b) => b.at.localeCompare(a.at))
  return {
    publicaciones_24h,
    ultima_at: publicaciones_24h[0]?.at ?? null,
    cupo,
    username: typeof yo?.username === 'string' ? yo.username : null,
    recientes: medias.filter((m) => Date.parse(String(m.timestamp)) >= desde48).slice(0, RECIENTES_TOPE).map((m) => ({ id: String(m.id), caption: String(m.caption ?? ''), permalink: m.permalink ?? null, timestamp: iso(m.timestamp) ?? '' })),
    historias,
  }
}

/**
 * Si la cuenta puede publicar una más ahora. Cuenta lo de Instagram (propio y ajeno) y lo propio del
 * estado, por si Instagram todavía no lo lista. Lo que no sale por antispam no cuenta intento.
 * @param {{ cuenta: Cuenta, estado: EstadoV2, cuentaReal: CuentaReal | null, ahora: Date }} p
 * @returns {{ ok: true } | { ok: false, motivo: string }}
 */
export function puedePublicar({ cuenta, estado, cuentaReal, ahora }) {
  const no = (/** @type {string} */ motivo) => /** @type {{ ok: false, motivo: string }} */ ({ ok: false, motivo })
  if (estado.pausado) return no(`pausado: ${estado.pausado}`)
  if (!cuentaReal) return no('no se pudo leer la cuenta de Instagram')
  if (cuentaReal.username !== cuenta.usuario) return no(`el token es de @${cuentaReal.username ?? '?'}, no de @${cuenta.usuario}`)
  const hoy = diaAR(ahora)
  const desde24 = ahora.getTime() - DIA
  const propias = todasLasPublicaciones(estado).filter((x) => x.pub.publicado_at)
  /** @type {Map<string, string>} */
  const vistas = new Map(cuentaReal.publicaciones_24h.map((p) => [p.id, p.at]))
  for (const x of propias) {
    const at = /** @type {string} */ (x.pub.publicado_at)
    if (Date.parse(at) >= desde24) vistas.set(x.pub.ig_media_id ?? `propia:${x.ref.creativo}/${x.ref.variante}/${x.ref.destino}`, at)
  }
  if (vistas.size >= cuenta.antispam.max_dia) return no(`ya hay ${vistas.size} publicaciones en 24 h en la cuenta (tope ${cuenta.antispam.max_dia})`)
  const tope = porDiaHoy(cuenta, hoy, { escalon: estado.rampa?.escalon ?? null }).acciones
  const deHoy = propias.filter((x) => diaAR(/** @type {string} */ (x.pub.publicado_at)) === hoy).length
  if (deHoy >= tope) return no(`la fábrica ya publicó ${deHoy} hoy (tope del día ${tope})`)
  const ultima = [...vistas.values()].sort().pop()
  if (ultima && ahora.getTime() - Date.parse(ultima) < cuenta.antispam.gap_min * MIN) {
    return no(`la última publicación de la cuenta fue hace ${Math.round((ahora.getTime() - Date.parse(ultima)) / MIN)} min (gap ${cuenta.antispam.gap_min})`)
  }
  if (!cuentaReal.cupo) return no('no se pudo leer el cupo de Meta')
  const libre = cuentaReal.cupo.total - cuentaReal.cupo.usado
  if (libre <= cuenta.antispam.reserva_cupo) return no(`cupo de Meta: quedan ${libre} y se reservan ${cuenta.antispam.reserva_cupo} para lo que publica otro`)
  return { ok: true }
}

/**
 * Un antispam de Meta (9/2207078 y compañía) baja un escalón de la rampa y lo sostiene 7 días; dos en
 * una semana pausan la cuenta 48 h.
 * @param {{ estado: EstadoV2, cuenta: Cuenta, codigo: string, ahora: Date }} p @returns {EstadoV2}
 */
export function aplicarErrorRampa({ estado, cuenta, codigo, ahora }) {
  const at = ahora.toISOString()
  const previas = (estado.rampa?.bajadas ?? []).filter((b) => ahora.getTime() - Date.parse(b.at) < DIAS_ESCALON * DIA)
  const bajadas = [...(estado.rampa?.bajadas ?? []), { at, codigo }].slice(-10)
  const actual = porDiaHoy(cuenta, ahora, { escalon: estado.rampa?.escalon ?? null }).escalon
  const escalon = typeof actual === 'number' && actual >= 0 ? Math.max(0, actual - 1) : (estado.rampa?.escalon ?? 0)
  /** @type {EstadoV2} */
  let e = { ...estado, rampa: { escalon, desde: at, bajadas } }
  if (previas.length >= 1) {
    e = { ...e, pausado: `Meta frenó la cuenta por antispam dos veces en una semana (${codigo}): pausa de ${PAUSA_ANTISPAM_H} h`, pausado_por: 'antispam', pausado_hasta: new Date(ahora.getTime() + PAUSA_ANTISPAM_H * HORA).toISOString() }
  }
  return e
}

/**
 * Sube un escalón tras 7 días seguidos sin antispam; cuando el sostenido alcanza al del calendario,
 * la rampa del estado deja de limitar.
 * @param {{ estado: EstadoV2, cuenta: Cuenta, ahora: Date }} p @returns {EstadoV2}
 */
export function actualizarRampa({ estado, cuenta, ahora }) {
  const r = estado.rampa
  if (!r || ahora.getTime() - Date.parse(r.desde) < DIAS_ESCALON * DIA) return estado
  if (!cuenta.rampa) return { ...estado, rampa: null }
  const calendario = porDiaHoy(cuenta, ahora).escalon
  const escalon = r.escalon + 1
  if (typeof calendario !== 'number' || escalon >= calendario) return { ...estado, rampa: null }
  return { ...estado, rampa: { ...r, escalon, desde: ahora.toISOString() } }
}

/** La pausa con fecha de fin (antispam) se levanta sola. @param {EstadoV2} estado @param {Date} ahora @returns {EstadoV2} */
export function levantarPausaVencida(estado, ahora) {
  if (!estado.pausado || !estado.pausado_hasta || Date.parse(estado.pausado_hasta) > ahora.getTime()) return estado
  return { ...estado, pausado: null, pausado_por: null, pausado_hasta: null }
}
