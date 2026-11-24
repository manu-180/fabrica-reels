// @ts-check
import { join } from 'node:path'
import { cierreDelReel } from './cierre.mjs'
import { ejesDe, hacerVariante, medio } from './variar.mjs'

export { renderizarCuerpo, renderizarProyecto, HYPERFRAMES, CAPTURAS, TOPE_RENDER_MS } from './hyperframes.mjs'
export { LUFS, PICO, TOPE_MB, revisarSalida, revisarAudio, sondear, medirAudio } from './medios.mjs'
export { cierreDelReel, paginaDe, renderizarCierre } from './cierre.mjs'

/**
 * El mp4 final de una variante para un destino (CONTRATO § 5 bis): el cuerpo con los ejes de su firma,
 * el cierre de la cuenta (el propio del reel si la cuenta lo pide, si no el clip), música por debajo y
 * −14 LUFS. Tira si la salida no pasa revisarSalida o el loudness.
 * @param {{ cuerpo: string, firma: import('../estado.mjs').Firma, clip: import('./cierre.mjs').Clip, musica: string, conVoz: boolean, dir: string,
 *   destino: 'reel' | 'historia', env: Record<string, string>, guion?: any, log?: (m: string) => void }} p
 * @returns {Promise<{ archivo: string, duracion_s: number, bytes: number, lufs: number, pico: number, cierre: { archivo: string, propio: boolean, pagina: string | null } }>}
 */
export async function armarFinal({ cuerpo, firma, clip, musica, conVoz, dir, destino, env, guion, log = () => {} }) {
  if (!env) throw new Error('armarFinal: falta el entorno sin secretos')
  if (!clip?.archivo) throw new Error('armarFinal: falta el clip del cierre')
  const cierre = await cierreDelReel({ clip, destino, firma, cuerpo, dir, env, guion, log })
  const [mc, mi, mm] = await Promise.all([medio(cuerpo, env), medio(cierre.archivo, env), medio(musica, env)])
  if (mc.duracion_s < 3) throw new Error(`el cuerpo dura ${mc.duracion_s} s`)
  const r = await hacerVariante({ ejes: ejesDe(firma), id: `final-${destino}`, cuerpo: mc, cierre: mi, musica: mm, conVoz, dir: join(dir, 'final'), env })
  return { archivo: r.archivo, duracion_s: r.duracion_s, bytes: r.bytes, lufs: r.lufs, pico: r.pico, cierre }
}
