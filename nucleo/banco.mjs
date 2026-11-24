// @ts-check
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cargarCuenta, dirCuenta } from './cuenta.mjs'
import { historialGuion } from './elegir.mjs'
import { azar, mezclar } from './tiempo.mjs'

/**
 * El banco de una cuenta: guiones, ideas, hechos, el revisor estricto (diseño § 4.4) y los captions.
 * @typedef {import('./cuenta.mjs').Cuenta} Cuenta
 * @typedef {{ id: string, tipo: 'dato' | 'oferta' | 'producto' | 'norma', texto: string, cifras: string[], fuente: string, envejece: string | null }} Hecho
 * @typedef {{ id: string, tema: string, angulo?: string, formato_sugerido?: string, hechos?: string[], ventana?: any, origen?: string, dato?: string, origen_repo?: string }} Idea
 * @typedef {{ archivo: string, guion: any, problemas: string[] }} GuionLeido
 */

export const CLAVE = /^[a-z0-9]+(-[a-z0-9]+)*$/


/** @param {string} ruta */
function leerJson(ruta) {
  return JSON.parse(readFileSync(ruta, 'utf8'))
}

/** Las ideas por id; sin archivo, vacío; uno roto tira. @param {string | null | undefined} texto @returns {Map<string, Idea>} */
export function leerIdeas(texto) {
  if (!texto || !texto.trim()) return new Map()
  const d = JSON.parse(texto)
  const lista = Array.isArray(d) ? d : Array.isArray(d?.ideas) ? d.ideas : []
  return new Map(lista.filter((/** @type {any} */ i) => typeof i?.id === 'string').map((/** @type {any} */ i) => [i.id, i]))
}

/** Los hechos por id; sin archivo, vacío; uno roto tira. @param {string | null | undefined} texto @returns {Map<string, Hecho>} */
export function leerHechos(texto) {
  if (!texto || !texto.trim()) return new Map()
  const d = JSON.parse(texto)
  const lista = Array.isArray(d) ? d : Array.isArray(d?.hechos) ? d.hechos : []
  return new Map(lista.filter((/** @type {any} */ h) => typeof h?.id === 'string').map((/** @type {any} */ h) => [h.id, { ...h, cifras: Array.isArray(h.cifras) ? h.cifras.map(String) : [] }]))
}

/**
 * Lo que la cuenta tiene para escribir guiones, leído de su carpeta.
 * @param {Cuenta} cuenta @param {string} raiz
 * @returns {{ ideas: Map<string, Idea>, hechos: Map<string, Hecho>, paletas: string[], dirGuiones: string }}
 */
export function leerBancoCuenta(cuenta, raiz) {
  const dir = dirCuenta(cuenta.id, raiz)
  const banco = cuenta.banco ?? {}
  const rutaIdeas = join(dir, banco.ideas ?? 'ideas.json')
  const rutaHechos = join(dir, banco.hechos ?? 'hechos.json')
  const rutaPaletas = join(dir, cuenta.marca.paletas)
  return {
    ideas: leerIdeas(existsSync(rutaIdeas) ? readFileSync(rutaIdeas, 'utf8') : ''),
    hechos: leerHechos(existsSync(rutaHechos) ? readFileSync(rutaHechos, 'utf8') : ''),
    paletas: existsSync(rutaPaletas) ? Object.keys(leerJson(rutaPaletas)) : [],
    dirGuiones: join(dir, banco.guiones ?? 'guiones'),
  }
}


/** @param {string} t */
const contarPalabras = (t) => t.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length

/** "MM-DD" que existe en algún año (02-29 vale). @param {unknown} t */
function mesDia(t) {
  if (typeof t !== 'string' || !/^\d{2}-\d{2}$/.test(t)) return false
  const [mes = 0, dia = 0] = t.split('-').map(Number)
  const d = new Date(Date.UTC(2024, mes - 1, dia))
  return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
}

/**
 * Lo que el pipeline necesita del guion (el formato revisa además su `contenido` con su `validar()`).
 * @param {any} g @param {string} archivo
 * @param {{ cuenta: Cuenta, ideas?: Map<string, Idea> | null, hechos?: Map<string, Hecho> | null, paletas?: string[] | null }} c
 * @returns {string[]}
 */
