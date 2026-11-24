// @ts-check
import { DESTINOS } from './cuenta.mjs'
import { finDelDia } from './tiempo.mjs'

/**
 * El estado v2 de una cuenta (docs/CONTRATO.md § 2).
 * @typedef {'prueba' | 'normal' | 'historia'} Destino
 * @typedef {'token' | 'permiso-trial' | 'permiso' | 'bloqueo' | 'antispam' | 'cupo' | 'transitorio' | 'publicacion'} ClaseError
 * @typedef {{ medido_at: string, vistas: number | null, alcance: number | null, likes: number | null,
 *   comentarios: number | null, compartidos: number | null, guardados: number | null,
 *   comentarios_web: number | null, promedio_visto_s: number | null,
 *   respuestas: number | null, avances: number | null, salidas: number | null,
 *   preguntas: string[] | null }} Metricas
 * @typedef {{ destino: Destino, caption: string, no_antes_de: string | null, vence: string,
 *   creando_at: string | null, ig_container_id: string | null, ig_media_id: string | null, permalink: string | null, publicado_at: string | null,
 *   error_publicar: string | null, clase_error: ClaseError | null, intentos_publicar: number,
 *   descartada_at: string | null, motivo_descarte: string | null, metricas: Metricas | null, metricas_72h: Metricas | null }} Publicacion
 * @typedef {{ formato: string, layout: string, motivo: string, paleta: string, hook: number, musica: string, cierre: string, color: string, textura: string,
 *   ffmpeg: { zoom: number, encuadre: string, velocidad: number } }} Firma
 * @typedef {{ indice: number, hook: number, firma: Firma, resumen: string, video_url: string | null, video_historia_url: string | null,
 *   duracion_s: number | null, publicaciones: Partial<Record<Destino, Publicacion>> }} Variante
 * @typedef {{ id: string, clave: string, idea: string | null, tema: string | null, fecha: string, titulo: string, categoria: string, formato: string,
 *   ronda: number, slot: number, producido_at: string | null, error: string | null, falla: 'guion' | 'general' | null, intentos: number,
 *   voz: { proveedor: string, caracteres_pagados: number, caracteres_cache: number } | null, variantes: Variante[] }} Creativo
 * @typedef {{ version: 2, cuenta: string, actualizado: string, pausado: string | null,
 *   pausado_por: 'token' | 'permiso' | 'bloqueo' | 'antispam' | 'manual' | null, pausado_hasta: string | null,
 *   insights: { disponible: boolean, motivo: string | null },
 *   destinos_apagados: Partial<Record<Destino, { motivo: string, at: string }>>,
 *   rampa: { escalon: number, desde: string, bajadas: { at: string, codigo: string }[] } | null,
 *   fallas_seguidas?: number,
 *   saltados: Record<string, { motivo: string, at: string }>, creativos: Record<string, Creativo> }} EstadoV2
 * @typedef {{ creativo: string, variante: number, destino: Destino }} Ref
 */

export const MAX_INTENTOS = 3
const MONOTONOS = /** @type {const} */ (['ig_container_id', 'ig_media_id', 'publicado_at', 'creando_at'])

