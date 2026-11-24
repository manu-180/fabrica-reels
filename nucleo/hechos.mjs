// @ts-check
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CLAVE, cargarFormato, cifrasSinRespaldo, leerGuiones, revisarEstricto } from './banco.mjs'

/**
 * El revisor de hechos (diseño § 4.2 y § 4.3): cada hecho con una fuente que se puede verificar, y
 * ninguna idea ni guion que se apoye en un hecho que no existe. También el revisor de las tandas que
 * escriben los agentes de `agentes/` (ideas y guiones), que suma al estricto de `banco.mjs` lo que
 * sale del lado automático: ideas y hechos de la rama `estado`, duplicados y datos personales.
 * @typedef {import('./cuenta.mjs').Cuenta} Cuenta
 * @typedef {import('./banco.mjs').Hecho} Hecho
 * @typedef {import('./banco.mjs').Idea} Idea
 * @typedef {(repo: string, archivo: string) => string | null} LeerFuente
 */

export const TIPOS = ['dato', 'oferta', 'producto', 'norma']
export const ORIGENES = ['hechos', 'dolor', 'rendimiento', 'temporada']
// Igual que el estricto de banco.mjs para las ideas de calcular: una cifra tiene respaldo si está a 60
// líneas de la citada. Un hecho nuevo del agente tiene que estar mucho más cerca de su línea.
export const VENTANA_EXISTENTE = 60
export const VENTANA_PROPUESTO = 8

/** @param {string} t */
const normalizar = (t) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** "MM-DD" que existe en algún año. @param {unknown} t */
function mesDia(t) {
  if (typeof t !== 'string' || !/^\d{2}-\d{2}$/.test(t)) return false
  const [mes = 0, dia = 0] = t.split('-').map(Number)
  const d = new Date(Date.UTC(2024, mes - 1, dia))
  return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
}

/**
 * La fuente de un hecho, desarmada.
 * @param {unknown} f
 * @returns {{ tipo: 'repo', repo: string, archivo: string, linea: number } | { tipo: 'url', url: string } | { tipo: 'manuel', fecha: string } | null}
 */
export function leerFuente(f) {
  if (typeof f !== 'string') return null
  const repo = /^repo:([\w.-]+\/[\w.-]+):(.+):(\d+)$/.exec(f)
  if (repo) return { tipo: 'repo', repo: String(repo[1]), archivo: String(repo[2]), linea: Number(repo[3]) }
  const manuel = /^manuel:(\d{4}-\d{2}-\d{2})$/.exec(f)
  if (manuel && !Number.isNaN(Date.parse(String(manuel[1])))) return { tipo: 'manuel', fecha: String(manuel[1]) }
  if (/^https:\/\//.test(f)) {
    try {
      return { tipo: 'url', url: new URL(f).href }
    } catch {
      return null
    }
  }
  return null
}

/** Las formas en que una cifra puede estar escrita en el código: "27.329", "27329", "0,5", "0.5". @param {string} c */
const formas = (c) => [...new Set([c, c.replace(/\./g, ''), c.replace(',', '.'), c.replace(/\./g, '').replace(',', '.'), c.replace(/%$/, '')])]

/** Si la cifra está en el texto sin ser parte de un número más largo. @param {string} cifra @param {string} texto */
export function cifraEn(cifra, texto) {
  const t = normalizar(texto).replace(/_/g, '')
  return formas(normalizar(cifra).trim()).some((v) => v && new RegExp(`(^|[^\\d])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\d]|$)`).test(t))
}

/**
 * Lo que le falta a un hecho. Con `leer`, una fuente `repo:` se abre: la línea tiene que existir y cada
 * cifra tiene que estar a `ventana` líneas o menos. Sin el repo a mano, la fuente se revisa sólo de forma
 * y lo dice `sin_verificar`.
 * @param {any} h @param {{ leer?: LeerFuente | null, ventana?: number }} [o]
 * @returns {{ problemas: string[], sin_verificar: boolean }}
 */
