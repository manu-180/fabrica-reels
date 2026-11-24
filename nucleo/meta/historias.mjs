// @ts-check
import { todasLasPublicaciones } from '../estado.mjs'
import { MIN } from '../tiempo.mjs'

// La segunda red de las historias: si en los 90 min después del intento anterior apareció una historia
// en la cuenta, es la nuestra. Las historias no tienen caption, así que no hay otra forma de reconocerla.
export const VENTANA_HISTORIA_MIN = 90
// Tolerancia de duración si Meta la llega a dar en /stories (hoy no se pide: el campo no está verificado).
const TOLERANCIA_DURACION_S = 0.5

/**
 * La historia de la cuenta que corresponde a un intento anterior de esta publicación, o null. No toma
 * una que ya es de otra publicación del estado.
 * @param {{ estado: import('../estado.mjs').EstadoV2, pub: import('../estado.mjs').Publicacion, historias: { id: string, at: string, duracion_s?: number | null }[] | null,
 *   duracion_s?: number | null }} p
 * @returns {{ id: string, at: string } | null}
 */
export function historiaYaPublicada({ estado, pub, historias, duracion_s = null }) {
  const desde = Date.parse(String(pub.creando_at ?? ''))
  if (!historias?.length || !Number.isFinite(desde)) return null
  const tomadas = new Set(todasLasPublicaciones(estado).map((x) => x.pub.ig_media_id).filter(Boolean))
  const hasta = desde + VENTANA_HISTORIA_MIN * MIN
  const candidatas = historias
    .filter((h) => !tomadas.has(h.id))
    .filter((h) => {
      const t = Date.parse(h.at)
      return t >= desde - MIN && t <= hasta
    })
    .filter((h) => typeof h.duracion_s !== 'number' || typeof duracion_s !== 'number' || Math.abs(h.duracion_s - duracion_s) <= TOLERANCIA_DURACION_S)
    .sort((a, b) => a.at.localeCompare(b.at))
  return candidatas[0] ?? null
}
