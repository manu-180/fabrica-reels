// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cargarCuenta, variablePausa } from './cuenta.mjs'
import { gitEn } from './correr.mjs'
import { ErrorGraph, crearGraph } from './meta/graph.mjs'
import { DIA, HORA, MIN, diaAR, minutoAR, minutosDe } from './tiempo.mjs'

/*
  Historias de los reels que una cuenta publica por fuera de la fábrica (@apex.stack y @apex.webssites:
  las demos salen desde apex-demos). Lee los reels de Instagram y vuelve a subir como historia los que
  todavía no salieron. El día que la fábrica publica la cuenta, sigue sólo con los de la grilla: los
  suyos no van a la grilla y ya tienen su historia en la cola, así que tomarlos la duplicaría.

  Nunca dos veces: el intento se guarda (y se pushea) antes de tocar Meta, y un reel con un intento
  anterior no se vuelve a subir, salvo que se pueda leer que su contenedor no llegó a publicarse.
*/

const SONDEOS = 36

/**
 * @typedef {{ por_dia: number, gap_h: number, desde: string, hasta: string, ventana_dias: number, margen_min: number }} Config
 * @typedef {{ creando_at: string, ig_container_id: string | null, publicado_at: string | null, historia_id: string | null, de_feed: boolean,
 *   descartada_at: string | null, error: string | null }} Intento
 * @typedef {{ version: 1, historias: Record<string, Intento> }} Estado
 * @typedef {{ id: string, at: string, feed: boolean, url: string | null }} Reel
 */

/** @param {string} id */
export const rutaEstado = (id) => `cuentas/${id}/espejo-estado.json`

/** @param {string} texto @returns {Estado} */
export function leerEstado(texto) {
  if (!texto.trim()) return { version: 1, historias: {} }
  const d = JSON.parse(texto)
  // Un estado ilegible no se toma como vacío: volvería a subir todo.
  if (d?.version !== 1 || typeof d.historias !== 'object' || !d.historias) throw new Error('espejo-estado.json no tiene el formato esperado')
  return d
}

/** Por qué no corre en esta cuenta, o null. @param {{ id: string, modo: string }} cuenta @param {Record<string, string | undefined>} env */
export function motivoApagado(cuenta, env) {
  if (env.FABRICA_PAUSADA === '1') return 'FABRICA_PAUSADA=1'
  if (env[variablePausa(cuenta.id)] === '1') return `${variablePausa(cuenta.id)}=1`
  return null
}

/** @param {{ id: string, modo: string }} cuenta @param {Record<string, string | undefined>} env */
export const publicaLaFabrica = (cuenta, env) => cuenta.modo === 'real' && env[`FABRICA_ACTIVA_${cuenta.id.toUpperCase().replace(/-/g, '_')}`] === '1'

/**
 * El próximo reel para subir como historia: primero lo del último día que está en la grilla, después
 * uno solo por día fuera de la grilla (las pruebas son copias entre sí) y, si no hay nada nuevo, lo
 * de la grilla que quedó sin subir.
 * @param {{ reels: Reel[], estado: Estado, config: Config, ahora: Date }} p
 * @returns {{ reel: Reel } | { reel: null, motivo: string }}
 */
export function elegir({ reels, estado, config, ahora }) {
  const no = (/** @type {string} */ motivo) => ({ reel: /** @type {null} */ (null), motivo })
  const minuto = minutoAR(ahora)
  if (minuto < minutosDe(config.desde) || minuto > minutosDe(config.hasta)) return no(`fuera de horario (${config.desde} a ${config.hasta})`)
  const vivas = Object.values(estado.historias).filter((x) => !x.descartada_at)
  const hoy = diaAR(ahora)
  const deHoy = vivas.filter((x) => diaAR(x.publicado_at ?? x.creando_at) === hoy)
  if (deHoy.length >= config.por_dia) return no(`ya salieron las ${config.por_dia} de hoy`)
  const ultima = Math.max(0, ...vivas.map((x) => Date.parse(x.publicado_at ?? x.creando_at)))
  if (ahora.getTime() - ultima < config.gap_h * HORA) return no(`la última fue hace menos de ${config.gap_h} h`)
  const libres = reels
    .filter((r) => r.url && !estado.historias[r.id])
    .filter((r) => {
      const edad = ahora.getTime() - Date.parse(r.at)
      return edad >= config.margen_min * MIN && edad <= config.ventana_dias * DIA
    })
    .sort((a, b) => b.at.localeCompare(a.at))
  const nuevo = (/** @type {Reel} */ r) => ahora.getTime() - Date.parse(r.at) <= DIA
  const reel =
    libres.find((r) => r.feed && nuevo(r)) ??
    (deHoy.some((x) => !x.de_feed) ? undefined : libres.find((r) => !r.feed && nuevo(r))) ??
    libres.find((r) => r.feed)
  return reel ? { reel } : no('no hay reels sin subir')
}