export function validarHecho(h, { leer = null, ventana = VENTANA_EXISTENTE } = {}) {
  /** @type {string[]} */
  const p = []
  if (!h || typeof h !== 'object' || Array.isArray(h)) return { problemas: ['no es un objeto'], sin_verificar: false }
  if (typeof h.id !== 'string' || !CLAVE.test(h.id)) p.push('id: kebab-case')
  if (!TIPOS.includes(h.tipo)) p.push(`tipo: ${TIPOS.join(' | ')}`)
  if (typeof h.texto !== 'string' || !h.texto.trim()) p.push('texto vacío')
  if (!Array.isArray(h.cifras) || h.cifras.some((/** @type {unknown} */ c) => typeof c !== 'string' || !c.trim())) p.push('cifras: lista de textos')
  if (h.envejece !== null && typeof h.envejece !== 'string' && h.envejece !== true && h.envejece !== false) p.push('envejece: null, true o un texto')
  const f = leerFuente(h.fuente)
  if (!f) p.push('fuente: "repo:<dueño>/<repo>:<archivo>:<línea>", "https://..." o "manuel:AAAA-MM-DD"')
  if (typeof h.texto === 'string' && datosPersonales(h.texto).length) p.push(`texto: ${datosPersonales(h.texto).join(', ')}`)
  let sinVerificar = f?.tipo !== 'repo'
  if (f?.tipo === 'repo' && Array.isArray(h.cifras)) {
    const texto = leer ? leer(f.repo, f.archivo) : null
    if (texto === null) sinVerificar = true
    else {
      const lineas = texto.split('\n')
      if (f.linea < 1 || f.linea > lineas.length) p.push(`fuente: ${f.archivo} tiene ${lineas.length} líneas, no ${f.linea}`)
      else {
        const cerca = lineas.slice(Math.max(0, f.linea - 1 - ventana), f.linea + ventana).join('\n')
        for (const c of h.cifras) if (typeof c === 'string' && !cifraEn(c, cerca)) p.push(`cifra ${c} no está a ${ventana} líneas de ${f.archivo}:${f.linea}`)
      }
    }
  }
  return { problemas: p, sin_verificar: sinVerificar }
}

/**
 * Todos los hechos de una lista: los de cada uno y los ids repetidos.
 * @param {any[]} lista @param {{ leer?: LeerFuente | null, ventana?: number }} [o]
 * @returns {{ id: string, problemas: string[], sin_verificar: boolean }[]}
 */
export function validarHechos(lista, o = {}) {
  const vistos = new Set()
  return lista.map((h, i) => {
    const r = validarHecho(h, o)
    const id = typeof h?.id === 'string' ? h.id : `#${i}`
    if (vistos.has(id)) r.problemas.push('id repetido')
    vistos.add(id)
    return { id, ...r }
  })
}

const MAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const ARROBA = /(^|[\s"(])@[a-z0-9._]{2,}/i
const TELEFONO = /(?<!\d)\+?\d(?:[\s()-]*\d){7,14}(?!\d)/
const URL_SUELTA = /\bhttps?:\/\/\S+|\bwww\.\S+/i

/** Datos de contacto en un texto (el repo es público: diseño § 2). @param {string} t @returns {string[]} */
export function datosPersonales(t) {
  /** @type {string[]} */
  const p = []
  if (MAIL.test(t)) p.push('trae un mail')
  if (ARROBA.test(t.replace(new RegExp(MAIL, 'gi'), ' '))) p.push('trae un @usuario')
  if (TELEFONO.test(t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' '))) p.push('trae algo que parece un teléfono')
  if (URL_SUELTA.test(t)) p.push('trae una URL')
  return p
}

/** @param {string} t */
const palabras = (t) => new Set(normalizar(t).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3))

/** Jaccard de las palabras de más de tres letras. @param {string} a @param {string} b */
export function parecido(a, b) {
  const x = palabras(a)
  const y = palabras(b)
  if (!x.size || !y.size) return 0
  let comun = 0
  for (const w of x) if (y.has(w)) comun++
  return comun / (x.size + y.size - comun)
}

/** Dos ideas son la misma si dicen lo mismo con otras palabras o si cuentan lo mismo con los mismos hechos. */
export const UMBRAL_DUPLICADA = 0.6

/** @param {Idea & { idea?: string }} i */
const textoIdea = (i) => `${i.idea ?? ''} ${i.angulo ?? ''}`

/**
 * Si una idea nueva repite una existente: el mismo id, el mismo texto (o casi), o el mismo tema, ángulo y hechos.
 * @param {any} nueva @param {Iterable<any>} existentes @returns {string | null} el id de la que repite
 */
