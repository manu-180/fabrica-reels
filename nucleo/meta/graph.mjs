// @ts-check

// Sólo la Graph API oficial: una librería no oficial o automatizar el navegador hace que Instagram bloquee la cuenta.

const VERSION = process.env.IG_GRAPH_VERSION || 'v24.0'
const TRANSITORIOS = new Set([1, 2, 4, 17, 32, 341, 613])
const DE_TOKEN = new Set([102, 190])

export class ErrorGraph extends Error {
  /** @param {string} mensaje @param {{ http?: number, codigo?: number, subcodigo?: number, transitorio?: boolean }} info */
  constructor(mensaje, { http = 0, codigo, subcodigo, transitorio = false } = {}) {
    super(mensaje)
    this.http = http
    this.codigo = codigo
    this.subcodigo = subcodigo
    this.transitorio = transitorio || http >= 500 || (codigo !== undefined && TRANSITORIOS.has(codigo))
    this.token = codigo !== undefined && DE_TOKEN.has(codigo)
  }
}

/** @param {number} ms */
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {{ token: string, fetch?: typeof fetch, espera?: (ms: number) => Promise<unknown> }} p
 */
export function crearGraph({ token, fetch: f = fetch, espera = dormir }) {
  // Un token de "Instagram Login" (IGAA…) va contra graph.instagram.com; uno de página, contra graph.facebook.com.
  const base = `https://${token.startsWith('IG') ? 'graph.instagram.com' : 'graph.facebook.com'}/${VERSION}`

  /** @param {'GET' | 'POST'} metodo @param {string} ruta @param {Record<string, string>} params */
  async function llamar(metodo, ruta, params) {
    const url = new URL(`${base}${ruta}`)
    /** @type {RequestInit} */
    const init = { method: metodo, signal: AbortSignal.timeout(60_000) }
    if (metodo === 'GET') for (const [k, v] of Object.entries({ ...params, access_token: token })) url.searchParams.set(k, v)
    else init.body = new URLSearchParams({ ...params, access_token: token })
    /** @type {Response} */
    let r
    try {
      r = await f(url, init)
    } catch (e) {
      throw new ErrorGraph(`sin respuesta de Meta: ${String(/** @type {Error} */ (e).message).slice(0, 120)}`, { transitorio: true })
    }
    const texto = await r.text()
    /** @type {any} */
    let datos = {}
    try {
      datos = texto ? JSON.parse(texto) : {}
    } catch {
      throw new ErrorGraph(`respuesta no JSON (HTTP ${r.status})`, { http: r.status })
    }
    if (!r.ok || datos.error) {
      const e = datos.error ?? {}
      throw new ErrorGraph(`Meta ${e.code ?? r.status}${e.error_subcode ? `/${e.error_subcode}` : ''}: ${String(e.message ?? 'error').slice(0, 200)}`, {
        http: r.status,
        codigo: e.code,
        subcodigo: e.error_subcode,
        transitorio: e.is_transient === true,
      })
    }
    return datos
  }

  /** Reintenta solo lo transitorio, con espera creciente. @template T @param {() => Promise<T>} hacer */
  async function conReintentos(hacer, veces = 3) {
    for (let k = 0; ; k++) {
      try {
        return await hacer()
      } catch (e) {
        if (!(e instanceof ErrorGraph) || !e.transitorio || k >= veces - 1) throw e
        await espera(5000 * (k + 1))
      }
    }
  }

  return { llamar, conReintentos }
}