/** @param {ReturnType<typeof crearGraph>} graph @param {string} igUser @returns {Promise<Reel[]>} */
export async function leerReels(graph, igUser) {
  const d = await graph.conReintentos(() => graph.llamar('GET', `/${igUser}/media`, { fields: 'id,timestamp,media_product_type,media_url,is_shared_to_feed', limit: '100' }))
  return (d.data ?? [])
    .filter((/** @type {any} */ m) => m.media_product_type === 'REELS')
    .map((/** @type {any} */ m) => ({ id: String(m.id), at: new Date(m.timestamp).toISOString(), feed: m.is_shared_to_feed === true, url: m.media_url ?? null }))
}

/**
 * @param {{ cuenta: { id: string, modo: string, usuario: string }, config: Config, estado: Estado, igUser: string, token: string, ahora?: Date,
 *   env?: Record<string, string | undefined>, fetch?: typeof fetch, espera?: (ms: number) => Promise<unknown>,
 *   guardar?: (e: Estado) => void | Promise<void>, log?: (m: string) => void }} p
 * @returns {Promise<{ estado: Estado, publicada: string | null, motivo: string, fallar: boolean }>}
 */
export async function espejar({ cuenta, config, estado: inicial, igUser, token, ahora = new Date(), env = process.env, fetch: f = fetch, espera = (ms) => new Promise((r) => setTimeout(r, ms)), guardar = () => {}, log = () => {} }) {
  let estado = inicial
  const fin = (/** @type {string} */ motivo, fallar = false, publicada = /** @type {string | null} */ (null)) => ({ estado, publicada, motivo, fallar })
  const apagado = motivoApagado(cuenta, env)
  if (apagado) return fin(apagado)
  const graph = crearGraph({ token, fetch: f, espera })
  const tocar = async (/** @type {string} */ id, /** @type {Partial<Intento>} */ cambios) => {
    estado = { ...estado, historias: { ...estado.historias, [id]: { .../** @type {Intento} */ (estado.historias[id]), ...cambios } } }
    await guardar(estado)
  }

  try {
    // Un intento que quedó a mitad: sólo se da por publicado si Meta lo dice; si no, se descarta y no se reintenta.
    for (const [id, x] of Object.entries(estado.historias)) {
      if (x.publicado_at || x.descartada_at) continue
      let status = null
      if (x.ig_container_id) status = (await graph.llamar('GET', `/${x.ig_container_id}`, { fields: 'status_code' }).catch(() => ({}))).status_code ?? null
      if (status === 'PUBLISHED') await tocar(id, { publicado_at: x.creando_at, error: null })
      else await tocar(id, { descartada_at: ahora.toISOString(), error: x.error ?? `quedó a mitad (${status ?? 'sin estado'})` })
    }

    const yo = await graph.conReintentos(() => graph.llamar('GET', `/${igUser}`, { fields: 'username' }))
    if (yo.username !== cuenta.usuario) return fin(`el token es de @${yo.username ?? '?'}, no de @${cuenta.usuario}`, true)
    const reels = await leerReels(graph, igUser)
    const e = elegir({ reels: publicaLaFabrica(cuenta, env) ? reels.filter((r) => r.feed) : reels, estado, config, ahora })
    if (!e.reel) return fin(e.motivo)
    const { reel } = e

    const bajada = await f(/** @type {string} */ (reel.url), { signal: AbortSignal.timeout(120_000) })
    if (!bajada.ok) return fin(`no se pudo bajar el reel ${reel.id} (HTTP ${bajada.status}): se reintenta`)
    const video = new Uint8Array(await bajada.arrayBuffer())

    await tocar(reel.id, { creando_at: ahora.toISOString(), ig_container_id: null, publicado_at: null, historia_id: null, de_feed: reel.feed, descartada_at: null, error: null })
    try {
      // Meta no acepta la media_url de su propio CDN como video_url (2207076): se sube el archivo.
      const c = await graph.llamar('POST', `/${igUser}/media`, { media_type: 'STORIES', upload_type: 'resumable' })
      await tocar(reel.id, { ig_container_id: String(c.id) })
      const subida = await f(String(c.uri), { method: 'POST', headers: { authorization: `OAuth ${token}`, offset: '0', file_size: String(video.length) }, body: video, signal: AbortSignal.timeout(300_000) })
      if (!subida.ok) throw new ErrorGraph(`la subida respondió HTTP ${subida.status}`, { http: subida.status })
      let listo = false
      for (let k = 0; k < SONDEOS && !listo; k++) {
        await espera(5000)
        const d = await graph.conReintentos(() => graph.llamar('GET', `/${c.id}`, { fields: 'status_code,status' }))
        if (d.status_code === 'ERROR' || d.status_code === 'EXPIRED') throw new ErrorGraph(`Meta no pudo procesar el video: ${String(d.status ?? d.status_code).slice(0, 200)}`)
        listo = d.status_code === 'FINISHED'
      }
      if (!listo) throw new ErrorGraph('el contenedor sigue procesando')
    } catch (err) {
      // Nada salió todavía: se descarta este reel y mañana se elige otro.
      await tocar(reel.id, { descartada_at: ahora.toISOString(), error: String(/** @type {Error} */ (err).message).slice(0, 300) })
      throw err
    }
    const r = await graph.llamar('POST', `/${igUser}/media_publish`, { creation_id: /** @type {string} */ (estado.historias[reel.id]?.ig_container_id) })
    await tocar(reel.id, { publicado_at: ahora.toISOString(), historia_id: String(r.id) })
    log(`historia publicada del reel ${reel.id}: ${r.id}`)
    return fin('1 publicada', false, String(r.id))
  } catch (err) {
    if (!(err instanceof ErrorGraph)) throw err
    return fin(err.message, true)
  }
}

