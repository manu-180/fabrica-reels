// @ts-check
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dirCuenta, porDiaHoy } from './cuenta.mjs'
import { agendar, destinosVivos } from './agenda.mjs'
import { captionsDeVariante, cargarFormato, leerBancoCuenta, leerGuiones } from './banco.mjs'
import { firmaPara, historialDeFirmas, resumenFirma } from './diseno.mjs'
import { MAX_INTENTOS, publicacionVacia } from './estado.mjs'
import { creativoAnterior, elegirGuion, historialGuion } from './elegir.mjs'
import { entornoSinSecretos } from './entorno.mjs'
import { diaAR, finDelDia, minutoAR, sumarDias } from './tiempo.mjs'

/*
  Los creativos del día de una cuenta: elige el guion y su ronda, y por cada variante su firma, la voz
  (F3), el armado del formato (F2), el render y el cierre (F4), la sube a Blob y agenda sus
  publicaciones. Cada creativo va por su lado: el que falla queda con su error y su intento (contado
  antes de empezar: una corrida cortada a la mitad también cuenta) y los otros siguen.
*/

/** El formato no pudo armar el guion: el guion no vuelve. Todo lo demás (Blob, la voz, el render) no lo quema. */
export class FallaDelGuion extends Error {}

/**
 * @typedef {import('./cuenta.mjs').Cuenta} Cuenta
 * @typedef {import('./estado.mjs').EstadoV2} EstadoV2
 * @typedef {import('./estado.mjs').Creativo} Creativo
 * @typedef {import('./estado.mjs').Variante} Variante
 * @typedef {import('./estado.mjs').Firma} Firma
 * @typedef {{ id: string, paleta: string, estilo: string, destino: 'reel' | 'historia', archivo: string, duracion_s: number }} Clip
 * @typedef {{
 *   locutar: (p: { cuenta: Cuenta, hook: string, cuerpo: string | null, env: Record<string, string | undefined>, fetch: typeof fetch, blob: any, log: (m: string) => void }) =>
 *     Promise<{ wav: string, duracion_s: number, palabras: { texto: string, inicio_s: number, fin_s: number }[], proveedor: string, caracteres_pagados: number, caracteres_cache: number }>,
 *   temaDe: (p: { cuenta: Cuenta, dirCuenta: string, paleta: string, motivo: string }) => any,
 *   renderizar: (p: { proyecto: string, salida: string, log: (m: string) => void, env: Record<string, string> }) => Promise<void>,
 *   variar: (p: { cuerpo: string, firma: Firma, clip: Clip, musica: string, conVoz: boolean, dir: string, destino: 'reel' | 'historia', env: Record<string, string> }) => Promise<{ archivo: string, duracion_s: number }>,
 *   subir: (p: { ruta: string, archivo: string, env: Record<string, string | undefined> }) => Promise<string>,
 *   cargarFormato: typeof cargarFormato,
 *   blobVoz?: (p: { env: Record<string, string | undefined>, seco: boolean }) => Promise<any>,
 * }} Deps
 */

// Producir a la tarde arma lo de mañana (diseño § 8.5); a la madrugada, lo de hoy.
const HORA_PRODUCIR_MANIANA = 12 * 60

/** El día para el que produce una corrida que arranca `ahora`. @param {Date} ahora */
export const diaObjetivo = (ahora) => (minutoAR(ahora) >= HORA_PRODUCIR_MANIANA ? sumarDias(diaAR(ahora)) : diaAR(ahora))

/**
 * Qué creativos producir: cada slot del día por su lado. Lo que falló se reintenta hasta MAX_INTENTOS.
 * Respeta la rampa (y el escalón que sostiene el estado): no se produce lo que no se va a poder publicar.
 * @param {{ cuenta: Cuenta, estado: EstadoV2, ahora: Date, forzado?: boolean }} p
 * @returns {{ producir: boolean, motivo: string, dia: string, por: { creativos: number, variantes: number }, slots: { slot: number, reintentar?: string }[] }}
 */
