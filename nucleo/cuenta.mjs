// @ts-check
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * La forma de cuentas/<id>/cuenta.json (docs/CONTRATO.md § 1). Si cambia, cambia ahí primero.
 * @typedef {{ desde: string, hasta: string }} Franja
 * @typedef {{ creativos: number, acciones: number, variantes?: number, dias?: number }} Escalon
 * @typedef {{
 *   version: 1, id: string, usuario: string, idioma: 'es-AR' | 'en-US', activa: boolean, modo: 'real' | 'sombra',
 *   creativos_por_dia: number, variantes_por_creativo: number,
 *   destinos: {
 *     prueba: { activo: boolean, trial: 'MANUAL' | 'SS_PERFORMANCE' },
 *     normal: { activo: boolean, share_to_feed: boolean, espera_min: number },
 *     historia: { activo: boolean, espera_min: number, cierre: 'reel' | 'historia' },
 *   },
 *   franjas: Franja[],
 *   antispam: { max_dia: number, max_dia_propias: number, gap_min: number, max_por_corrida: number, reserva_cupo: number },
 *   rampa: { inicio: string, escalones: Escalon[] } | null,
 *   voz: {
 *     proveedor: 'elevenlabs' | 'gemini', modelo: string, voice_id: string | null,
 *     ajustes: { stability: number, similarity_boost: number, style: number, use_speaker_boost?: boolean },
 *     pausas: { tras_hook: number, entre: number, antes_cta: number, coma: number, pregunta?: number, cola?: number },
 *     respaldo: { proveedor: 'gemini', voz: string, estilo: string } | null, presupuesto_mes: number,
 *   },
 *   marca: { paletas: string, fuentes: { titulo: string, cuerpo: string, mono: string }, tracking_titulo: number,
 *     motivos: ('cuaderno' | 'grilla' | 'luz' | 'pizarra' | 'papel')[], logo: string, radio: number, formatos: string[] },
 *   cierre: { texto_voz: string, texto_historia?: string | null, caption: string, clips: string, palabra_clave: string | null },
 *   captions: { hashtags_por_post: [number, number], hashtags_fijos: string[] },
 *   secretos: { ig_user: string, ig_token: string, ig_insights?: string | null },
 *   reglas_texto: { prohibidas: string[], max_palabras_voz: [number, number], sin_montos: boolean, fuentes_dominios: string[] | null },
 *   banco?: { guiones?: string, ideas?: string, hechos?: string, tono?: string },
 *   kairo: { seccion: string },
 * }} Cuenta
 */

export const ZONA = 'America/Argentina/Buenos_Aires'
export const IDIOMAS = ['es-AR', 'en-US']
export const MODOS = ['real', 'sombra']
export const TRIALS = ['MANUAL', 'SS_PERFORMANCE']
export const CIERRES_HISTORIA = ['reel', 'historia']
export const MOTIVOS = ['cuaderno', 'grilla', 'luz', 'pizarra', 'papel']
export const DESTINOS = ['prueba', 'normal', 'historia']
export const BANCO_POR_DEFECTO = { guiones: 'guiones', ideas: 'ideas.json', hechos: 'hechos.json', tono: 'TONO.md' }
export const DIAS_POR_ESCALON = 7

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const USUARIO_IG = /^[a-z0-9._]{1,30}$/
const VARIABLE = /^[A-Z][A-Z0-9_]*$/
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const DIA = /^\d{4}-\d{2}-\d{2}$/
const HASHTAG = /^[a-z0-9_]+$/