async function main() {
  const i = process.argv.indexOf('--cuenta')
  const id = i === -1 ? null : process.argv[i + 1]
  if (!id) throw new Error('uso: node nucleo/espejo.mjs --cuenta <id>')
  const env = process.env
  const raiz = resolve(env.FABRICA_RAIZ ?? '.')
  const cuenta = cargarCuenta(id, raiz)
  const config = JSON.parse(readFileSync(join(raiz, 'cuentas', id, 'espejo.json'), 'utf8'))
  const igUser = env[cuenta.secretos.ig_user]?.trim()
  const token = env[cuenta.secretos.ig_token]?.trim()
  const log = (/** @type {string} */ m) => console.log(`[espejo:${id}] ${m}`)
  if (!igUser || !token) return log('faltan los secretos de Instagram')
  const dir = resolve(env.FABRICA_ESTADO ?? join(raiz, '..', 'estado'))
  const ruta = join(dir, rutaEstado(id))
  const git = gitEn(dir)
  const guardar = async (/** @type {Estado} */ e) => {
    mkdirSync(dirname(ruta), { recursive: true })
    writeFileSync(ruta, `${JSON.stringify(e, null, 2)}\n`)
    if (env.FABRICA_PUSH !== '1') return
    git(['add', rutaEstado(id)])
    git(['commit', '-q', '-m', `historias ${id}`])
    // Este archivo sólo lo escribe este job: el rebase sobre lo que pusheen los otros no choca.
    for (let k = 0; ; k++) {
      try {
        git(['fetch', '-q', 'origin', 'estado'])
        git(['rebase', '-q', 'FETCH_HEAD'])
        git(['push', '-q', 'origin', 'HEAD:refs/heads/estado'])
        return
      } catch (err) {
        if (k >= 4) throw err
        await new Promise((r) => setTimeout(r, 2000 * (k + 1)))
      }
    }
  }
  const estado = leerEstado(existsSync(ruta) ? readFileSync(ruta, 'utf8') : '')
  const r = await espejar({ cuenta, config, estado, igUser, token, guardar, log })
  console.log(`::${r.fallar ? 'error' : 'notice'}::[espejo:${id}] ${r.motivo}`)
  if (r.fallar) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