export function repiteA(nueva, existentes) {
  const firma = (/** @type {any} */ i) => `${i.tema}|${i.angulo}|${[...(i.hechos ?? [])].sort().join(',')}`
  for (const e of existentes) {
    if (e.id === nueva.id) return e.id
    if (firma(e) === firma(nueva)) return e.id
    if (parecido(textoIdea(nueva), textoIdea(e)) >= UMBRAL_DUPLICADA) return e.id
  }
  return null
}

/**
 * Lo que le falta a una idea nueva: el esquema de CONTRATO.md § 1, sus hechos (todos tienen que
 * existir y tiene que citar al menos uno: una idea sin hechos es una idea "de la nada"), ninguna
 * cifra que no esté en esos hechos, ningún dato personal, y el `origen_repo` si la cuenta lo exige.
 * @param {any} i
 * @param {{ cuenta: Cuenta, hechos: Map<string, Hecho>, exigirOrigenRepo?: boolean, leerRepo?: ((archivo: string) => string | null) | null }} c
 * @returns {string[]}
 */
export function validarIdea(i, { cuenta, hechos, exigirOrigenRepo = false, leerRepo = null }) {
  if (!i || typeof i !== 'object' || Array.isArray(i)) return ['no es un objeto']
  /** @type {string[]} */
  const p = []
  if (typeof i.id !== 'string' || !CLAVE.test(i.id)) p.push('id: kebab-case')
  if (typeof i.tema !== 'string' || !CLAVE.test(i.tema)) p.push('tema: kebab-case')
  if (typeof i.idea !== 'string' || !i.idea.trim() || i.idea.length > 160) p.push('idea: de 1 a 160 caracteres')
  if (typeof i.angulo !== 'string' || !i.angulo.trim()) p.push('angulo vacío')
  if (!cuenta.marca.formatos.includes(i.formato_sugerido)) p.push(`formato_sugerido: ${cuenta.marca.formatos.join(' | ')}`)
  if (!ORIGENES.includes(i.origen)) p.push(`origen: ${ORIGENES.join(' | ')}`)
  if (i.ventana !== null && i.ventana !== undefined && !(mesDia(i.ventana?.desde) && mesDia(i.ventana?.hasta))) p.push('ventana: null o { desde: "MM-DD", hasta: "MM-DD" }')
  if (i.origen === 'temporada' && !i.ventana) p.push('una idea de temporada lleva ventana')
  if (i.formato_sugerido === 'cuenta-regresiva' && !i.ventana) p.push('una cuenta regresiva necesita una fecha: lleva ventana')
  if (!Array.isArray(i.hechos) || !i.hechos.length) p.push('hechos: al menos uno (una idea sin hechos no se escribe)')
  else for (const h of i.hechos) if (!hechos.has(h)) p.push(`hechos: "${h}" no existe`)
  const texto = [i.idea, i.angulo, i.dato].filter((x) => typeof x === 'string').join('. ')
  p.push(...datosPersonales(texto))
  if (Array.isArray(i.hechos)) {
    const sueltas = cifrasSinRespaldo({ guion: { voz: texto, hechos: i.hechos }, hechos, idioma: cuenta.idioma })
    if (sueltas.length) p.push(`cifras que no están en sus hechos: ${sueltas.join(', ')}`)
  }
  if (exigirOrigenRepo || i.origen_repo !== undefined) {
    const m = /^(.+):(\d+)$/.exec(String(i.origen_repo ?? ''))
    if (!m) p.push('origen_repo: "archivo:línea"')
    else if (leerRepo) {
      const t = leerRepo(String(m[1]))
      if (t === null) p.push(`origen_repo: no existe ${m[1]}`)
      else if (Number(m[2]) < 1 || Number(m[2]) > t.split('\n').length) p.push(`origen_repo: ${m[1]} no tiene la línea ${m[2]}`)
    }
  }
  return p
}

/**
 * Las ideas y guiones que se apoyan en un hecho que no existe (para correr sobre toda la cuenta).
 * @param {{ ideas: Iterable<any>, guiones: Iterable<{ archivo: string, guion: any }>, hechos: Map<string, Hecho> }} p
 * @returns {string[]}
 */