const CAMPOS = {
  raiz: ['version', 'id', 'usuario', 'idioma', 'activa', 'modo', 'creativos_por_dia', 'variantes_por_creativo', 'destinos', 'franjas', 'antispam', 'rampa', 'voz', 'marca', 'cierre', 'captions', 'secretos', 'reglas_texto', 'banco', 'kairo'],
  prueba: ['activo', 'trial'],
  normal: ['activo', 'share_to_feed', 'espera_min'],
  historia: ['activo', 'espera_min', 'cierre'],
  antispam: ['max_dia', 'max_dia_propias', 'gap_min', 'max_por_corrida', 'reserva_cupo'],
  voz: ['proveedor', 'modelo', 'voice_id', 'ajustes', 'pausas', 'respaldo', 'presupuesto_mes'],
  ajustes: ['stability', 'similarity_boost', 'style', 'use_speaker_boost'],
  pausas: ['tras_hook', 'entre', 'antes_cta', 'coma', 'pregunta', 'cola'],
  marca: ['paletas', 'fuentes', 'tracking_titulo', 'motivos', 'logo', 'radio', 'formatos'],
  cierre: ['texto_voz', 'texto_historia', 'caption', 'clips', 'palabra_clave'],
  captions: ['hashtags_por_post', 'hashtags_fijos'],
  secretos: ['ig_user', 'ig_token', 'ig_insights'],
  reglas_texto: ['prohibidas', 'max_palabras_voz', 'sin_montos', 'fuentes_dominios'],
  banco: ['guiones', 'ideas', 'hechos', 'tono'],
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const esObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {unknown} v @param {number} min @param {number} max */
const entero = (v, min, max) => Number.isInteger(v) && /** @type {number} */ (v) >= min && /** @type {number} */ (v) <= max
/** @param {unknown} v @param {number} min @param {number} max */
const numero = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
/** @param {unknown} v */
const texto = (v) => typeof v === 'string' && v.trim().length > 0
/** @param {unknown} v */
const rutaRelativa = (v) => texto(v) && !/^([a-zA-Z]:|[\\/])/.test(/** @type {string} */ (v)) && !/** @type {string} */ (v).split(/[\\/]/).includes('..')
/** @param {string} h */
const minutos = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

/** @param {unknown} v */
function diaValido(v) {
  if (typeof v !== 'string' || !DIA.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** @param {unknown} v */
const parDeEnteros = (v) => Array.isArray(v) && v.length === 2 && v.every((x) => entero(x, 0, 1000)) && v[0] <= v[1]

/** @param {Cuenta} c */
const destinosActivos = (c) => DESTINOS.filter((d) => c.destinos?.[d]?.activo === true).length

/**
 * Publicaciones propias que la cuenta planea por día: creativos × variantes × destinos activos.
 * @param {Cuenta} cuenta @param {{ creativos?: number, variantes?: number }} [cambio]
 */
export function accionesPorDia(cuenta, { creativos = cuenta.creativos_por_dia, variantes = cuenta.variantes_por_creativo } = {}) {
  return creativos * variantes * destinosActivos(cuenta)
}

/**
 * Los problemas de un cuenta.json, en castellano. Vacío = válida. Nunca tira.
 * @param {unknown} obj @returns {string[]}
 */
export function validarCuenta(obj) {
  if (!esObjeto(obj)) return ['la cuenta no es un objeto']
  const c = /** @type {Record<string, any>} */ (obj)
  /** @type {string[]} */
  const p = []
  const mal = (/** @type {string} */ m) => p.push(m)

  /** @param {Record<string, any>} o @param {string[]} permitidos @param {string} prefijo */
  const sobrantes = (o, permitidos, prefijo) => {
    for (const k of Object.keys(o)) if (!permitidos.includes(k)) mal(`${prefijo}${k}: campo desconocido`)
  }

  sobrantes(c, CAMPOS.raiz, '')
  if (c.version !== 1) mal(`version: tiene que ser 1 (vino ${JSON.stringify(c.version)})`)
  if (typeof c.id !== 'string' || !KEBAB.test(c.id)) mal('id: tiene que ser kebab-case (a-z, 0-9 y guiones)')
  if (typeof c.usuario !== 'string' || !USUARIO_IG.test(c.usuario)) mal('usuario: el usuario de Instagram sin @, en minúscula')
  if (!IDIOMAS.includes(c.idioma)) mal(`idioma: uno de ${IDIOMAS.join(', ')}`)
  if (typeof c.activa !== 'boolean') mal('activa: true o false')
  if (!MODOS.includes(c.modo)) mal(`modo: uno de ${MODOS.join(', ')}`)
  const creativosOk = entero(c.creativos_por_dia, 1, 10)
  if (!creativosOk) mal('creativos_por_dia: entero de 1 a 10')
  const variantesOk = entero(c.variantes_por_creativo, 1, 3)
  if (!variantesOk) mal('variantes_por_creativo: entero de 1 a 3')

  let destinosOk = false
  if (!esObjeto(c.destinos)) mal('destinos: falta el objeto con prueba, normal e historia')
  else {
    destinosOk = true
    sobrantes(c.destinos, DESTINOS, 'destinos.')
    for (const d of DESTINOS) {
      const v = c.destinos[d]
      if (!esObjeto(v)) {
        mal(`destinos.${d}: falta`)
        destinosOk = false
        continue
      }
      sobrantes(v, CAMPOS[d], `destinos.${d}.`)
      if (typeof v.activo !== 'boolean') mal(`destinos.${d}.activo: true o false`)
      if (d !== 'prueba' && !entero(v.espera_min, 0, 600)) mal(`destinos.${d}.espera_min: minutos enteros de 0 a 600`)
    }
    if (esObjeto(c.destinos.prueba) && !TRIALS.includes(c.destinos.prueba.trial)) mal(`destinos.prueba.trial: uno de ${TRIALS.join(', ')}`)
    if (esObjeto(c.destinos.normal) && typeof c.destinos.normal.share_to_feed !== 'boolean') mal('destinos.normal.share_to_feed: true o false')
    if (esObjeto(c.destinos.historia) && !CIERRES_HISTORIA.includes(c.destinos.historia.cierre)) mal(`destinos.historia.cierre: uno de ${CIERRES_HISTORIA.join(', ')}`)
    if (destinosOk && destinosActivos(/** @type {Cuenta} */ (c)) === 0) mal('destinos: ningún destino activo')
  }

  let franjasOk = false
  if (!Array.isArray(c.franjas) || c.franjas.length === 0) mal('franjas: al menos una { desde, hasta } en hora de Buenos Aires')
  else {
    franjasOk = true
    c.franjas.forEach((f, i) => {
      if (!esObjeto(f)) {
        mal(`franjas[${i}]: tiene que ser { desde, hasta }`)
        franjasOk = false
        return
      }
      for (const k of ['desde', 'hasta']) {
        if (typeof f[k] !== 'string' || !HORA.test(f[k])) {
          mal(`franjas[${i}].${k}: hora HH:MM de 00:00 a 23:59`)
          franjasOk = false
        }
      }
      if (franjasOk && minutos(f.desde) >= minutos(f.hasta)) {
        mal(`franjas[${i}]: desde tiene que ser antes que hasta`)
        franjasOk = false
      }
    })
    if (franjasOk) {
      for (let i = 1; i < c.franjas.length; i++) {
        if (minutos(c.franjas[i].desde) < minutos(c.franjas[i - 1].hasta)) {
          mal(`franjas[${i}]: se pisa con la anterior o no está en orden`)
          franjasOk = false
        }
      }
    }
  }

  let antispamOk = false
  if (!esObjeto(c.antispam)) mal('antispam: falta')
  else {
    const a = c.antispam
    sobrantes(a, CAMPOS.antispam, 'antispam.')
    antispamOk = true
    const chequear = (/** @type {string} */ k, /** @type {number} */ min, /** @type {number} */ max, /** @type {string} */ que) => {
      if (!entero(a[k], min, max)) {
        mal(`antispam.${k}: ${que}`)
        antispamOk = false
      }
    }
    chequear('max_dia', 1, 50, 'entero de 1 a 50 (propias y ajenas en 24 h)')
    chequear('max_dia_propias', 1, 50, 'entero de 1 a 50')
    chequear('gap_min', 0, 600, 'minutos enteros de 0 a 600')
    chequear('max_por_corrida', 1, 5, 'entero de 1 a 5')
    chequear('reserva_cupo', 0, 99, 'entero de 0 a 99 (el cupo de Meta es 100 por 24 h)')
    if (antispamOk && a.max_dia_propias > a.max_dia) mal('antispam.max_dia_propias: no puede pasar de max_dia')
  }

  if (creativosOk && variantesOk && destinosOk && antispamOk) {
    const planeadas = accionesPorDia(/** @type {Cuenta} */ (c))
    if (planeadas > c.antispam.max_dia_propias) mal(`publicaciones por día: ${planeadas} (creativos × variantes × destinos activos) pasan de antispam.max_dia_propias (${c.antispam.max_dia_propias})`)
    if (franjasOk) {
      const gap = Math.max(1, c.antispam.gap_min)
      const lugares = c.franjas.reduce((s, /** @type {any} */ f) => s + Math.floor((minutos(f.hasta) - minutos(f.desde)) / gap) + 1, 0)
      const tope = Math.min(planeadas, c.antispam.max_dia_propias)
      if (lugares < tope) mal(`franjas: ${tope} publicaciones con ${c.antispam.gap_min} min de gap no entran (hay lugar para ${lugares})`)
    }
  }

  if (c.rampa !== null && c.rampa !== undefined) {
    const r = c.rampa
    if (!esObjeto(r)) mal('rampa: null o { inicio, escalones }')
    else {
      if (!diaValido(r.inicio)) mal('rampa.inicio: fecha AAAA-MM-DD que exista')
      if (!Array.isArray(r.escalones) || r.escalones.length === 0) mal('rampa.escalones: al menos un escalón { creativos, acciones }')
      else {
        /** @type {any} */
        let previo = null
        r.escalones.forEach((/** @type {any} */ e, /** @type {number} */ i) => {
          const pre = `rampa.escalones[${i}]`
          if (!esObjeto(e) || !entero(e.creativos, 1, 10) || !entero(e.acciones, 1, 50) || (e.variantes !== undefined && !entero(e.variantes, 1, 3)) || (e.dias !== undefined && !entero(e.dias, 1, 90))) {
            mal(`${pre}: { creativos 1-10, acciones 1-50, variantes 1-3 opcional, dias opcional }`)
            return
          }
          const variantes = e.variantes ?? c.variantes_por_creativo
          if (creativosOk && e.creativos > c.creativos_por_dia) mal(`${pre}.creativos: pasa de creativos_por_dia (${c.creativos_por_dia})`)
          if (variantesOk && variantes > c.variantes_por_creativo) mal(`${pre}.variantes: pasa de variantes_por_creativo (${c.variantes_por_creativo})`)
          if (antispamOk && e.acciones > c.antispam.max_dia_propias) mal(`${pre}.acciones: pasa de antispam.max_dia_propias (${c.antispam.max_dia_propias})`)
          if (destinosOk && variantesOk) {
            const necesita = accionesPorDia(/** @type {Cuenta} */ (c), { creativos: e.creativos, variantes })
            if (necesita > e.acciones) mal(`${pre}: ${e.acciones} acciones no alcanzan para ${e.creativos} creativos × ${variantes} variantes (${necesita})`)
          }
          if (previo && (e.creativos < previo.creativos || e.acciones < previo.acciones || variantes < previo.variantes)) mal(`${pre}: baja respecto del anterior (la rampa sólo sube)`)
          previo = { creativos: e.creativos, acciones: e.acciones, variantes }
        })
      }
    }
  }

  if (!esObjeto(c.voz)) mal('voz: falta')
  else {
    const v = c.voz
    sobrantes(v, CAMPOS.voz, 'voz.')
    if (!['elevenlabs', 'gemini'].includes(v.proveedor)) mal('voz.proveedor: elevenlabs o gemini')
    if (!texto(v.modelo)) mal('voz.modelo: falta')
    if (v.voice_id === null) {
      if (c.activa === true) mal('voz.voice_id: falta y la cuenta está activa (null sólo con activa: false, hasta la audición)')
    } else if (!texto(v.voice_id)) mal('voz.voice_id: texto o null')
    if (!esObjeto(v.ajustes)) mal('voz.ajustes: falta')
    else {
      sobrantes(v.ajustes, CAMPOS.ajustes, 'voz.ajustes.')
      for (const k of ['stability', 'similarity_boost', 'style']) if (!numero(v.ajustes[k], 0, 1)) mal(`voz.ajustes.${k}: número de 0 a 1`)
      if (v.ajustes.use_speaker_boost !== undefined && typeof v.ajustes.use_speaker_boost !== 'boolean') mal('voz.ajustes.use_speaker_boost: true o false')
    }
    if (!esObjeto(v.pausas)) mal('voz.pausas: falta')
    else {
      sobrantes(v.pausas, CAMPOS.pausas, 'voz.pausas.')
      for (const k of ['tras_hook', 'entre', 'antes_cta', 'coma']) if (!numero(v.pausas[k], 0, 3)) mal(`voz.pausas.${k}: segundos de 0 a 3`)
      for (const k of ['pregunta', 'cola']) if (v.pausas[k] !== undefined && !numero(v.pausas[k], 0, 3)) mal(`voz.pausas.${k}: segundos de 0 a 3`)
    }
    if (v.respaldo !== null && (!esObjeto(v.respaldo) || v.respaldo.proveedor !== 'gemini' || !texto(v.respaldo.voz) || !texto(v.respaldo.estilo))) mal('voz.respaldo: null o { proveedor: "gemini", voz, estilo }')
    if (!entero(v.presupuesto_mes, 0, 10_000_000)) mal('voz.presupuesto_mes: caracteres por mes, entero ≥ 0')
  }

  if (!esObjeto(c.marca)) mal('marca: falta')
  else {
    const m = c.marca
    sobrantes(m, CAMPOS.marca, 'marca.')
    if (!rutaRelativa(m.paletas)) mal('marca.paletas: ruta relativa a la carpeta de la cuenta')
    if (!rutaRelativa(m.logo)) mal('marca.logo: ruta relativa a la carpeta de la cuenta')
    if (!esObjeto(m.fuentes)) mal('marca.fuentes: { titulo, cuerpo, mono }')
    else {
      sobrantes(m.fuentes, ['titulo', 'cuerpo', 'mono'], 'marca.fuentes.')
      for (const k of ['titulo', 'cuerpo', 'mono']) if (!rutaRelativa(m.fuentes[k])) mal(`marca.fuentes.${k}: ruta relativa a la carpeta de la cuenta`)
    }
    if (!numero(m.tracking_titulo, -0.2, 0.2)) mal('marca.tracking_titulo: em de -0.2 a 0.2')
    if (!Array.isArray(m.motivos) || m.motivos.length < 1 || m.motivos.length > 3 || !m.motivos.every((/** @type {any} */ x) => MOTIVOS.includes(x)) || new Set(m.motivos).size !== m.motivos.length) mal(`marca.motivos: 1 a 3 distintos de ${MOTIVOS.join(', ')}`)
    if (!numero(m.radio, 0, 200)) mal('marca.radio: px de 0 a 200')
    if (!Array.isArray(m.formatos) || m.formatos.length === 0 || !m.formatos.every((/** @type {any} */ f) => typeof f === 'string' && KEBAB.test(f))) mal('marca.formatos: al menos un formato (carpeta de formatos/)')
  }

  if (!esObjeto(c.cierre)) mal('cierre: falta')
  else {
    const k = c.cierre
    sobrantes(k, CAMPOS.cierre, 'cierre.')
    if (!texto(k.texto_voz)) mal('cierre.texto_voz: lo que dice la voz del cierre')
    if (!texto(k.caption) || k.caption.length > 300) mal('cierre.caption: texto de hasta 300 caracteres')
    if (!rutaRelativa(k.clips)) mal('cierre.clips: ruta relativa a la carpeta de la cuenta')
    if (k.palabra_clave !== null && (typeof k.palabra_clave !== 'string' || !/^[A-Z0-9]{2,20}$/.test(k.palabra_clave))) mal('cierre.palabra_clave: null o una palabra en mayúscula')
    const historiaPropia = esObjeto(c.destinos?.historia) && c.destinos.historia.cierre === 'historia'
    if (k.texto_historia !== null && k.texto_historia !== undefined && !texto(k.texto_historia)) mal('cierre.texto_historia: texto o null')
    else if (historiaPropia && !texto(k.texto_historia)) mal('cierre.texto_historia: falta y destinos.historia.cierre es "historia"')
  }

  if (!esObjeto(c.captions)) mal('captions: falta')
  else {
    sobrantes(c.captions, CAMPOS.captions, 'captions.')
    if (!parDeEnteros(c.captions.hashtags_por_post) || c.captions.hashtags_por_post[1] > 30) mal('captions.hashtags_por_post: [mínimo, máximo], hasta 30')
    if (!Array.isArray(c.captions.hashtags_fijos) || !c.captions.hashtags_fijos.every((/** @type {any} */ h) => typeof h === 'string' && HASHTAG.test(h))) mal('captions.hashtags_fijos: lista de hashtags sin #, en minúscula')
  }

  if (!esObjeto(c.secretos)) mal('secretos: falta')
  else {
    sobrantes(c.secretos, CAMPOS.secretos, 'secretos.')
    for (const k of ['ig_user', 'ig_token']) if (typeof c.secretos[k] !== 'string' || !VARIABLE.test(c.secretos[k])) mal(`secretos.${k}: el NOMBRE del secreto de GitHub (MAYÚSCULAS_CON_GUION_BAJO), nunca el valor`)
    if (c.secretos.ig_insights !== null && c.secretos.ig_insights !== undefined && (typeof c.secretos.ig_insights !== 'string' || !VARIABLE.test(c.secretos.ig_insights))) mal('secretos.ig_insights: null o el nombre del secreto')
  }

  if (!esObjeto(c.reglas_texto)) mal('reglas_texto: falta')
  else {
    const r = c.reglas_texto
    sobrantes(r, CAMPOS.reglas_texto, 'reglas_texto.')
    if (!Array.isArray(r.prohibidas) || !r.prohibidas.every(texto)) mal('reglas_texto.prohibidas: lista de palabras (puede ser vacía)')
    if (!parDeEnteros(r.max_palabras_voz)) mal('reglas_texto.max_palabras_voz: [mínimo, máximo]')
    if (typeof r.sin_montos !== 'boolean') mal('reglas_texto.sin_montos: true o false')
    if (r.fuentes_dominios !== null && (!Array.isArray(r.fuentes_dominios) || r.fuentes_dominios.length === 0 || !r.fuentes_dominios.every(texto))) mal('reglas_texto.fuentes_dominios: null o una lista no vacía de dominios')
  }

  if (c.banco !== undefined) {
    if (!esObjeto(c.banco)) mal('banco: objeto con guiones, ideas, hechos, tono')
    else {
      sobrantes(c.banco, CAMPOS.banco, 'banco.')
      for (const [k, v] of Object.entries(c.banco)) if (!rutaRelativa(v)) mal(`banco.${k}: ruta relativa a la carpeta de la cuenta`)
    }
  }

  if (!esObjeto(c.kairo) || !texto(c.kairo.seccion)) mal('kairo.seccion: la sección del tablero')
  else sobrantes(c.kairo, ['seccion'], 'kairo.')

  return p
}

/** @param {string} raiz */
const dirCuentas = (raiz) => join(raiz, 'cuentas')

/** @param {string} id @param {string} raiz */
export function dirCuenta(id, raiz) {
  if (typeof id !== 'string' || !KEBAB.test(id)) throw new Error(`id de cuenta inválido: ${JSON.stringify(id)}`)
  return join(dirCuentas(raiz), id)
}

/**
 * Los ids de cuentas/<id>/cuenta.json, ordenados. Las carpetas que empiezan con _ o . no son cuentas.
 * @param {string} raiz @returns {string[]}
 */
export function listarCuentas(raiz) {
  const dir = dirCuentas(raiz)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && KEBAB.test(e.name) && existsSync(join(dir, e.name, 'cuenta.json')))
    .map((e) => e.name)
    .sort()
}

/**
 * Lee y valida cuentas/<id>/cuenta.json. Tira con todos los problemas juntos: una cuenta mal
 * configurada no corre a medias.
 * @param {string} id @param {string} raiz @returns {Cuenta}
 */
export function cargarCuenta(id, raiz) {
  const ruta = join(dirCuenta(id, raiz), 'cuenta.json')
  if (!existsSync(ruta)) throw new Error(`la cuenta ${id} no existe (${ruta})`)
  /** @type {unknown} */
  let obj
  try {
    obj = JSON.parse(readFileSync(ruta, 'utf8'))
  } catch (e) {
    throw new Error(`cuentas/${id}/cuenta.json no es JSON válido: ${/** @type {Error} */ (e).message}`)
  }
  const problemas = validarCuenta(obj)
  if (problemas.length) throw new Error(`cuentas/${id}/cuenta.json tiene problemas:\n- ${problemas.join('\n- ')}`)
  const c = /** @type {Cuenta} */ (obj)
  if (c.id !== id) throw new Error(`cuentas/${id}/cuenta.json: el id "${c.id}" no coincide con la carpeta`)
  return { ...c, banco: { ...BANCO_POR_DEFECTO, ...(c.banco ?? {}) } }
}

const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' })

/** @param {Date | string} fecha */
const diaAR = (fecha) => (typeof fecha === 'string' ? fecha.slice(0, 10) : FORMATO_DIA.format(fecha))

/** @param {string} a @param {string} b */
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/**
 * Cuánto le toca a la cuenta el día `fecha` (día de Buenos Aires). Sin rampa, lo de la cuenta
 * (escalon null). Con rampa, el escalón del calendario (7 días cada uno, o su `dias`), nunca más
 * alto que el que sostiene el estado tras un antispam; antes del inicio, nada (escalon -1).
 * No mira `activa` ni `modo`: eso lo decide planear.
 * @param {Cuenta} cuenta @param {Date | string} fecha @param {{ escalon?: number | null }} [estadoRampa]
 * @returns {{ creativos: number, variantes: number, acciones: number, escalon: number | null }}
 */
export function porDiaHoy(cuenta, fecha, { escalon: sostenido = null } = {}) {
  const r = cuenta.rampa
  if (!r) return { creativos: cuenta.creativos_por_dia, variantes: cuenta.variantes_por_creativo, acciones: Math.min(accionesPorDia(cuenta), cuenta.antispam.max_dia_propias), escalon: null }
  const dias = diasEntre(r.inicio, diaAR(fecha))
  const variantesDe = (/** @type {number} */ i) => r.escalones[i]?.variantes ?? cuenta.variantes_por_creativo
  if (dias < 0) return { creativos: 0, variantes: variantesDe(0), acciones: 0, escalon: -1 }
  let i = 0
  let resto = dias
  while (i < r.escalones.length - 1 && resto >= (r.escalones[i].dias ?? DIAS_POR_ESCALON)) {
    resto -= r.escalones[i].dias ?? DIAS_POR_ESCALON
    i++
  }
  if (typeof sostenido === 'number' && sostenido >= 0) i = Math.min(i, sostenido, r.escalones.length - 1)
  const e = r.escalones[i]
  return { creativos: e.creativos, variantes: variantesDe(i), acciones: e.acciones, escalon: i }
}

/** La variable del repo que pausa sólo esta cuenta. @param {string} id */
export const variablePausa = (id) => `FABRICA_PAUSADA_${id.toUpperCase().replace(/-/g, '_')}`