export function debeProducir({ cuenta, estado, ahora, forzado = false }) {
  const dia = diaObjetivo(ahora)
  const r = porDiaHoy(cuenta, dia, { escalon: estado.rampa?.escalon ?? null })
  const por = { creativos: r.creativos, variantes: r.variantes }
  const nada = (/** @type {string} */ motivo) => ({ producir: false, motivo, dia, por, slots: [] })
  if (forzado) return { producir: true, motivo: 'pedido a mano', dia, por: { creativos: Math.max(1, por.creativos), variantes: por.variantes }, slots: [] }
  // Producir no usa Instagram: con la pausa por token se sigue produciendo y sale cuando el token vuelve.
  if (estado.pausado && estado.pausado_por !== 'token') return nada(`pausado: ${estado.pausado}`)
  if (!destinosVivos(cuenta, estado).length) return nada('ningún destino publica en esta cuenta')
  if (r.creativos === 0) return nada(`la rampa arranca el ${cuenta.rampa?.inicio}`)
  /** @type {{ slot: number, reintentar?: string }[]} */
  const slots = []
  /** @type {string[]} */
  const motivos = []
  const deDia = Object.values(estado.creativos).filter((c) => c.fecha === dia)
  for (let slot = 0; slot < r.creativos; slot++) {
    const suyos = deDia.filter((c) => (c.slot ?? 0) === slot)
    const hecho = suyos.find((c) => c.producido_at)
    if (hecho) {
      motivos.push(`slot ${slot + 1}: ya está ${hecho.id}`)
      continue
    }
    const fallido = suyos.find((c) => c.error)
    if (fallido) {
      if ((fallido.intentos ?? 0) >= MAX_INTENTOS) {
        motivos.push(`slot ${slot + 1}: ${fallido.id} falló ${fallido.intentos} veces${fallido.falla === 'guion' ? ', el guion queda afuera' : ' (el guion no se quema)'}`)
        continue
      }
      motivos.push(`slot ${slot + 1}: reintento ${(fallido.intentos ?? 0) + 1} de ${MAX_INTENTOS} de ${fallido.id}`)
      slots.push({ slot, reintentar: fallido.clave })
      continue
    }
    motivos.push(`slot ${slot + 1}: a producir`)
    slots.push({ slot })
  }
  return { producir: slots.length > 0, motivo: `${dia}: ${motivos.join('; ')}`, dia, por, slots }
}

/** Los clips de cierre que existen de verdad. @param {string} ruta clips.json @param {(m: string) => void} [log] @returns {Clip[]} */
export function leerClips(ruta, log = () => {}) {
  if (!existsSync(ruta)) return []
  /** @type {any[]} */
  const lista = JSON.parse(readFileSync(ruta, 'utf8'))
  const dir = resolve(ruta, '..')
  return (Array.isArray(lista) ? lista : []).flatMap((c) => {
    const archivo = typeof c?.archivo === 'string' ? resolve(dir, c.archivo) : ''
    if (typeof c?.id !== 'string' || typeof c?.paleta !== 'string' || typeof c?.estilo !== 'string' || !['reel', 'historia'].includes(c?.destino) || !archivo || !existsSync(archivo)) {
      log(`clip de cierre inválido o sin archivo: ${JSON.stringify(c).slice(0, 120)}`)
      return []
    }
    return [{ id: c.id, paleta: c.paleta, estilo: c.estilo, destino: c.destino, archivo, duracion_s: Number(c.duracion_s) || 0 }]
  })
}

/** @param {string} dir @returns {Map<string, string>} id (nombre sin extensión) → archivo */
export function listarMusicas(dir) {
  if (!existsSync(dir)) return new Map()
  return new Map(readdirSync(dir).filter((f) => /\.(m4a|mp3|wav)$/i.test(f)).sort().map((f) => [f.replace(/\.[^.]+$/, ''), join(dir, f)]))
}

/** @param {Buffer} b */
const hash8 = (b) => createHash('sha256').update(b).digest('hex').slice(0, 8)

/**
 * Sube un mp4 a Vercel Blob: público, video/mp4, sin sufijo al azar (mismo contenido = misma ruta).
 * @param {{ ruta: string, archivo: string, env: Record<string, string | undefined>, put?: (ruta: string, cuerpo: Buffer, o: object) => Promise<{ url: string }> }} p
 */
export async function subirVideo({ ruta, archivo, env, put }) {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim()
  if (!token) throw new Error('falta BLOB_READ_WRITE_TOKEN: sin Blob no hay URL para Instagram')
  const cuerpo = readFileSync(archivo)
  const poner = put ?? /** @type {any} */ ((await import('@vercel/blob')).put)
  const r = await poner(ruta.replace(/\.mp4$/, `-${hash8(cuerpo)}.mp4`), cuerpo, { access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, token })
  const url = new URL(String(r?.url ?? ''), 'https://invalido.local')
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.blob.vercel-storage.com')) throw new Error(`Vercel Blob devolvió una URL inesperada: ${url.hostname}`)
  return url.toString()
}