export function revisarGuion(g, archivo, { cuenta, ideas = null, hechos = null, paletas = null }) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return ['no es un objeto']
  /** @type {string[]} */
  const p = []
  if (g.version !== 1) p.push('version tiene que ser 1')
  if (typeof g.clave !== 'string' || !CLAVE.test(g.clave)) p.push('clave inválida')
  else if (basename(archivo) !== `${g.clave}.json`) p.push(`el archivo se tiene que llamar ${g.clave}.json`)
  if (typeof g.titulo !== 'string' || !g.titulo.trim() || g.titulo.length > 60) p.push('titulo vacío o de más de 60')
  if (typeof g.categoria !== 'string' || !CLAVE.test(g.categoria)) p.push('categoria: kebab-case')
  if (!cuenta.marca.formatos.includes(g.formato)) p.push(`formato tiene que ser ${cuenta.marca.formatos.join(' | ')}`)
  if (g.paleta !== undefined && (typeof g.paleta !== 'string' || (paletas?.length && !paletas.includes(g.paleta)))) p.push(`paleta tiene que ser ${paletas?.join(' | ') ?? 'una clave de marca/paletas.json'}`)
  if (g.tema !== undefined && (typeof g.tema !== 'string' || !CLAVE.test(g.tema))) p.push('tema: kebab-case')
  if (!Array.isArray(g.hooks) || g.hooks.length !== 3 || g.hooks.some((/** @type {unknown} */ h) => typeof h !== 'string' || !h.trim() || contarPalabras(h) > 8)) p.push('hooks: exactamente 3, de 8 palabras o menos')
  const [min, max] = cuenta.reglas_texto.max_palabras_voz
  if (g.formato === 'chat') {
    if (g.voz !== null) p.push('voz tiene que ser null en chat')
  } else if (typeof g.voz !== 'string' || contarPalabras(g.voz) < min || contarPalabras(g.voz) > max) p.push(`voz: de ${min} a ${max} palabras`)
  if (!g.contenido || typeof g.contenido !== 'object') p.push('falta contenido')
  const caps = g.captions
  if (!Array.isArray(caps) || caps.length < 3 || caps.length > 5 || caps.some((/** @type {unknown} */ c) => typeof c !== 'string' || !c.trim() || c.length > 300) || new Set(caps).size !== caps.length)
    p.push('captions: de 3 a 5 distintos, de 300 caracteres o menos')
  const tags = g.hashtags
  if (!Array.isArray(tags) || tags.length < 8 || tags.length > 15 || tags.some((/** @type {unknown} */ t) => typeof t !== 'string' || !/^[\p{Ll}\p{N}_]+$/u.test(t)) || new Set(tags).size !== tags.length)
    p.push('hashtags: de 8 a 15 distintos, en minúscula, sin # ni espacios')
  const dominios = cuenta.reglas_texto.fuentes_dominios
  if (g.fuentes !== undefined || dominios) {
    const fuentes = g.fuentes
    if (!Array.isArray(fuentes) || fuentes.length < 1 || fuentes.length > 4) p.push('fuentes: de 1 a 4, cada una { nombre, url, consultado }')
    else
      fuentes.forEach((/** @type {any} */ f, /** @type {number} */ i) => {
        if (!f || typeof f.nombre !== 'string' || !f.nombre.trim()) p.push(`fuentes[${i}].nombre vacío`)
        let host = ''
        try {
          host = new URL(String(f?.url)).hostname
        } catch {
          /* queda vacío */
        }
        if (!host) p.push(`fuentes[${i}].url no es una URL`)
        else if (dominios && !dominios.some((d) => host === d.replace(/^\./, '') || host.endsWith(d.startsWith('.') ? d : `.${d}`))) p.push(`fuentes[${i}].url tiene que ser de ${dominios.join(' o ')}`)
        if (typeof f?.consultado !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f.consultado)) p.push(`fuentes[${i}].consultado: AAAA-MM-DD`)
      })
  }
  if (g.hechos !== undefined) {
    if (!Array.isArray(g.hechos) || g.hechos.some((/** @type {unknown} */ h) => typeof h !== 'string')) p.push('hechos: lista de ids de hechos.json')
    else if (hechos) for (const h of g.hechos) if (!hechos.has(h)) p.push(`hechos: "${h}" no está en hechos.json`)
  }
  if (g.caduca !== undefined && !(typeof g.caduca === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.caduca))) p.push('caduca: "AAAA-MM-DD", el último día en que lo que dice sigue siendo cierto')
  if (g.ventana !== undefined && !(g.ventana && mesDia(g.ventana.desde) && mesDia(g.ventana.hasta))) p.push('ventana: { "desde": "MM-DD", "hasta": "MM-DD" } con fechas que existan')
  if (g.idea !== undefined) {
    if (typeof g.idea !== 'string' || !CLAVE.test(g.idea)) p.push('idea: el id (kebab-case) de una idea de ideas.json')
    else if (ideas && ideas.size && !ideas.has(g.idea)) p.push(`idea: "${g.idea}" no está en ideas.json`)
  }
  return p
}