/** @param {string} cuenta @param {Date} [ahora] @returns {EstadoV2} */
export function estadoVacio(cuenta, ahora = new Date()) {
  return {
    version: 2, cuenta, actualizado: ahora.toISOString(), pausado: null, pausado_por: null, pausado_hasta: null,
    insights: { disponible: false, motivo: 'todavía no se probó' }, destinos_apagados: {}, rampa: null, saltados: {}, creativos: {},
  }
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const esObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Un estado roto o de otra cuenta tira en vez de arrancar de cero: con el estado perdido se volverían
 * a publicar cosas que ya salieron.
 * @param {string | null | undefined} texto @param {string} cuentaId @returns {EstadoV2}
 */
export function leerEstado(texto, cuentaId) {
  if (!texto || !texto.trim()) return estadoVacio(cuentaId)
  const d = JSON.parse(texto)
  if (!esObjeto(d)) throw new Error(`el estado de ${cuentaId} no es un objeto`)
  if (d.version !== 2) throw new Error(`el estado de ${cuentaId} tiene version ${d.version} (se migra con migrarV1)`)
  if (d.cuenta !== cuentaId) throw new Error(`el estado es de la cuenta ${JSON.stringify(d.cuenta)}, no de ${cuentaId}`)
  if (d.creativos !== undefined && !esObjeto(d.creativos)) throw new Error('creativos no es un objeto')
  const vacio = estadoVacio(cuentaId)
  return {
    ...d,
    version: 2,
    cuenta: cuentaId,
    actualizado: typeof d.actualizado === 'string' ? d.actualizado : vacio.actualizado,
    pausado: typeof d.pausado === 'string' && d.pausado.trim() ? d.pausado : null,
    pausado_por: d.pausado_por ?? null,
    pausado_hasta: typeof d.pausado_hasta === 'string' ? d.pausado_hasta : null,
    insights: esObjeto(d.insights) ? d.insights : vacio.insights,
    destinos_apagados: esObjeto(d.destinos_apagados) ? d.destinos_apagados : {},
    rampa: esObjeto(d.rampa) ? d.rampa : null,
    saltados: esObjeto(d.saltados) ? d.saltados : {},
    creativos: d.creativos ?? {},
  }
}

/** @param {Record<string, any>} o */
const ordenado = (o) => Object.fromEntries(Object.keys(o ?? {}).sort().map((k) => [k, o[k]]))

/** Orden estable: dos corridas con lo mismo escriben el mismo archivo. @param {EstadoV2} e */
export function serializarEstado(e) {
  const { version, cuenta, actualizado, pausado, pausado_por, pausado_hasta, insights, destinos_apagados, rampa, saltados, creativos, ...resto } = e
  const salida = {
    version, cuenta, actualizado, pausado, pausado_por: pausado ? (pausado_por ?? null) : null, pausado_hasta: pausado ? (pausado_hasta ?? null) : null,
    insights, destinos_apagados: ordenado(destinos_apagados), rampa: rampa ?? null, saltados: ordenado(saltados), ...ordenado(resto), creativos: ordenado(creativos),
  }
  return `${JSON.stringify(salida, null, 2)}\n`
}

/** @param {unknown} a @param {unknown} b */
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Si esta corrida no lo tocó respecto de su base, vale lo del remoto. @param {any} base @param {any} remoto @param {any} propio */
const tres = (base, remoto, propio) => (igual(base, propio) ? remoto : propio)

/**
 * Por campo con `tres`, salvo los que tienen su propia regla.
 * @param {Record<string, any>} b @param {Record<string, any>} r @param {Record<string, any>} p @param {Record<string, (b: any, r: any, p: any) => any>} especiales
 */
function porCampo(b, r, p, especiales) {
  /** @type {Record<string, any>} */
  const salida = {}
  for (const k of new Set([...Object.keys(r ?? {}), ...Object.keys(p ?? {})])) {
    const v = especiales[k] ? especiales[k](b?.[k], r?.[k], p?.[k]) : tres(b?.[k], r?.[k], p?.[k])
    if (v !== undefined) salida[k] = v
  }
  return salida
}

/**
 * Por campo, como el resto; los monótonos nunca se pierden: si el lado elegido no los tiene y el otro
 * sí, se queda el del otro. Es lo que impide publicar dos veces tras una carrera.
 * @param {any} b @param {any} r @param {any} p
 */
function fusionarPublicacion(b, r, p) {
  if (!r || !p) return tres(b, r, p)
  const salida = porCampo(b, r, p, {})
  for (const k of MONOTONOS) if (!salida[k]) salida[k] = p[k] || r[k] || salida[k]
  return salida
}

/** @param {any} b @param {any} r @param {any} p */
function fusionarPublicaciones(b, r, p) {
  /** @type {Record<string, any>} */
  const salida = {}
  for (const d of new Set([...Object.keys(r ?? {}), ...Object.keys(p ?? {})])) {
    const v = fusionarPublicacion(b?.[d], r?.[d], p?.[d])
    if (v) salida[d] = v
  }
  return salida
}

/** @param {any[]} b @param {any[]} r @param {any[]} p */
function fusionarVariantes(b, r, p) {
  const porIndice = (/** @type {any[]} */ vs) => new Map((vs ?? []).map((v) => [v.indice, v]))
  const [mb, mr, mp] = [porIndice(b), porIndice(r), porIndice(p)]
  /** @type {any[]} */
  const salida = []
  for (const i of [...new Set([...mr.keys(), ...mp.keys()])].sort((x, y) => x - y)) {
    const [vb, vr, vp] = [mb.get(i), mr.get(i), mp.get(i)]
    if (!vr || !vp) {
      const v = vr ?? vp
      if (v && !(vb && !vp)) salida.push(v)
      continue
    }
    salida.push(porCampo(vb, vr, vp, { publicaciones: fusionarPublicaciones }))
  }
  return salida
}

/**
 * Tres vías (docs/CONTRATO.md § 2): `base` lo que leyó esta corrida, `remoto` la punta de la rama,
 * `propio` lo que deja esta corrida. Los ids de Meta y las marcas de publicado nunca se pierden.
 * @param {EstadoV2} base @param {EstadoV2} remoto @param {EstadoV2} propio @returns {EstadoV2}
 */
export function fusionarEstado(base, remoto, propio) {
  if (remoto.cuenta && propio.cuenta && remoto.cuenta !== propio.cuenta) throw new Error(`no se fusionan estados de cuentas distintas (${remoto.cuenta} y ${propio.cuenta})`)
  const salida = porCampo(base, remoto, propio, {
    creativos: () => undefined,
    actualizado: () => [remoto.actualizado, propio.actualizado].filter(Boolean).sort().pop() ?? new Date().toISOString(),
  })
  /** @type {Record<string, Creativo>} */
  const creativos = {}
  const [bc, rc, pc] = [base.creativos ?? {}, remoto.creativos ?? {}, propio.creativos ?? {}]
  for (const k of new Set([...Object.keys(rc), ...Object.keys(pc), ...Object.keys(bc)])) {
    const [b, r, p] = [bc[k], rc[k], pc[k]]
    /** @type {any} */
    let v
    if (igual(b, p)) v = r
    else if (!p) v = b ? undefined : r
    else if (!r || !b) v = p
    else v = porCampo(b, r, p, { variantes: fusionarVariantes })
    if (v) creativos[k] = v
  }
  return /** @type {EstadoV2} */ ({ ...salida, creativos })
}


/** @param {Ref} r */
export const textoRef = (r) => `${r.creativo}/${r.variante}/${r.destino}`

/** @param {string} t @returns {Ref} */
export function leerRef(t) {
  const m = /^(.+)\/(\d+)\/(prueba|normal|historia)$/.exec(t)
  if (!m) throw new Error(`referencia inválida: ${t}`)
  return { creativo: /** @type {string} */ (m[1]), variante: Number(m[2]), destino: /** @type {Destino} */ (m[3]) }
}

/** @param {Destino} destino @param {string} caption @param {string} vence @returns {Publicacion} */
export function publicacionVacia(destino, caption, vence) {
  return {
    destino, caption, no_antes_de: null, vence, creando_at: null, ig_container_id: null, ig_media_id: null, permalink: null, publicado_at: null,
    error_publicar: null, clase_error: null, intentos_publicar: 0, descartada_at: null, motivo_descarte: null, metricas: null, metricas_72h: null,
  }
}

/** @param {EstadoV2} e @param {Ref} r @returns {Publicacion | null} */
export function publicacionDe(e, r) {
  return e.creativos[r.creativo]?.variantes?.find((v) => v.indice === r.variante)?.publicaciones?.[r.destino] ?? null
}

/** @param {EstadoV2} e @param {Ref} r @returns {Variante | null} */
export const varianteDe = (e, r) => e.creativos[r.creativo]?.variantes?.find((v) => v.indice === r.variante) ?? null

/** Sin mutar: el estado con la publicación cambiada. @param {EstadoV2} e @param {Ref} r @param {Partial<Publicacion>} cambios @returns {EstadoV2} */
export function tocarPublicacion(e, r, cambios) {
  const c = e.creativos[r.creativo]
  if (!c) throw new Error(`no existe el creativo ${r.creativo}`)
  const variantes = c.variantes.map((v) => {
    if (v.indice !== r.variante) return v
    const p = v.publicaciones?.[r.destino]
    if (!p) throw new Error(`no existe la publicación ${textoRef(r)}`)
    return { ...v, publicaciones: { ...v.publicaciones, [r.destino]: { ...p, ...cambios } } }
  })
  return { ...e, creativos: { ...e.creativos, [r.creativo]: { ...c, variantes } } }
}

/** Todas las publicaciones con su ref. @param {EstadoV2} e @returns {{ ref: Ref, pub: Publicacion, creativo: Creativo, variante: Variante }[]} */
export function todasLasPublicaciones(e) {
  /** @type {{ ref: Ref, pub: Publicacion, creativo: Creativo, variante: Variante }[]} */
  const salida = []
  for (const [id, c] of Object.entries(e.creativos)) {
    for (const v of c.variantes ?? []) {
      for (const d of DESTINOS) {
        const pub = v.publicaciones?.[/** @type {Destino} */ (d)]
        if (pub) salida.push({ ref: { creativo: id, variante: v.indice, destino: /** @type {Destino} */ (d) }, pub, creativo: c, variante: v })
      }
    }
  }
  return salida
}

/** Salió o puede salir todavía. @param {Publicacion} p */
export const yaSalio = (p) => Boolean(p.ig_media_id || p.publicado_at)
/** @param {Publicacion} p */
export const afuera = (p) => !yaSalio(p) && (Boolean(p.descartada_at) || (p.intentos_publicar ?? 0) >= MAX_INTENTOS)
/** @param {Publicacion} p */
export const pendiente = (p) => !yaSalio(p) && !afuera(p)


const METRICAS_V2 = /** @type {const} */ (['respuestas', 'avances', 'salidas', 'preguntas'])

/** @param {any} m */
const metricasV2 = (m) => (m ? { ...m, ...Object.fromEntries(METRICAS_V2.filter((k) => !(k in m)).map((k) => [k, null])) } : null)

/** @param {any} c cambios v1 @param {any} creativo */
function firmaDeCambios(c, creativo) {
  return {
    formato: creativo.formato, layout: 'v1', motivo: 'v1', paleta: creativo.paleta ?? 'v1', hook: c?.hook ?? creativo.hook ?? 0,
    musica: c?.musica ?? 'v1', cierre: c?.cierre ?? 'v1', color: c?.color ?? 'neutro', textura: c?.textura ?? 'nada',
    ffmpeg: { zoom: c?.zoom ?? 1, encuadre: c?.encuadre ?? 'centro', velocidad: c?.velocidad ?? 1 },
  }
}

/** @param {any} v variante v1 @param {Destino} destino @param {string} vence */
function publicacionV1(v, destino, vence) {
  return {
    ...publicacionVacia(destino, v.caption ?? '', vence),
    no_antes_de: v.publicar_at ?? null, creando_at: v.creando_at ?? null, ig_container_id: v.ig_container_id ?? null,
    ig_media_id: v.ig_media_id ?? null, permalink: v.permalink ?? null, publicado_at: v.publicado_at ?? null,
    error_publicar: v.error_publicar ?? null, intentos_publicar: v.intentos_publicar ?? 0, descartada_at: v.descartada_at ?? null,
    motivo_descarte: v.descartada_at ? (v.error_publicar ?? 'descartada en v1') : null, metricas: metricasV2(v.metricas),
  }
}

/**
 * M1: un estado v1 al v2. En calcular cada creativo es un solo video con sus publicaciones por `tipo`
 * (una variante); en apex-demos cada variante es otro video publicado como prueba, y el "reel real"
 * (`real`) pasa a ser la normal de la variante de la que salió.
 * @param {any} v1 @param {string} cuentaId @returns {EstadoV2}
 */
export function migrarV1(v1, cuentaId) {
  if (!esObjeto(v1) || v1.version !== 1) throw new Error('migrarV1 espera un estado version 1')
  const ms = Date.parse(String(v1.actualizado ?? ''))
  const e = estadoVacio(cuentaId, Number.isFinite(ms) ? new Date(ms) : new Date())
  /** @type {Record<string, Creativo>} */
  const creativos = {}
  for (const [id, c] of Object.entries(/** @type {Record<string, any>} */ (v1.creativos ?? {}))) {
    const fin = finDelDia(c.fecha)
    const vs = Array.isArray(c.variantes) ? c.variantes : []
    /** @type {Variante[]} */
    let variantes
    if (vs.some((v) => v.tipo)) {
      const primera = vs[0]
      /** @type {Partial<Record<Destino, Publicacion>>} */
      const publicaciones = {}
      for (const v of vs) publicaciones[/** @type {Destino} */ (v.tipo ?? 'prueba')] = publicacionV1(v, v.tipo ?? 'prueba', fin)
      variantes = primera ? [{ indice: 0, hook: primera.cambios?.hook ?? c.hook ?? 0, firma: firmaDeCambios(primera.cambios, c), resumen: primera.resumen ?? '', video_url: primera.video_url ?? null, video_historia_url: null, duracion_s: primera.duracion_s ?? null, publicaciones }] : []
    } else {
      variantes = vs.map((v, i) => {
        /** @type {Partial<Record<Destino, Publicacion>>} */
        const publicaciones = { prueba: publicacionV1(v, 'prueba', fin) }
        if (c.real && c.real.variante === v.id) {
          publicaciones.normal = publicacionV1({ ...c.real, publicar_at: null, intentos_publicar: c.real.intentos ?? 0, error_publicar: c.real.error ?? null }, 'normal', fin)
        }
        return { indice: i, hook: v.cambios?.hook ?? 0, firma: firmaDeCambios(v.cambios, c), resumen: v.resumen ?? '', video_url: v.video_url ?? null, video_historia_url: null, duracion_s: v.duracion_s ?? null, publicaciones }
      })
    }
    creativos[id] = {
      id, clave: c.clave, idea: c.idea ?? null, tema: c.tema ?? c.idea ?? null, fecha: c.fecha, titulo: c.titulo, categoria: c.categoria, formato: c.formato,
      ronda: c.ronda ?? 0, slot: c.franja ?? 0, producido_at: c.producido_at ?? null, error: c.error ?? null, falla: c.falla ?? null, intentos: c.intentos ?? 0,
      voz: null, variantes,
    }
  }
  return {
    ...e, pausado: v1.pausado ?? null, pausado_por: v1.pausado ? (v1.pausado_por ?? 'manual') : null,
    insights: v1.insights ?? e.insights, saltados: v1.saltados ?? {}, creativos,
  }
}
