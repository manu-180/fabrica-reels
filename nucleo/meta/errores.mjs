// @ts-check

const DE_TOKEN = new Set([102, 190])
const DE_ANTISPAM = new Set([4, 9, 17, 32, 341, 613])
const SUB_ANTISPAM = new Set([2207078])
const SUB_CUPO = new Set([2207042])
const SUB_BLOQUEO = new Set([2207050, 2207051])

/**
 * La tabla del diseño § 8.4. El orden importa: un 9/2207042 es cupo y no antispam, un 9/2207051 es
 * bloqueo, y un "not ready" con código de límite sigue siendo transitorio.
 * @param {{ codigo?: number, subcodigo?: number, http?: number, transitorio?: boolean, message?: string }} e
 * @param {{ destino?: 'prueba' | 'normal' | 'historia' | null }} [o]
 * @returns {import('../estado.mjs').ClaseError}
 */
export function clasificarErrorMeta(e, { destino = null } = {}) {
  const codigo = e.codigo
  const sub = e.subcodigo
  const mensaje = String(e.message ?? '')
  if (codigo !== undefined && DE_TOKEN.has(codigo)) return 'token'
  if ((sub !== undefined && SUB_BLOQUEO.has(sub)) || codigo === 368 || /block|bloque|spam|restrict/i.test(mensaje)) return 'bloqueo'
  // "Media not ready": el contenedor todavía no terminó de procesarse; no es culpa de la publicación.
  if (codigo === 9007 || sub === 2207027 || /not ready|not finished|no est[aá] list/i.test(mensaje)) return 'transitorio'
  if ((sub !== undefined && SUB_CUPO.has(sub)) || /content_publishing_limit|maximum number of posts/i.test(mensaje)) return 'cupo'
  if ((sub !== undefined && SUB_ANTISPAM.has(sub)) || (codigo !== undefined && DE_ANTISPAM.has(codigo))) return 'antispam'
  const dePermiso = codigo === 10 || (codigo !== undefined && codigo >= 200 && codigo <= 299)
  // Una cuenta sin reels de prueba rechaza trial_params en todas: se apaga ese destino, no la cuenta (D6).
  if (destino === 'prueba' && (dePermiso || /trial/i.test(mensaje))) return 'permiso-trial'
  if (dePermiso || /trial/i.test(mensaje)) return 'permiso'
  if (e.transitorio || (e.http ?? 0) >= 500 || codigo === 1 || codigo === 2) return 'transitorio'
  return 'publicacion'
}

/** Las clases que frenan la cuenta entera (no sólo la publicación). */
export const DE_CUENTA = new Set(['token', 'permiso', 'bloqueo', 'antispam', 'cupo'])

/**
 * El motivo legible de una pausa, igual venga de donde venga el error.
 * @param {'token' | 'permiso' | 'bloqueo'} por @param {string} msg @param {{ ig_token: string }} secretos
 */
export function motivoPausa(por, msg, secretos) {
  if (por === 'token') return `el token de Instagram está vencido o revocado (${msg}): hay que renovar ${secretos.ig_token}`
  if (por === 'permiso') return `Meta no deja publicar con este token (${msg}): faltan permisos`
  return `Instagram frenó la cuenta (${msg}): revisarla a mano antes de despausar`
}