/**
 * El banco de guiones de un directorio, ordenado por archivo, cada uno con lo que le falta.
 * @param {string} dir @param {{ cuenta: Cuenta, ideas?: Map<string, Idea> | null, hechos?: Map<string, Hecho> | null, paletas?: string[] | null }} c
 * @returns {GuionLeido[]}
 */
export function leerGuiones(dir, c) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((archivo) => {
      try {
        const guion = JSON.parse(readFileSync(join(dir, archivo), 'utf8'))
        return { archivo, guion, problemas: revisarGuion(guion, archivo, c) }
      } catch (e) {
        return { archivo, guion: null, problemas: [`no es JSON válido: ${String(/** @type {Error} */ (e).message).slice(0, 80)}`] }
      }
    })
}

/** El módulo de un formato (formatos/<f>/armar.mjs). @param {string} dir @param {string} formato */
export async function cargarFormato(dir, formato) {
  const ruta = join(dir, formato, 'armar.mjs')
  if (!existsSync(ruta)) throw new Error(`no existe formatos/${formato}/armar.mjs`)
  const m = await import(pathToFileURL(ruta).href)
  if (typeof m.armar !== 'function' || typeof m.validar !== 'function') throw new Error(`formatos/${formato}/armar.mjs no exporta armar() y validar()`)
  return /** @type {{ armar: (p: any) => Promise<{ duracion_s: number }>, validar: (g: any) => string[], layouts?: { id: string, apto: (g: any) => boolean }[] }} */ (m)
}


