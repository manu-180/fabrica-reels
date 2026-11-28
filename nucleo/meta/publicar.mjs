// @ts-check
import { variablePausa } from '../cuenta.mjs'
import { alPublicar, cola, descartarViejas, siguiente } from '../agenda.mjs'
import { actualizarRampa, aplicarErrorRampa, leerCuentaReal, levantarPausaVencida, reintentarPrueba } from '../antispam.mjs'
import { publicacionDe, textoRef, todasLasPublicaciones, tocarPublicacion, varianteDe } from '../estado.mjs'
import { HORA } from '../tiempo.mjs'
import { clasificarErrorMeta, motivoPausa } from './errores.mjs'
import { ErrorGraph, crearGraph } from './graph.mjs'
import { historiaYaPublicada } from './historias.mjs'

/*
  Publica en una cuenta lo que la cola tiene vencido, como mucho antispam.max_por_corrida por tic.
  Nunca dos veces lo mismo: el estado se guarda (y el workflow lo pushea) antes de pedir un contenedor
  de historia, después de crearlo y después de cada media_publish; antes de publicar un reel se busca
  su caption (único por publicación) en la media de 48 h; un contenedor guardado del que no se sabe qué
  pasó no se reemplaza por otro; una historia con un intento anterior se busca en /stories.
*/

const SONDEOS = 36
const SONDEO_MS = 10_000
// Tres corridas seguidas con Meta rota (sin ser token, permiso ni bloqueo) ya no es mala suerte: que avise.
const FALLAS_PARA_AVISAR = 3
const SIN_ID_H = 48

/** @param {number} ms */
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

class Frenar extends Error {}