/**
 * Las dependencias de otras fases, cargadas recién cuando hacen falta (planear y publicar no las usan).
 * La caché de voz va en el Blob de la fábrica; en --seco sin token, en memoria (se paga igual, no se guarda).
 * @returns {Promise<Deps>}
 */
export async function depsPorDefecto() {
  const voz = await import(new URL('./voz/index.mjs', import.meta.url).href)
  const render = await import(new URL('./render/index.mjs', import.meta.url).href)
  const tema = await import(new URL('../formatos/_comun/tema.mjs', import.meta.url).href)
  return {
    locutar: voz.locutar, temaDe: tema.temaDe, renderizar: render.renderizarCuerpo, variar: render.armarFinal, subir: subirVideo, cargarFormato,
    blobVoz: async ({ env, seco }) => (seco && !env.BLOB_READ_WRITE_TOKEN?.trim() ? voz.blobEnMemoria() : voz.blobVercel({ token: env.BLOB_READ_WRITE_TOKEN?.trim() })),
  }
}

/**
 * @typedef {{ cuenta: Cuenta, estado: EstadoV2, raiz: string, ahora?: Date, guionClave?: string | null, seco?: string | null, env?: Record<string, string | undefined>,
 *   fetch?: typeof fetch, blob?: any, deps?: Partial<Deps>, log?: (m: string) => void, guardar?: (e: EstadoV2) => void | Promise<void>, reloj?: () => Date, trabajo?: string,
 *   temas?: Record<string, { puntaje: number, n: number }>, conservar?: string | null }} OpcionesProducir
 * `conservar`: carpeta donde quedan copiados los mp4 finales (modo sombra: el workflow los sube como artefacto).
 * @typedef {{ estado: EstadoV2, creativo: string | null, ok: boolean, motivo: string }} Resultado
 */

/**
 * @param {OpcionesProducir} p
 * @returns {Promise<{ estado: EstadoV2, resultados: Resultado[], ok: boolean, motivo: string }>}
 */
export async function producir(p) {
  const { cuenta, raiz, ahora = new Date(), guionClave = null, env = process.env, log = () => {} } = p
  let estado = p.estado
  const nada = (/** @type {string} */ motivo) => ({ estado, resultados: /** @type {Resultado[]} */ ([]), ok: false, motivo })
  if (!guionClave && !p.seco && (env.FABRICA_PAUSADA === '1')) return nada('FABRICA_PAUSADA=1: no se produce')
  const d = debeProducir({ cuenta, estado, ahora, forzado: Boolean(guionClave) })
  if (!d.producir) return nada(d.motivo)
  /** @type {{ slot: number, fijo: string | null }[]} */
  let slots = d.slots.map((s) => ({ slot: s.slot, fijo: s.reintentar ?? null }))
  if (guionClave) {
    const ocupados = new Set(Object.values(estado.creativos).filter((c) => c.fecha === d.dia).map((c) => c.slot ?? 0))
    let libre = 0
    while (ocupados.has(libre)) libre++
    slots = [{ slot: libre, fijo: guionClave }]
  }
  log(d.motivo)
  const banco = leerBancoCuenta(cuenta, raiz)
  const guiones = leerGuiones(banco.dirGuiones, { cuenta, ...banco })
  const deps = /** @type {Deps} */ ({ ...(p.deps?.locutar && p.deps?.renderizar && p.deps?.variar && p.deps?.temaDe ? {} : await depsPorDefecto()), cargarFormato, subir: subirVideo, ...p.deps })
  const blob = p.blob ?? (deps.blobVoz ? await deps.blobVoz({ env, seco: Boolean(p.seco) }) : null)
  /** @type {Set<string>} */
  const rechazados = new Set()
  /** @type {Resultado[]} */
  const resultados = []
  for (const { slot, fijo } of slots) {
    const r = await producirSlot({ ...p, blob, estado, ahora, dia: d.dia, por: d.por, slot, fijo, guiones, banco, rechazados, deps, log })
    estado = r.estado
    resultados.push(r)
  }
  return { estado, resultados, ok: resultados.length > 0 && resultados.every((r) => r.ok), motivo: resultados.map((r) => r.motivo).join('; ') }
}