export function referenciasRotas({ ideas, guiones, hechos }) {
  /** @type {string[]} */
  const p = []
  for (const i of ideas) for (const h of Array.isArray(i?.hechos) ? i.hechos : []) if (!hechos.has(h)) p.push(`idea ${i.id}: el hecho "${h}" no existe`)
  for (const { archivo, guion } of guiones) for (const h of Array.isArray(guion?.hechos) ? guion.hechos : []) if (!hechos.has(h)) p.push(`${archivo}: el hecho "${h}" no existe`)
  return p
}

/**
 * Separa una tanda de ideas del agente en las que entran y las que no, con el motivo. Revisa cada una
 * contra los hechos (los de la cuenta más los nuevos ya aceptados) y la deduplica contra todas las
 * existentes y contra las anteriores de la misma tanda.
 * @param {{ nuevas: any[], existentes: any[], cuenta: Cuenta, hechos: Map<string, Hecho>, exigirOrigenRepo?: boolean, leerRepo?: ((archivo: string) => string | null) | null }} p
 * @returns {{ aceptadas: any[], descartadas: { id: string, motivo: string }[] }}
 */
export function revisarIdeas({ nuevas, existentes, cuenta, hechos, exigirOrigenRepo = false, leerRepo = null }) {
  const vistas = [...existentes]
  /** @type {any[]} */
  const aceptadas = []
  /** @type {{ id: string, motivo: string }[]} */
  const descartadas = []
  for (const i of nuevas) {
    const id = typeof i?.id === 'string' ? i.id : '(sin id)'
    const p = validarIdea(i, { cuenta, hechos, exigirOrigenRepo, leerRepo })
    if (p.length) {
      descartadas.push({ id, motivo: p.join('; ') })
      continue
    }
    const igual = repiteA(i, vistas)
    if (igual) {
      descartadas.push({ id, motivo: `repite la idea ${igual}` })
      continue
    }
    const limpia = { ...i, ventana: i.ventana ?? null }
    aceptadas.push(limpia)
    vistas.push(limpia)
  }
  return { aceptadas, descartadas }
}

/**
 * Los hechos que propone el agente de ideas: entran solos sólo los de un repo que se pudo abrir, con la
 * línea y las cifras en su lugar, y nunca uno de la oferta (lo que se le promete a un cliente lo decide
 * Manuel). El resto queda pendiente con su motivo.
 * @param {{ propuestos: any[], existentes: Map<string, Hecho>, leer: LeerFuente | null }} p
 * @returns {{ aceptados: Hecho[], pendientes: (any & { motivo: string })[] }}
 */
export function revisarHechosPropuestos({ propuestos, existentes, leer }) {
  /** @type {Hecho[]} */
  const aceptados = []
  /** @type {any[]} */
  const pendientes = []
  for (const h of propuestos) {
    const { problemas, sin_verificar } = validarHecho(h, { leer, ventana: VENTANA_PROPUESTO })
    const id = h?.id
    const motivo = existentes.has(id) || aceptados.some((a) => a.id === id) ? 'el id ya existe'
      : problemas.length ? problemas.join('; ')
      : h.tipo === 'oferta' ? 'un hecho de la oferta lo carga Manuel a mano'
      : sin_verificar ? 'fuente sin verificar (no es de un repo que se pudo abrir)'
      : null
    if (motivo) pendientes.push({ ...h, motivo })
    else aceptados.push({ id: h.id, tipo: h.tipo, texto: h.texto, cifras: h.cifras, fuente: h.fuente, envejece: h.envejece ?? null })
  }
  return { aceptados, pendientes }
}

/**
 * Une dos listas por id: lo de `nuevas` no pisa lo que ya estaba (lo que el estado ya tiene manda).
 * @template {{ id: string }} T @param {T[]} base @param {T[]} nuevas @returns {T[]}
 */
export function unirPorId(base, nuevas) {
  const ids = new Set(base.map((x) => x.id))
  return [...base, ...nuevas.filter((x) => !ids.has(x.id))]
}