/** @param {any} t */
const fechaDe = (t) => {
  const ms = Date.parse(String(t ?? ''))
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * @typedef {import('../estado.mjs').EstadoV2} EstadoV2
 * @typedef {import('../estado.mjs').Ref} Ref
 * @typedef {import('../cuenta.mjs').Cuenta} Cuenta
 */

/**
 * Las que salieron en las últimas 48 h sin id de media (una corrida se cortó entre media_publish y el
 * estado, o el contenedor apareció PUBLISHED). Las historias no: sin caption no hay cómo encontrarlas.
 * @param {EstadoV2} estado @param {Date} ahora @returns {Ref[]}
 */
export function publicadasSinId(estado, ahora) {
  const desde = ahora.getTime() - SIN_ID_H * HORA
  return todasLasPublicaciones(estado)
    .filter((x) => x.ref.destino !== 'historia' && x.pub.publicado_at && !x.pub.ig_media_id && Date.parse(x.pub.publicado_at) >= desde)
    .map((x) => x.ref)
}

/**
 * @param {{ cuenta: Cuenta, estado: EstadoV2, ahora?: Date, env?: Record<string, string | undefined>, fetch?: typeof fetch,
 *   espera?: (ms: number) => Promise<unknown>, ya?: boolean, guardar?: (e: EstadoV2) => void | Promise<void>, log?: (m: string) => void,
 *   reloj?: () => Date, semilla?: string }} p
 * @returns {Promise<{ estado: EstadoV2, publicadas: string[], motivo: string, fallar: boolean }>}
 */
export async function publicarCuenta({ cuenta, estado: inicial, ahora = new Date(), env = process.env, fetch: f = fetch, espera = dormir, ya = false, guardar = () => {}, log = () => {}, reloj = () => new Date(), semilla = cuenta.id }) {
  let estado = reintentarPrueba(levantarPausaVencida(inicial, ahora), ahora)
  /** @type {string[]} */
  const publicadas = []
  let fallar = false
  const fin = (/** @type {string} */ motivo) => ({ estado, publicadas, motivo, fallar })
  const guardarYa = async () => {
    await guardar(estado)
  }

  const d = descartarViejas({ estado, ahora })
  if (d.descartadas) {
    estado = d.estado
    log(`${d.descartadas} publicaciones vencidas sin salir: se descartan`)
  }
  if (estado !== inicial) await guardarYa()

  if (env.FABRICA_PAUSADA === '1') return fin('FABRICA_PAUSADA=1: no se publica nada')
  if (env[variablePausa(cuenta.id)] === '1') return fin(`${variablePausa(cuenta.id)}=1: no se publica en esta cuenta`)
  if (cuenta.modo === 'sombra') return fin('modo sombra: se produce pero no se publica')
  const igUser = env[cuenta.secretos.ig_user]?.trim()
  const token = env[cuenta.secretos.ig_token]?.trim()
  if (!igUser || !token) return fin(`faltan los secretos ${cuenta.secretos.ig_user} / ${cuenta.secretos.ig_token}: las publicaciones esperan`)
  if (estado.pausado && estado.pausado_por !== 'token') return fin(`pausado: ${estado.pausado}`)

  const graph = crearGraph({ token, fetch: f, espera })

  /** @param {Ref} ref @param {Partial<import('../estado.mjs').Publicacion>} cambios */
  const tocar = (ref, cambios) => {
    estado = tocarPublicacion(estado, ref, cambios)
  }
  /** @param {'token' | 'permiso' | 'bloqueo'} por @param {string} msg */
  const pausar = async (por, msg) => {
    estado = { ...estado, pausado: motivoPausa(por, msg, cuenta.secretos), pausado_por: por, pausado_hasta: null }
    fallar = true
    await guardarYa()
    return new Frenar(`pausado: ${estado.pausado}`)
  }
  /** @param {Ref} ref @param {string} id @param {string | null} permalink @param {string} at */
  const marcarPublicada = async (ref, id, permalink, at) => {
    tocar(ref, { ig_media_id: id, permalink, publicado_at: at, error_publicar: null, clase_error: null })
    estado = alPublicar({ estado, cuenta, ref, publicado_at: at, semilla })
    await guardarYa()
  }

  /**
   * Lo que no es de esta publicación frena la corrida (y pausa si hace falta); lo de la publicación
   * queda anotado.
   * @param {unknown} e @param {Ref} ref
   */
  const manejar = async (e, ref) => {
    if (!(e instanceof ErrorGraph)) throw e
    const clase = clasificarErrorMeta(e, { destino: ref.destino })
    const at = reloj().toISOString()
    if (ref.destino === 'historia' && (clase === 'permiso' || clase === 'publicacion')) {
      if (clase === 'permiso') estado = { ...estado, destinos_apagados: { ...estado.destinos_apagados, historia: { motivo: `Meta no deja publicar historias: ${e.message}`, at } } }
      tocar(ref, { descartada_at: at, motivo_descarte: 'historia no disponible', error_publicar: e.message, clase_error: clase })
      log(`${textoRef(ref)}: historia no disponible (${e.message}); la prueba y la normal siguen`)
      await guardarYa()
      return
    }
    if (clase === 'permiso-trial') {
      estado = { ...estado, destinos_apagados: { ...estado.destinos_apagados, prueba: { motivo: `Meta rechaza los reels de prueba en esta cuenta: ${e.message}`, at } } }
      tocar(ref, { error_publicar: e.message, clase_error: clase })
      log(`${cuenta.id}: se apaga el destino prueba (${e.message}); normal e historia siguen`)
      await guardarYa()
      return
    }
    if (clase === 'token' || clase === 'permiso' || clase === 'bloqueo') throw await pausar(clase, e.message)
    if (clase === 'antispam') {
      tocar(ref, { error_publicar: `antispam de Meta (${e.message}): sale en otro tic`, clase_error: clase })
      estado = aplicarErrorRampa({ estado, cuenta, codigo: `${e.codigo ?? '?'}${e.subcodigo ? `/${e.subcodigo}` : ''}`, ahora: reloj() })
      await guardarYa()
      throw new Frenar(`antispam de Meta: ${e.message}`)
    }
    if (clase === 'cupo') {
      tocar(ref, { error_publicar: `sin cupo de Meta (${e.message}): sale en otro tic`, clase_error: clase })
      await guardarYa()
      throw new Frenar(`sin cupo de Meta: ${e.message}`)
    }
    if (clase === 'transitorio') tocar(ref, { error_publicar: `Meta falló de forma transitoria (${e.message}): se reintenta`, clase_error: clase })
    else tocar(ref, { error_publicar: e.message, clase_error: clase, intentos_publicar: (publicacionDe(estado, ref)?.intentos_publicar ?? 0) + 1 })
    await guardarYa()
  }

  let motivo = 'no hay nada vencido'
  try {
    if (estado.pausado) {
      try {
        await graph.llamar('GET', `/${igUser}`, { fields: 'id' })
      } catch {
        return fin(`pausado: ${estado.pausado}`)
      }
      estado = { ...estado, pausado: null, pausado_por: null, pausado_hasta: null }
      log('el token de Instagram volvió a andar: se despausa')
      await guardarYa()
    }
    const conRampa = actualizarRampa({ estado, cuenta, ahora })
    if (conRampa !== estado) {
      estado = conRampa
      await guardarYa()
    }

    for (let k = 0; k < cuenta.antispam.max_por_corrida; k++) {
      const cuentaReal = await leerCuentaReal({ igUser, token, ahora, fetch: f, espera, estado })
      const porCaption = new Map(cuentaReal.recientes.map((m) => [m.caption.trim(), m]))
      let completadas = false
      for (const ref of publicadasSinId(estado, ahora)) {
        const m = porCaption.get(String(publicacionDe(estado, ref)?.caption ?? '').trim())
        if (!m) continue
        tocar(ref, { ig_media_id: m.id, permalink: m.permalink, publicado_at: fechaDe(m.timestamp) ?? publicacionDe(estado, ref)?.publicado_at ?? null, error_publicar: null })
        completadas = true
      }
      // Antes del antispam: lo que ya está en la cuenta no se publica, se reconoce (y no tiene que
      // esperar el gap que su propia salida provoca).
      for (const x of cola({ estado, cuenta, ahora })) {
        const p = /** @type {import('../estado.mjs').Publicacion} */ (publicacionDe(estado, x.ref))
        const v = /** @type {import('../estado.mjs').Variante} */ (varianteDe(estado, x.ref))
        const m = x.ref.destino !== 'historia' ? porCaption.get(p.caption.trim()) : null
        if (m) {
          await marcarPublicada(x.ref, m.id, m.permalink, fechaDe(m.timestamp) ?? reloj().toISOString())
          log(`${textoRef(x.ref)} ya estaba publicada (${m.permalink ?? m.id}): se toma de Instagram`)
          continue
        }
        if (x.ref.destino === 'historia' && p.creando_at && !p.ig_container_id) {
          const h = historiaYaPublicada({ estado, pub: p, historias: cuentaReal.historias, duracion_s: v.duracion_s })
          if (h) {
            await marcarPublicada(x.ref, h.id, null, h.at)
            log(`${textoRef(x.ref)}: la historia del intento anterior está en la cuenta (${h.id}): no se publica otra`)
          }
        }
      }

      const s = siguiente({ estado, cuenta, ahora, cuentaReal, ya })
      if (!s.ref) {
        motivo = s.motivo
        break
      }
      const ref = s.ref
      const pub = /** @type {import('../estado.mjs').Publicacion} */ (publicacionDe(estado, ref))
      if (ref.destino !== 'historia') {
        const previo = porCaption.get(pub.caption.trim())
        if (previo) {
          await marcarPublicada(ref, previo.id, previo.permalink, fechaDe(previo.timestamp) ?? reloj().toISOString())
          log(`${textoRef(ref)} ya estaba publicada (${previo.permalink ?? previo.id}): se toma de Instagram`)
          continue
        }
      }
      try {
        const contenedor = await contenedorDe(ref, porCaption, cuentaReal.historias)
        if (!contenedor) continue
        await esperarListo(contenedor)
        const r = await graph.llamar('POST', `/${igUser}/media_publish`, { creation_id: contenedor })
        const mediaId = String(r.id)
        let permalink = null
        try {
          permalink = (await graph.llamar('GET', `/${mediaId}`, { fields: 'permalink' })).permalink ?? null
        } catch {
          /* el permalink lo completa medir */
        }
        await marcarPublicada(ref, mediaId, permalink, reloj().toISOString())
        publicadas.push(textoRef(ref))
        log(`${textoRef(ref)} publicada: ${permalink ?? mediaId}`)
      } catch (e) {
        await manejar(e, ref)
      }
    }
  } catch (e) {
    if (e instanceof Frenar) return fin(e.message)
    if (!(e instanceof ErrorGraph)) throw e
    const clase = clasificarErrorMeta(e)
    if (clase === 'token' || clase === 'permiso' || clase === 'bloqueo') return fin((await pausar(clase, e.message)).message)
    if (clase === 'antispam' || clase === 'cupo') return fin(`Meta frenó la lectura (${e.message}): hasta el próximo tic`)
    const fallas = (estado.fallas_seguidas ?? 0) + 1
    estado = { ...estado, fallas_seguidas: fallas }
    fallar = fallas >= FALLAS_PARA_AVISAR
    await guardarYa()
    return fin(`Meta no respondió bien (${e.message}): ${fallas} corrida${fallas === 1 ? '' : 's'} seguida${fallas === 1 ? '' : 's'} así`)
  }
  if (estado.fallas_seguidas) {
    estado = { ...estado, fallas_seguidas: 0 }
    await guardarYa()
  }
  return fin(publicadas.length ? `${publicadas.length} publicada${publicadas.length === 1 ? '' : 's'}` : motivo)

  /**
   * El contenedor de la publicación. Uno guardado se reusa si sigue FINISHED o IN_PROGRESS; sólo EXPIRED
   * o ERROR habilitan uno nuevo; si no se puede leer, no se crea otro (podría haberse publicado). Una
   * PUBLISHED ya salió: se marca y devuelve null.
   * @param {Ref} ref @param {Map<string, any>} porCaption @param {{ id: string, at: string }[] | null} historias @returns {Promise<string | null>}
   */
  async function contenedorDe(ref, porCaption, historias) {
    const pub = /** @type {import('../estado.mjs').Publicacion} */ (publicacionDe(estado, ref))
    const v = /** @type {import('../estado.mjs').Variante} */ (varianteDe(estado, ref))
    if (pub.ig_container_id) {
      /** @type {any} */
      let d
      try {
        d = await graph.llamar('GET', `/${pub.ig_container_id}`, { fields: 'status_code' })
      } catch (e) {
        if (e instanceof ErrorGraph && ['token', 'permiso', 'bloqueo'].includes(clasificarErrorMeta(e))) throw e
        throw new ErrorGraph(`no se pudo leer el contenedor ${pub.ig_container_id} (${String(/** @type {Error} */ (e).message).slice(0, 120)}): no se crea otro hasta saber qué pasó`, { transitorio: true })
      }
      if (d.status_code === 'FINISHED' || d.status_code === 'IN_PROGRESS') return pub.ig_container_id
      if (d.status_code === 'PUBLISHED') {
        const m = ref.destino === 'historia' ? historiaYaPublicada({ estado, pub, historias, duracion_s: v.duracion_s }) : porCaption.get(pub.caption.trim())
        if (m) await marcarPublicada(ref, String(m.id), m.permalink ?? null, fechaDe(m.timestamp ?? m.at) ?? reloj().toISOString())
        else {
          const at = reloj().toISOString()
          tocar(ref, { publicado_at: at, error_publicar: 'publicada en una corrida que se cortó: el id se toma de Instagram cuando la liste' })
          estado = alPublicar({ estado, cuenta, ref, publicado_at: at, semilla })
          await guardarYa()
        }
        return null
      }
      if (d.status_code !== 'EXPIRED' && d.status_code !== 'ERROR') throw new ErrorGraph(`el contenedor ${pub.ig_container_id} está en ${d.status_code ?? 'un estado desconocido'}: se mira en la próxima`, { transitorio: true })
      if (ref.destino === 'historia') {
        const h = historiaYaPublicada({ estado, pub, historias, duracion_s: v.duracion_s })
        if (h) {
          await marcarPublicada(ref, h.id, null, h.at)
          return null
        }
      }
    }
    const video = ref.destino === 'historia' ? (v.video_historia_url ?? v.video_url) : v.video_url
    if (!video) throw new ErrorGraph('la variante no tiene video')
    if (ref.destino === 'historia') return contenedorHistoria(ref, video, historias)
    /** @type {Record<string, string>} */
    const como = ref.destino === 'normal' ? { share_to_feed: String(cuenta.destinos.normal.share_to_feed) } : { trial_params: JSON.stringify({ graduation_strategy: cuenta.destinos.prueba.trial }) }
    const c = await graph.llamar('POST', `/${igUser}/media`, { media_type: 'REELS', video_url: video, caption: pub.caption, ...como })
    tocar(ref, { ig_container_id: String(c.id) })
    await guardarYa()
    return String(c.id)
  }

  /**
   * `creando_at` queda guardado (y pusheado) antes de pedir el contenedor: si la corrida se corta entre
   * la respuesta y el estado, el contenedor se perdió y lo único que queda es buscar la historia en
   * /stories. Si no aparece, ese día no se pide otra. Si Meta contestó con error, no se creó nada y la
   * marca se saca.
   * @param {Ref} ref @param {string} video @param {{ id: string, at: string }[] | null} historias @returns {Promise<string | null>}
   */
  async function contenedorHistoria(ref, video, historias) {
    const pub = /** @type {import('../estado.mjs').Publicacion} */ (publicacionDe(estado, ref))
    const v = /** @type {import('../estado.mjs').Variante} */ (varianteDe(estado, ref))
    if (!pub.ig_container_id && pub.creando_at) {
      const h = historiaYaPublicada({ estado, pub, historias, duracion_s: v.duracion_s })
      if (h) {
        await marcarPublicada(ref, h.id, null, h.at)
        log(`${textoRef(ref)}: la historia del intento anterior está en la cuenta (${h.id}): no se publica otra`)
        return null
      }
      tocar(ref, { descartada_at: reloj().toISOString(), motivo_descarte: `se perdió el contenedor de la historia (pedido ${pub.creando_at}): hoy no se reintenta` })
      await guardarYa()
      return null
    }
    tocar(ref, { creando_at: reloj().toISOString() })
    await guardarYa()
    /** @type {any} */
    let c
    try {
      c = await graph.llamar('POST', `/${igUser}/media`, { media_type: 'STORIES', video_url: video })
    } catch (e) {
      if (!(e instanceof ErrorGraph && e.transitorio)) tocar(ref, { creando_at: pub.creando_at ?? null })
      throw e
    }
    tocar(ref, { ig_container_id: String(c.id) })
    await guardarYa()
    return String(c.id)
  }

  /** @param {string} id */
  async function esperarListo(id) {
    for (let k = 0; k < SONDEOS; k++) {
      await espera(k === 0 ? 5000 : SONDEO_MS)
      /** @type {any} */
      let d
      try {
        d = await graph.llamar('GET', `/${id}`, { fields: 'status_code,status' })
      } catch (e) {
        // Regresión de Meta (2026-05-22): el GET del status_code da 100/GraphMethodException con un
        // token válido en un contenedor recién creado. Se espera y se publica.
        if (e instanceof ErrorGraph && e.codigo === 100 && /GraphMethodException|Authorization/i.test(e.message)) {
          await espera(60_000)
          return
        }
        if (e instanceof ErrorGraph && e.transitorio && !e.token) continue
        throw e
      }
      if (d.status_code === 'FINISHED') return
      if (d.status_code === 'ERROR' || d.status_code === 'EXPIRED') throw new ErrorGraph(`Meta no pudo procesar el video: ${String(d.status ?? d.status_code).slice(0, 200)}`)
    }
    throw new ErrorGraph(`el contenedor ${id} sigue procesando después de ${Math.round((SONDEOS * SONDEO_MS) / 60_000)} min`, { transitorio: true })
  }
}
