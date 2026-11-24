// @ts-check
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cargarCuenta } from '../cuenta.mjs'
import { estadoVacio, publicacionVacia } from '../estado.mjs'
import { finDelDia } from '../tiempo.mjs'

/* Lo que comparten los tests del núcleo: las dos cuentas de prueba, un estado armado a mano y una Graph API de mentira. */

export const RAIZ = dirname(fileURLToPath(import.meta.url))
export const cuentaAr = () => cargarCuenta('prueba-ar', RAIZ)
export const cuentaWeb = () => cargarCuenta('prueba-web', RAIZ)
export const ENV_AR = { IG_PRUEBA_AR_USER_ID: '178', IG_PRUEBA_AR_TOKEN: 'EAAtoken' }
export const ENV_WEB = { IG_PRUEBA_WEB_USER_ID: '178', IG_PRUEBA_WEB_TOKEN: 'EAAtoken' }
export const FIXTURES = join(RAIZ, 'cuentas')

/** @param {Partial<import('../estado.mjs').Firma>} [extra] @returns {import('../estado.mjs').Firma} */
export const firma = (extra = {}) => ({ formato: 'chat', layout: 'hoja', motivo: 'cuaderno', paleta: 'papel', hook: 0, musica: 'acustica-1', cierre: 'papel-sello', color: 'neutro', textura: 'nada', ffmpeg: { zoom: 1, encuadre: 'centro', velocidad: 1 }, ...extra })

/**
 * Un creativo con una variante por cada elemento de `variantes`: { destino: cambios } con las publicaciones que tiene.
 * @param {string} id @param {Record<string, Partial<import('../estado.mjs').Publicacion>>[]} variantes @param {Partial<import('../estado.mjs').Creativo>} [extra]
 * @returns {import('../estado.mjs').Creativo}
 */
export function creativo(id, variantes, extra = {}) {
  const fecha = extra.fecha ?? id.slice(0, 10)
  return {
    id, clave: id.slice(11) || 'x', idea: null, tema: null, fecha, titulo: 'x', categoria: 'comedia', formato: 'chat', ronda: 0, slot: 0,
    producido_at: `${fecha}T08:30:00.000Z`, error: null, falla: null, intentos: 0, voz: null,
    variantes: variantes.map((pubs, indice) => ({
      indice, hook: 0, firma: firma(), resumen: 'x', video_url: `https://x.public.blob.vercel-storage.com/videos/${id}-${indice}.mp4`, video_historia_url: null, duracion_s: 20,
      publicaciones: Object.fromEntries(Object.entries(pubs).map(([d, cambios]) => [d, { ...publicacionVacia(/** @type {any} */ (d), d === 'historia' ? '' : `caption ${id} ${indice} ${d}`, finDelDia(fecha)), ...cambios }])),
    })),
    ...extra,
  }
}

/** @param {string} cuenta @param {import('../estado.mjs').Creativo[]} creativos @returns {import('../estado.mjs').EstadoV2} */
export function estadoCon(cuenta, creativos) {
  const e = estadoVacio(cuenta, new Date('2026-11-09T08:00:00Z'))
  for (const c of creativos) e.creativos[c.id] = c
  return e
}

/**
 * Una Graph API de mentira: rutas por método y path; registra cada llamada con sus parámetros.
 * @param {[string, RegExp, (p: Record<string, string>, m: RegExpMatchArray) => any][]} rutas
 */
export function graphFalso(rutas) {
  /** @type {{ metodo: string, ruta: string, params: Record<string, string>, token: string }[]} */
  const llamadas = []
  /** @type {typeof fetch} */
  const f = async (entrada, init = {}) => {
    const url = new URL(String(entrada))
    const metodo = init.method ?? 'GET'
    const params = Object.fromEntries(metodo === 'GET' ? url.searchParams : new URLSearchParams(String(init.body ?? '')))
    const token = params.access_token ?? ''
    delete params.access_token
    const ruta = url.pathname.replace(/^\/v\d+\.\d+/, '') || '/'
    llamadas.push({ metodo, ruta, params, token })
    for (const [m, patron, hacer] of rutas) {
      const coincide = ruta.match(patron)
      if (m === metodo && coincide) {
        const r = hacer(params, coincide)
        return new Response(JSON.stringify(r), { status: r?.__status ?? (r?.error ? 400 : 200), headers: { 'content-type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ error: { code: 100, message: `ruta falsa sin definir: ${metodo} ${ruta}` } }), { status: 400 })
  }
  return { fetch: f, llamadas }
}

/** @param {number} code @param {string} message @param {number} [subcode] */
export const errorMeta = (code, message, subcode) => ({ error: { code, message, ...(subcode ? { error_subcode: subcode } : {}), type: 'OAuthException' } })

/** @param {number} ms */
export const sinEspera = async (ms) => ms
