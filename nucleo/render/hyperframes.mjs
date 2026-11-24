// @ts-check
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { correr } from './medios.mjs'

export const HYPERFRAMES = 'hyperframes@0.8.140'

// En los runners de Actions (2 núcleos, 7 GB, GL por software) HyperFrames se colgaba al azar en un
// cuadro fijo ("capture stalled", 8 de 11 renders del 2026-10-08/10) y todos los cuelgues medidos
// fueron con los cuadros extraídos en PNG: en JPG, 24 de 24 limpios. --no-low-memory-mode deja usar
// BeginFrame (el runner tiene menos de 8 GB y si no se fuerza screenshot), que además tarda la mitad.
// Los otros dos son el respaldo, en este orden.
export const CAPTURAS = [
  ['--video-frame-format', 'jpg', '--no-low-memory-mode', '--workers', '1'],
  ['--video-frame-format', 'jpg'],
  ['--video-frame-format', 'png', '--no-low-memory-mode', '--workers', '1'],
]
// Se colgó sin morir en Actions: a los 15 min se lo mata y va la captura siguiente.
export const TOPE_RENDER_MS = 15 * 60_000

/** Los argumentos de un intento. @param {{ proyecto: string, salida: string, extra: string[], depurar?: boolean, estricto?: boolean }} p */
export function argumentosRender({ proyecto, salida, extra, depurar = false, estricto = false }) {
  return ['--yes', HYPERFRAMES, 'render', proyecto, '--output', salida, '--fps', '30', '--quality', 'delivery', ...(estricto ? ['--strict'] : []), depurar ? '--debug' : '--quiet', '--experimental-fast-capture=false', ...extra]
}

/**
 * Un proyecto HyperFrames a mp4, probando las capturas en orden hasta que una escribe el video.
 * `env` es el entorno sin secretos: npx baja y corre código de terceros.
 * @param {{ proyecto: string, salida: string, env: Record<string, string>, log?: (m: string) => void, tope?: number, estricto?: boolean,
 *   ejecutar?: (cmd: string, args: string[], op: any) => Promise<unknown> }} p
 */
export async function renderizarProyecto({ proyecto, salida, env, log = () => {}, tope = TOPE_RENDER_MS, estricto = false, ejecutar = correr }) {
  if (!env) throw new Error('renderizar: falta el entorno sin secretos')
  const windows = process.platform === 'win32'
  const npx = windows ? 'npx.cmd' : 'npx'
  const depurar = env.FABRICA_RENDER_DEBUG || ''
  if (depurar) mkdirSync(depurar, { recursive: true })
  /** @type {unknown} */
  let ultimo = null
  for (const [n, extra] of CAPTURAS.entries()) {
    rmSync(salida, { force: true })
    try {
      await ejecutar(npx, argumentosRender({ proyecto, salida, extra, depurar: Boolean(depurar), estricto }), {
        env, shell: windows, tope, registro: depurar ? join(depurar, `hyperframes-${basename(proyecto)}-${n + 1}.log`) : undefined,
      })
      if (existsSync(salida)) return
      ultimo = new Error('hyperframes terminó sin escribir el video')
    } catch (e) {
      ultimo = e
    }
    log(`hyperframes falló en ${basename(proyecto)} (intento ${n + 1} de ${CAPTURAS.length}): ${String(/** @type {Error} */ (ultimo).message).split('\n')[0]}`)
  }
  throw ultimo
}

/**
 * Lo que producir espera de F4 (CONTRATO § 5 bis).
 * @param {{ proyecto: string, salida: string, log?: (m: string) => void, env: Record<string, string> }} p
 * @returns {Promise<void>}
 */
export async function renderizarCuerpo({ proyecto, salida, log = () => {}, env }) {
  await renderizarProyecto({ proyecto, salida, env, log })
}