// La fecha de una cuenta regresiva (AAAA-MM-DD) y los `dias` de cada paso no son cifras que el reel
// afirma: son el calendario del layout, y el estricto de banco.mjs las lee como un teléfono y como
// cifras sueltas. La fecha sí se revisa acá: su día tiene que estar en un hecho citado. Lo que dice la
// voz ("el dieciocho de diciembre") lo sigue revisando el estricto.
/** @param {any} g */
function sinCalendario(g) {
  if (g?.formato !== 'cuenta-regresiva' || !g.contenido) return g
  const contenido = { ...g.contenido, fecha: undefined, pasos: Array.isArray(g.contenido.pasos) ? g.contenido.pasos.map((/** @type {any} */ x) => ({ ...x, dias: undefined })) : g.contenido.pasos }
  return { ...g, contenido }
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** Si la fecha de la cuenta regresiva está en alguno de los hechos que cita. @param {string} fecha @param {Hecho[]} citados */
export function fechaRespaldada(fecha, citados) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  if (!m) return false
  const [, , mm, dd] = m
  const dia = String(Number(dd))
  const mes = Number(mm) - 1
  const formasFecha = [fecha, `${mm}-${dd}`, `${dd}/${mm}`, `${dia}/${Number(mm)}`, `${dia} de ${MESES[mes]}`, `${MONTHS[mes]} ${dia}`]
  return citados.some((h) => {
    const t = normalizar(`${h.texto} ${h.cifras.join(' ')}`)
    return formasFecha.some((f) => t.includes(normalizar(f)))
  })
}

/**
 * Revisa una tanda de guiones del agente: lo del pipeline, el `validar()` del formato, el estricto de
 * banco.mjs (con las ideas y hechos de la rama `estado` sumados a los de main), y además: que tenga
 * `idea`, que no repita la clave ni los hooks de un guion existente y, en una cuenta regresiva, que la
 * fecha esté en un hecho.
 * @param {{ cuenta: Cuenta, dir: string, dirFormatos: string, ideas: Map<string, Idea>, hechos: Map<string, Hecho>, paletas: string[],
 *   existentes: any[], leerRepo?: ((archivo: string) => string | null) | null }} p
 * @returns {Promise<{ archivo: string, problemas: string[] }[]>}
 */
export async function revisarTanda({ cuenta, dir, dirFormatos, ideas, hechos, paletas, existentes, leerRepo = null }) {
  const claves = new Set(existentes.map((g) => g?.clave))
  const hooks = new Set(existentes.flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks.map((h) => normalizar(String(h)).trim()) : [])))
  /** @type {{ archivo: string, problemas: string[] }[]} */
  const salida = []
  for (const { archivo, guion, problemas } of leerGuiones(dir, { cuenta, ideas, hechos, paletas })) {
    const p = [...problemas]
    if (guion) {
      try {
        p.push(...(await cargarFormato(dirFormatos, guion.formato)).validar(guion))
      } catch (e) {
        p.push(`formato ${guion.formato}: ${/** @type {Error} */ (e).message}`)
      }
      if (typeof guion.idea !== 'string' || !ideas.has(guion.idea)) p.push('idea: tiene que ser una idea existente')
      p.push(...revisarEstricto({ guion: sinCalendario(guion), cuenta, hechos, ideas, leerRepo }))
      if (guion.formato === 'cuenta-regresiva' && typeof guion.contenido?.fecha === 'string') {
        const idea = ideas.get(guion.idea)
        const citados = [...(guion.hechos ?? []), ...(idea?.hechos ?? [])].map((/** @type {string} */ id) => hechos.get(id)).filter((h) => h !== undefined)
        if (!fechaRespaldada(guion.contenido.fecha, /** @type {Hecho[]} */ (citados))) p.push(`la fecha ${guion.contenido.fecha} no está en los hechos que cita`)
      }
      if (claves.has(guion.clave)) p.push(`la clave ${guion.clave} ya existe`)
      const repetidos = (Array.isArray(guion.hooks) ? guion.hooks : []).filter((/** @type {unknown} */ h) => hooks.has(normalizar(String(h)).trim()))
      if (repetidos.length) p.push(`repite hooks de otro guion: ${repetidos.join(' / ')}`)
    }
    salida.push({ archivo, problemas: [...new Set(p)] })
  }
  return salida
}

/** Los JSON de un directorio, sin los que no se pueden leer. @param {string} dir */
export function leerCarpeta(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(join(dir, f), 'utf8'))]
      } catch {
        return []
      }
    })
}