/**
 * Un creativo de un slot.
 * @param {OpcionesProducir & { ahora: Date, dia: string, por: { creativos: number, variantes: number }, slot: number, fijo: string | null,
 *   guiones: import('./banco.mjs').GuionLeido[], banco: ReturnType<typeof leerBancoCuenta>, rechazados: Set<string>, deps: Deps, log: (m: string) => void }} p
 * @returns {Promise<Resultado>}
 */
async function producirSlot(p) {
  const { cuenta, raiz, dia, por, slot, fijo, guiones, banco, rechazados, deps, log, seco = null, env = process.env, guardar = () => {}, reloj = () => new Date(), temas = {} } = p
  let estado = p.estado
  const nada = (/** @type {string} */ motivo) => ({ estado, creativo: null, ok: false, motivo: `slot ${slot + 1}: ${motivo}` })
  const dirFormatos = join(raiz, 'formatos')
  /** @param {string} clave @param {string} motivo */
  const saltar = (clave, motivo) => {
    estado = { ...estado, saltados: { ...estado.saltados, [clave]: { motivo: motivo.slice(0, 300), at: reloj().toISOString() } } }
    log(`guion ${clave} salteado: ${motivo}`)
  }
  // Un guion por día: lo que ya tiene otro slot del día no se elige otra vez.
  const delDia = new Set(Object.values(estado.creativos).filter((c) => c.fecha === dia && (c.slot ?? 0) !== slot).map((c) => c.clave))

  /** @type {any} */
  let guion = null
  let ronda = 0
  /** @type {Awaited<ReturnType<typeof cargarFormato>> | null} */
  let formato = null
  while (!guion) {
    /** @type {import('./banco.mjs').GuionLeido | null} */
    let elegido
    if (fijo) {
      elegido = guiones.find((g) => g.guion?.clave === fijo) ?? null
      if (!elegido) return nada(`no existe el guion ${fijo}`)
      if (elegido.problemas.length) {
        saltar(fijo, elegido.problemas.join('; '))
        await guardar(estado)
        return nada(`el guion ${fijo} no es válido: ${elegido.problemas.join('; ')}`)
      }
      ronda = historialGuion(estado, fijo).length
    } else {
      const r = elegirGuion({ guiones, estado, hoy: dia, slot, excluir: new Set([...rechazados, ...delDia]), temas, ideas: banco.ideas, semilla: cuenta.id })
      for (const s of r.saltados) if (estado.saltados[s.clave]?.motivo !== s.motivo) saltar(s.clave, s.motivo)
      elegido = r.elegido
      ronda = r.ronda
      if (!elegido) {
        await guardar(estado)
        return nada(guiones.length ? 'no hay guiones elegibles (inválidos, quemados, fuera de su ventana, ya usados hoy o sin ronda disponible): banco vacío' : 'el banco de guiones está vacío')
      }
    }
    const g = elegido.guion
    /** @type {string[]} */
    let problemas
    try {
      formato = await deps.cargarFormato(dirFormatos, g.formato)
      problemas = formato.validar(g)
    } catch (e) {
      problemas = [`formato ${g.formato}: ${String(/** @type {Error} */ (e).message).split('\n')[0]}`]
    }
    if (problemas.length) {
      saltar(g.clave, problemas.join('; '))
      if (fijo) {
        await guardar(estado)
        return nada(`el guion ${g.clave} no pasa validar(): ${problemas.join('; ')}`)
      }
      rechazados.add(g.clave)
      continue
    }
    guion = g
  }
  if (estado.saltados[guion.clave]) {
    const { [guion.clave]: _, ...resto } = estado.saltados
    estado = { ...estado, saltados: resto }
  }

  const id = `${dia}-${guion.clave}`
  const previo = estado.creativos[id]
  if (previo?.producido_at) return nada(`${id} ya está producido`)
  /** @type {Creativo} */
  let entrada = {
    id, clave: guion.clave, idea: guion.idea ?? null, tema: guion.tema ?? banco.ideas.get(guion.idea)?.tema ?? guion.categoria ?? null, fecha: dia,
    titulo: guion.titulo, categoria: guion.categoria, formato: guion.formato, ronda, slot,
    producido_at: null, error: 'produciendo: si queda así, la corrida se cortó a la mitad', falla: null, intentos: (previo?.intentos ?? 0) + 1, voz: null, variantes: [],
  }
  const poner = async () => {
    estado = { ...estado, creativos: { ...estado.creativos, [id]: entrada } }
    await guardar(estado)
  }
  await poner()
  log(`produciendo ${id} (slot ${slot + 1}, ronda ${ronda}, ${guion.formato}, ${guion.categoria}, intento ${entrada.intentos})`)
  const dir = seco ? join(seco, id) : (p.trabajo ? join(p.trabajo, id) : join(process.env.RUNNER_TEMP ?? tmpdir(), 'fabrica', cuenta.id, id))
  try {
    if (!seco && !env.BLOB_READ_WRITE_TOKEN?.trim()) throw new Error('falta BLOB_READ_WRITE_TOKEN: sin Blob no hay URL para Instagram')
    const r = await producirCreativo({ cuenta, raiz, estado, guion, formato: /** @type {any} */ (formato), id, dia, ronda, slot, variantes: por.variantes, dir, seco: Boolean(seco), env, deps, log, fetch: p.fetch ?? fetch, blob: p.blob ?? null, conservar: p.conservar ?? null })
    const [agendado] = agendar({ cuenta, creativos: [{ ...entrada, variantes: r.variantes }], dia, semilla: cuenta.id, estado, por, ahora: reloj() })
    entrada = { ...entrada, producido_at: reloj().toISOString(), error: null, falla: null, intentos: entrada.intentos - 1, voz: r.voz, variantes: /** @type {Creativo} */ (agendado).variantes }
    await poner()
    const relojes = entrada.variantes.map((v) => Object.values(v.publicaciones).find((x) => x?.no_antes_de)?.no_antes_de ?? 'sin reloj').join(', ')
    return { estado, creativo: id, ok: true, motivo: `${id}: ${entrada.variantes.length} variante${entrada.variantes.length === 1 ? '' : 's'}, salen desde ${relojes}` }
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message).split('\n').slice(0, 3).join(' ').slice(0, 500)
    entrada = { ...entrada, error: msg, falla: e instanceof FallaDelGuion ? 'guion' : 'general' }
    await poner()
    return { estado, creativo: id, ok: false, motivo: `${id} falló (intento ${entrada.intentos}): ${msg}` }
  } finally {
    if (!seco) rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Del guion a sus variantes subidas, cada una con su firma, sus videos y sus publicaciones vacías.
 * @param {{ cuenta: Cuenta, raiz: string, estado: EstadoV2, guion: any, formato: Awaited<ReturnType<typeof cargarFormato>>, id: string, dia: string, ronda: number, slot: number,
 *   variantes: number, dir: string, seco: boolean, env: Record<string, string | undefined>, deps: Deps, log: (m: string) => void, fetch: typeof fetch, blob: any,
 *   conservar?: string | null }} p
 * @returns {Promise<{ variantes: Variante[], voz: Creativo['voz'] }>}
 */
export async function producirCreativo({ cuenta, raiz, estado, guion, formato, id, dia, ronda, slot, variantes: V, dir, seco, env, deps, log, fetch: f, blob, conservar = null }) {
  mkdirSync(dir, { recursive: true })
  const limpio = entornoSinSecretos(env, cuenta)
  const dc = dirCuenta(cuenta.id, raiz)
  const clips = leerClips(join(dc, cuenta.cierre.clips), log)
  const musicas = listarMusicas(join(raiz, 'musica'))
  const paletas = leerBancoCuenta(cuenta, raiz).paletas
  if (!clips.some((c) => c.destino === 'reel')) throw new Error(`no hay clips de cierre de reel en cuentas/${cuenta.id}/${cuenta.cierre.clips}`)
  if (!musicas.size) throw new Error('no hay música en musica/')
  const vivos = destinosVivos(cuenta, estado)
  const historiaPropia = vivos.includes('historia') && cuenta.destinos.historia.cierre === 'historia'
  const historial = historialDeFirmas(estado, id)
  const anterior = creativoAnterior(estado, dia, slot)
  if (anterior && !historial.some((h) => h.fecha === anterior.fecha && h.slot === (anterior.slot ?? 0))) historial.push({ tema: anterior.tema, fecha: anterior.fecha, slot: anterior.slot ?? 0, firmas: anterior.variantes.map((v) => v.firma) })
  const vence = finDelDia(dia)
  let pagados = 0
  let cache = 0
  let proveedor = 'ninguno'
  /** @type {Firma[]} */
  const hermanas = []
  /** @type {Variante[]} */
  const salida = []
  for (let indice = 0; indice < V; indice++) {
    const firma = firmaPara({ cuenta, guion, ronda, indice, historial, formato, opciones: { paletas, musicas: [...musicas.keys()], clips }, hermanas, variantes: V })
    hermanas.push(firma)
    const vdir = join(dir, `v${indice}`)
    mkdirSync(vdir, { recursive: true })
    /** @type {any} */
    let voz = null
    if (guion.voz) {
      const l = await deps.locutar({ cuenta, hook: /** @type {string} */ (guion.hooks[firma.hook]), cuerpo: guion.voz, env, fetch: f, blob, log, dir: vdir })
      pagados += l.caracteres_pagados
      cache += l.caracteres_cache
      proveedor = l.proveedor
      voz = { wav: l.wav, duracion_s: l.duracion_s, palabras: l.palabras }
    }
    const tema = await deps.temaDe({ cuenta, dirCuenta: dc, paleta: firma.paleta, motivo: firma.motivo })
    const proyecto = join(vdir, 'cuerpo')
    rmSync(proyecto, { recursive: true, force: true })
    mkdirSync(proyecto, { recursive: true })
    try {
      await formato.armar({ guion, hook: firma.hook, voz, salida: proyecto, diseno: { ronda, firma, layout: firma.layout, paleta: firma.paleta }, tema })
    } catch (e) {
      throw new FallaDelGuion(`${guion.formato} no pudo armar el guion: ${String(/** @type {Error} */ (e).message).split('\n')[0]}`)
    }
    const cuerpo = join(vdir, 'cuerpo.mp4')
    await deps.renderizar({ proyecto, salida: cuerpo, log, env: limpio })
    const musica = /** @type {string} */ (musicas.get(firma.musica))
    const clipReel = /** @type {Clip} */ (clips.find((c) => c.id === firma.cierre))
    const reel = await deps.variar({ cuerpo, firma, clip: clipReel, musica, conVoz: Boolean(guion.voz), dir: vdir, destino: 'reel', env: limpio })
    /** @type {{ archivo: string, duracion_s: number } | null} */
    let historia = null
    if (historiaPropia) {
      const deHistoria = clips.filter((c) => c.destino === 'historia')
      const clip = deHistoria.find((c) => c.paleta === firma.paleta && c.estilo === clipReel.estilo) ?? deHistoria.find((c) => c.paleta === firma.paleta) ?? deHistoria[0]
      if (!clip) throw new Error(`la cuenta pide cierre de historia y no hay clips de historia en ${cuenta.cierre.clips}`)
      historia = await deps.variar({ cuerpo, firma, clip, musica, conVoz: Boolean(guion.voz), dir: vdir, destino: 'historia', env: limpio })
    }
    if (conservar) {
      mkdirSync(join(conservar, id), { recursive: true })
      copyFileSync(reel.archivo, join(conservar, id, `${indice}-reel.mp4`))
      if (historia) copyFileSync(historia.archivo, join(conservar, id, `${indice}-historia.mp4`))
    }
    const base = `videos/${cuenta.id}/${dia}/${id}-${indice}`
    const video_url = seco ? pathToFileURL(reel.archivo).href : await deps.subir({ ruta: `${base}-reel.mp4`, archivo: reel.archivo, env })
    const video_historia_url = historia ? (seco ? pathToFileURL(historia.archivo).href : await deps.subir({ ruta: `${base}-historia.mp4`, archivo: historia.archivo, env })) : null
    const [cp, cn] = captionsDeVariante({ guion, cuenta, ronda, indice, variantes: V })
    /** @type {Variante['publicaciones']} */
    const publicaciones = {}
    if (vivos.includes('prueba')) publicaciones.prueba = publicacionVacia('prueba', cp, vence)
    if (vivos.includes('normal')) publicaciones.normal = publicacionVacia('normal', cn, vence)
    if (vivos.includes('historia')) publicaciones.historia = publicacionVacia('historia', '', vence)
    salida.push({ indice, hook: firma.hook, firma, resumen: resumenFirma(firma), video_url, video_historia_url, duracion_s: reel.duracion_s, publicaciones })
    log(`${id} variante ${indice + 1}: ${resumenFirma(firma)}`)
  }
  return { variantes: salida, voz: guion.voz ? { proveedor, caracteres_pagados: pagados, caracteres_cache: cache } : null }
}