// Un número escrito en letra también se revisa: si no, alcanza con escribir "quince" para saltear el chequeo.
// La voz los escribe así a propósito (ElevenLabs los lee mejor), así que se arman enteros: "cuarenta y
// cinco" es 45, "tres coma cero nueve" es 3,09, "por ciento" es %, "dos mil veinticuatro" es un año.
const UNIDADES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidos', 'veintitres', 'veinticuatro', 'veinticinco',
  'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve',
]
/** @type {Record<string, number>} */
const EN_LETRA = {
  ...Object.fromEntries(UNIDADES.map((p, i) => [p, i])), un: 1, una: 1, veintiun: 21,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100,
  doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400, quinientos: 500,
  quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
}
const UNITS_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
/** @type {Record<string, number>} */
const IN_WORDS = { ...Object.fromEntries(UNITS_EN.map((p, i) => [p, i])), twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/**
 * @param {string} t @param {Record<string, number>} tabla @param {{ mil: string, cien: string | null, y: string, coma: string, porciento: RegExp, digitos: string[] }} l
 */
function aCifras(t, tabla, l) {
  const palabras = [...Object.keys(tabla), l.mil, ...(l.cien ? [l.cien] : [])]
  const palabra = '(?:' + palabras.sort((a, b) => b.length - a.length).join('|') + ')'
  const secuencia = new RegExp(`\\b${palabra}(?:[\\s-]+(?:${l.y}\\s+)?${palabra})*\\b`, 'g')
  const valor = (/** @type {string} */ s) => {
    let total = 0
    let actual = 0
    for (const p of s.split(/[\s-]+/).filter((x) => x !== l.y)) {
      if (p === l.mil) {
        total += (actual || 1) * 1000
        actual = 0
      } else if (l.cien && p === l.cien) actual = (actual || 1) * 100
      else actual += tabla[p] ?? 0
    }
    return total + actual
  }
  const digito = '(?:' + l.digitos.join('|') + ')'
  return t
    .replace(l.porciento, '%')
    .replace(new RegExp(`\\b${l.coma}((?:\\s+${digito}\\b)+)`, 'g'), (_, ds) => `${l.coma} ` + ds.trim().split(/\s+/).map((/** @type {string} */ d) => tabla[d]).join(''))
    .replace(secuencia, (s) => String(valor(s)))
    .replace(new RegExp(`(\\d+)\\s+${l.coma}\\s+(\\d+)`, 'g'), '$1,$2')
    .replace(/(\d+)\s+%/g, '$1%')
}

/** Reemplaza los números en letra por cifras. @param {string} t texto ya normalizado @param {'es-AR' | 'en-US'} [idioma] */
export function letrasACifras(t, idioma = 'es-AR') {
  if (idioma === 'en-US') return aCifras(t, IN_WORDS, { mil: 'thousand', cien: 'hundred', y: 'and', coma: 'point', porciento: /\bper\s?cent\b/g, digitos: UNITS_EN.slice(0, 10) })
  return aCifras(t, EN_LETRA, { mil: 'mil', cien: null, y: 'y', coma: 'coma', porciento: /\bpor\s+ciento\b/g, digitos: UNIDADES.slice(0, 10) })
}

/** @param {string} texto */
const normalizar = (texto) => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** El texto que dice el reel: hooks, voz, contenido y captions. @param {any} g */
const textoDe = (g) => JSON.stringify({ hooks: g.hooks, voz: g.voz, contenido: g.contenido, captions: g.captions })

/**
 * Las cifras de un guion que tienen que estar respaldadas: 5 o más, o con coma, punto o %. Del 1 al 4
 * quedan libres porque son los ejemplos ("4 años y 5 meses") y no reglas; los años, porque nombran la
 * norma y no son un dato que se calcula.
 * @param {object} g @param {'es-AR' | 'en-US'} [idioma] @returns {string[]}
 */
export function cifrasDe(g, idioma = 'es-AR') {
  const texto = letrasACifras(normalizar(textoDe(g)), idioma)
  /** @type {Set<string>} */
  const cifras = new Set()
  for (const m of texto.matchAll(/\d+(?:[.,]\d+)*(?:\s?%)?/g)) {
    const c = m[0].replace(/\s/g, '')
    const n = Number(c.replace('%', '').replace(/\./g, '').replace(',', '.'))
    const anio = /^(19|20)\d\d$/.test(c)
    if (!anio && (c.includes('%') || /[.,]/.test(c) || n >= 5)) cifras.add(c.replace('%', ''))
  }
  return [...cifras]
}

/** @param {string} c */
const formasDe = (c) => [c, c.replace(/\./g, ''), c.replace(',', '.'), c.replace(/\./g, '').replace(',', '.')]

/**
 * Cifras del guion que no aparecen en las `cifras` de los hechos que cita (él o su idea), ni en el
 * `dato` de su idea, ni cerca (±60 líneas) de las líneas de repo que la idea o el guion citan
 * (`leerRepo` resuelve "archivo:línea" al texto; sin él, ese respaldo no cuenta).
 * @param {{ guion: any, hechos?: Map<string, Hecho>, idea?: Idea | null, idioma?: 'es-AR' | 'en-US', leerRepo?: ((archivo: string) => string | null) | null }} p
 * @returns {string[]}
 */
export function cifrasSinRespaldo({ guion, hechos = new Map(), idea = null, idioma = 'es-AR', leerRepo = null }) {
  const citados = [...(Array.isArray(guion.hechos) ? guion.hechos : []), ...(Array.isArray(idea?.hechos) ? idea.hechos : [])]
  let respaldo = [idea?.dato ?? '', ...citados.flatMap((id) => hechos.get(id)?.cifras ?? [])].join('\n')
  if (leerRepo) {
    for (const cita of [idea?.origen_repo, ...(Array.isArray(guion.respaldo) ? guion.respaldo : [])].filter(Boolean)) {
      const [archivo = '', linea] = String(cita).split(':')
      const texto = leerRepo(archivo)
      if (!texto) continue
      const l = Number(linea) || 1
      respaldo += '\n' + texto.split('\n').slice(Math.max(0, l - 60), l + 60).join('\n')
    }
  }
  const r = normalizar(respaldo).replace(/_/g, '')
  return cifrasDe(guion, idioma).filter((c) => !formasDe(c).some((v) => new RegExp(`(^|[^\\d])${v.replace('.', '\\.')}([^\\d]|$)`).test(r)))
}


const OFERTA = /\b(gratis|gratuit[oa]s?|sin cargo|sin costo|primera cuota|free|no cost|first payment)\b/
const PRECIO = /(us\$|u\$s|\$\s?\d|\d\s?(pesos|usd|dolares|dollars|euros)\b)/
const TELEFONO = /(?<![\d.,])\+?\d(?:[\s()-]*\d){7,14}(?![\d.,])/g
/** Ocho dígitos o más con un +, un guion o un grupo de cuatro: un teléfono, no una lista de números. @param {string} t */
const pareceTelefono = (t) => [...t.matchAll(TELEFONO)].some((m) => /\+|-|\d{4}/.test(m[0]))
const MAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/
const ARROBA = /(^|[\s"(])@[a-z0-9._]{2,}/
const DOMINIO = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ar|net|org|io|app|ai|co|dev|tech|site|store|shop|info)(?:\.[a-z]{2})?)\b/g
// Dominios de ejemplo que usan los formatos (el navegador del explicador): no son de nadie.
export const DOMINIOS_FICTICIOS = ['tunegocio.com', 'tuempresa.com', 'tupagina.com', 'yourbusiness.com', 'yourcompany.com']
const TUTEO = /(?<!\p{L})(tú|tienes|puedes|quieres|sabes|eres|vienes|necesitas|haces)(?!\p{L})/u
const CHE = /\bche\b/
const CASTELLANO = /\b(vos|tenes|podes|queres|sabes|que|para|con|los|las|una|pero|porque|nuestro|nuestra|pagina|empresa)\b/g

/**
 * El revisor estricto (diseño § 4.4, del 2 al 6): toda cifra con respaldo en los hechos que cita, nada de
 * la oferta sin un hecho `oferta`, ningún precio, ninguna palabra prohibida, ningún dato de contacto ni
 * dominio ajeno, y el idioma de la cuenta. Los nombres propios no se revisan acá (quedan en el TONO.md).
 * @param {{ guion: any, cuenta: Cuenta, hechos?: Map<string, Hecho>, ideas?: Map<string, Idea>, leerRepo?: ((archivo: string) => string | null) | null }} p
 * @returns {string[]}
 */
export function revisarEstricto({ guion: g, cuenta, hechos = new Map(), ideas = new Map(), leerRepo = null }) {
  /** @type {string[]} */
  const p = []
  const idea = g.idea ? (ideas.get(g.idea) ?? null) : null
  const citados = [...(Array.isArray(g.hechos) ? g.hechos : []), ...(Array.isArray(idea?.hechos) ? idea.hechos : [])].map((id) => hechos.get(id)).filter(Boolean)
  const sueltas = cifrasSinRespaldo({ guion: g, hechos, idea, idioma: cuenta.idioma, leerRepo })
  if (sueltas.length) p.push(`cifras sin respaldo en los hechos que cita: ${sueltas.join(', ')}`)
  const texto = normalizar(textoDe(g))
  if (OFERTA.test(texto) && !citados.some((h) => h?.tipo === 'oferta')) p.push('promete algo de la oferta sin citar un hecho de tipo oferta')
  if (PRECIO.test(texto)) p.push('menciona un precio o un monto')
  for (const palabra of cuenta.reglas_texto.prohibidas) if (new RegExp(`\\b${normalizar(palabra).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(texto)) p.push(`usa una palabra prohibida: ${palabra}`)
  if (MAIL.test(texto)) p.push('trae un mail')
  if (ARROBA.test(texto)) p.push('trae un @usuario')
  if (pareceTelefono(texto.replace(MAIL, ''))) p.push('trae algo que parece un teléfono')
  const propios = new Set([cuenta.usuario, ...DOMINIOS_FICTICIOS].map((d) => d.toLowerCase()))
  for (const m of texto.matchAll(DOMINIO)) {
    const d = String(m[1]).replace(/^https?:\/\//, '').replace(/^www\./, '')
    if (!propios.has(d)) p.push(`trae un dominio ajeno: ${d}`)
  }
  if (cuenta.idioma === 'es-AR') {
    if (CHE.test(texto)) p.push('usa "che"')
    if (TUTEO.test(textoDe(g).toLowerCase())) p.push('tutea: la cuenta habla de vos')
  } else {
    const restos = new Set([...texto.matchAll(CASTELLANO)].map((m) => m[1]))
    if (restos.size >= 2) p.push(`tiene restos de castellano: ${[...restos].slice(0, 5).join(', ')}`)
  }
  return [...new Set(p)]
}

/**
 * Revisa un directorio de guiones completo: lo del pipeline, el validar() del formato y, si `estricto`,
 * el revisor estricto.
 * @param {{ cuenta: Cuenta, raiz: string, dir?: string, dirFormatos?: string, estricto?: boolean, leerRepo?: ((archivo: string) => string | null) | null }} p
 * @returns {Promise<{ archivo: string, problemas: string[] }[]>}
 */
export async function revisarBanco({ cuenta, raiz, dir, dirFormatos = join(raiz, 'formatos'), estricto = false, leerRepo = null }) {
  const b = leerBancoCuenta(cuenta, raiz)
  /** @type {{ archivo: string, problemas: string[] }[]} */
  const salida = []
  for (const { archivo, guion, problemas } of leerGuiones(dir ?? b.dirGuiones, { cuenta, ...b })) {
    const todos = [...problemas]
    if (guion) {
      try {
        const formato = await cargarFormato(dirFormatos, guion.formato)
        todos.push(...formato.validar(guion))
      } catch (e) {
        todos.push(`formato ${guion.formato}: ${/** @type {Error} */ (e).message}`)
      }
      if (estricto) {
        if (guion.idea && !b.ideas.has(guion.idea)) todos.push('sin idea de ideas.json')
        todos.push(...revisarEstricto({ guion, cuenta, hechos: b.hechos, ideas: b.ideas, leerRepo }))
      }
    }
    salida.push({ archivo, problemas: todos })
  }
  return salida
}

/**
 * Cuántos guiones quedan sin salir y qué ideas todavía no tienen guion, repartidas por tema para que
 * una tanda no sean diez guiones del mismo asunto.
 * @param {{ dirs: string[], estado: any, ideas: Map<string, Idea>, cuantas?: number }} p
 */
export function pendientes({ dirs, estado, ideas, cuantas = 21 }) {
  const guiones = dirs.flatMap((d) => (existsSync(d) ? readdirSync(d) : []).filter((f) => f.endsWith('.json')).map((f) => leerJson(join(d, f))))
  const sinSalir = guiones.filter((g) => historialGuion(estado, g.clave).length === 0).length
  const conGuion = new Set(guiones.map((g) => g.idea).filter(Boolean))
  const libres = [...ideas.values()].filter((i) => !conGuion.has(i.id))
  /** @type {Map<string, Idea[]>} */
  const porTema = new Map()
  for (const i of libres) porTema.set(i.tema, [...(porTema.get(i.tema) ?? []), i])
  /** @type {Idea[]} */
  const elegidas = []
  while (elegidas.length < cuantas && [...porTema.values()].some((l) => l.length)) {
    for (const lista of porTema.values()) {
      const i = lista.shift()
      if (i && elegidas.length < cuantas) elegidas.push(i)
    }
  }
  const numeros = guiones.map((g) => Number(String(g.clave).split('-')[0])).filter(Number.isFinite)
  return { sin_salir: sinSalir, ideas_libres: libres.length, elegidas: elegidas.map((i) => i.id), proximo_numero: Math.max(99, ...numeros) + 1 }
}


const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}⃣️‍]/gu

/** @param {string} t */
export const sinEmojis = (t) =>
  t
    .replace(EMOJI, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .trim()

/**
 * Un caption distinto por publicación: el cuerpo rota, la ventana de hashtags rota y cambia de largo
 * (entre los de `captions.hashtags_por_post`), suma los fijos de la cuenta y siempre cierra con el
 * caption del cierre. Distintos entre sí, porque la deduplicación busca por caption.
 * @param {{ guion: { clave?: string, captions: string[], hashtags: string[] }, cuenta: Cuenta, n: number }} p @returns {string[]}
 */
export function armarCaptions({ guion: g, cuenta, n }) {
  const cuerpos = g.captions.map((c) => sinEmojis(c).trim())
  const fijos = cuenta.captions.hashtags_fijos.filter((t) => !g.hashtags.includes(t))
  const tags = g.hashtags
  const [min, max] = cuenta.captions.hashtags_por_post
  const B = cuerpos.length
  const H = tags.length
  const rnd = azar(`captions:${cuenta.id}:${g.clave ?? ''}`)
  /** @type {Set<string>} */
  const vistos = new Set()
  /** @type {string[]} */
  const salida = []
  for (let i = 0; i < n; i++) {
    const j = Math.floor(i / B)
    const s = j % H
    const largo = Math.max(1, Math.min(H - 1, Math.max(0, min - fijos.length) + (Math.floor(j / H) % (max - min + 1))))
    let elegidos = Array.from({ length: largo }, (_, k) => /** @type {string} */ (tags[(s + k) % H]))
    const armar = () => sinEmojis(`${cuerpos[i % B]}\n\n${[...elegidos, ...fijos].map((t) => `#${t}`).join(' ')}\n\n${cuenta.cierre.caption}`).slice(-2200)
    let texto = armar()
    for (let vuelta = 0; vistos.has(texto) && vuelta < 50; vuelta++) {
      elegidos = mezclar(tags, rnd).slice(0, Math.max(3, largo - (vuelta % 2)))
      texto = armar()
    }
    if (vistos.has(texto)) throw new Error(`no salen ${n} captions distintos`)
    vistos.add(texto)
    salida.push(texto)
  }
  return salida
}

/**
 * Los dos captions de una variante en una ronda (prueba y normal), siguiendo la rotación: la variante
 * `i` de la ronda `r` usa los índices `2·(r·V + i)` y el siguiente.
 * @param {{ guion: any, cuenta: Cuenta, ronda: number, indice: number, variantes: number }} p @returns {[string, string]}
 */
export function captionsDeVariante({ guion, cuenta, ronda, indice, variantes }) {
  const k = ronda * variantes + indice
  const [prueba = '', normal = ''] = armarCaptions({ guion, cuenta, n: 2 * k + 2 }).slice(2 * k)
  return [prueba, normal]
}


/** @param {string} n */
const arg = (n) => {
  const i = process.argv.indexOf(n)
  return i !== -1 ? process.argv[i + 1] : undefined
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const comando = process.argv[2]
  const raiz = resolve(process.env.FABRICA_RAIZ ?? join(fileURLToPath(import.meta.url), '..', '..'))
  const id = arg('--cuenta')
  if (!id || !['revisar', 'pendientes'].includes(String(comando))) {
    console.error('uso: node nucleo/banco.mjs revisar --cuenta <id> [--dir d] [--estricto] [--quitar] | pendientes --cuenta <id> [--estado e] [--dirs a,b] [--cuantas n]')
    process.exit(2)
  }
  const cuenta = cargarCuenta(id, raiz)
  if (comando === 'revisar') {
    const dir = arg('--dir') ? resolve(String(arg('--dir'))) : undefined
    const r = await revisarBanco({ cuenta, raiz, dir, estricto: process.argv.includes('--estricto') })
    const malos = r.filter((x) => x.problemas.length)
    for (const m of malos) {
      console.log(`${m.archivo}: ${m.problemas.join('; ')}`)
      if (process.argv.includes('--quitar') && dir) unlinkSync(join(dir, m.archivo))
    }
    console.log(`${r.length - malos.length} de ${r.length} guiones pasan`)
    process.exit(malos.length && !process.argv.includes('--quitar') ? 1 : 0)
  } else {
    const { leerEstado } = await import('./estado.mjs')
    const rutaEstado = arg('--estado')
    const estado = rutaEstado && existsSync(rutaEstado) ? leerEstado(readFileSync(rutaEstado, 'utf8'), cuenta.id) : { creativos: {} }
    const b = leerBancoCuenta(cuenta, raiz)
    const dirs = (arg('--dirs') ?? b.dirGuiones).split(',').map((d) => resolve(d))
    console.log(JSON.stringify(pendientes({ dirs, estado, ideas: b.ideas, cuantas: Number(arg('--cuantas') ?? 21) })))
  }
}
