// @ts-check
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderizarProyecto } from './hyperframes.mjs'
import { ffmpeg, medirAudio, sondear } from './medios.mjs'

/*
  El cierre de cada reel. La cuenta lo describe en `cuentas/<id>/cta/cierre.json` (textos, voz ya
  grabada, capturas de su sitio); con eso se renderizan los clips de `cta/clips.json` (cierres.mjs) y,
  si la cuenta lo pide (`por_reel`), un cierre propio para cada reel con la página de su tema (calcular:
  la calculadora de la idea del guion). Si el cierre propio falla, va el clip genérico: un cierre que
  no se pudo armar nunca frena un reel.
*/

export const LUFS_CIERRE = -16
const PICO_CIERRE = -1.5

/**
 * @typedef {{ titular: string, destacado: string, corte?: number | null, ficha?: string | null, pista?: string }} Textos
 * @typedef {{ estilos: string[], textos: Textos, voz: { wav: string, palabras: string } | null, sitio?: string | null, portada?: string | null, por_reel?: boolean }} Destino
 * @typedef {{ reel?: Destino | null, historia?: Destino | null }} ConfigCierre
 * @typedef {{ base: string, temas?: Record<string, string>, capturas: Record<string, { ruta: string, resultado: { x: number, y: number, w: number, h: number } | null }> }} Sitio
 * @typedef {{ id: string, paleta: string, estilo: string, destino: 'reel' | 'historia', archivo: string, duracion_s: number }} Clip
 */

/** @param {string} dir @param {string} rel */
function dentro(dir, rel) {
  if (typeof rel !== 'string' || !rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(`ruta inválida en cierre.json: ${rel}`)
  return resolve(dir, rel)
}

/** La carpeta `cuentas/<id>` de un archivo de su `cta/` (subiendo hasta el cuenta.json). @param {string} archivo */
export function cuentaDeArchivo(archivo) {
  let d = dirname(resolve(archivo))
  for (let k = 0; k < 6; k++) {
    if (existsSync(join(d, 'cuenta.json'))) return d
    const arriba = dirname(d)
    if (arriba === d) break
    d = arriba
  }
  return null
}

/** @param {string} dirCta @returns {ConfigCierre | null} */
export function leerConfigCierre(dirCta) {
  const ruta = join(dirCta, 'cierre.json')
  if (!existsSync(ruta)) return null
  return JSON.parse(readFileSync(ruta, 'utf8'))
}

/** La voz del cierre ya grabada (`cta/voz.wav` + sus palabras). @param {string} dirCta @param {Destino['voz']} voz */
export function vozDelCierre(dirCta, voz) {
  if (!voz) return null
  const wav = dentro(dirCta, voz.wav)
  const j = JSON.parse(readFileSync(dentro(dirCta, voz.palabras), 'utf8'))
  /** @type {{ texto: string, inicio_s: number, fin_s: number }[]} */
  const palabras = j.palabras ?? j
  if (!existsSync(wav) || !Array.isArray(palabras) || !palabras.length) throw new Error(`la voz del cierre está incompleta en ${dirCta}`)
  return { wav, palabras }
}

/**
 * Qué página del sitio muestra el cierre de un guion: la `pagina` de su idea si hay captura de esa
 * ruta; si no, la del tema que nombra la clave (`sitio.temas`); si no, la portada.
 * @param {{ guion: any, sitio: Sitio, ideas?: any[], hay: (clave: string) => boolean, portada?: string }} p
 */
export function paginaDe({ guion, sitio, ideas = [], hay, portada = 'inicio' }) {
  const existe = (/** @type {string} */ c) => Boolean(sitio.capturas[c]) && hay(c)
  if (guion?.idea) {
    const idea = ideas.find((i) => i?.id === guion.idea)
    const ruta = String(idea?.pagina ?? '').replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || null
    const porRuta = ruta === null ? undefined : Object.keys(sitio.capturas).find((c) => sitio.capturas[c]?.ruta === ruta)
    if (porRuta && existe(porRuta)) return porRuta
  }
  const textos = [guion?.tema, guion?.clave].filter((x) => typeof x === 'string')
  for (const t of textos) for (const [tema, c] of Object.entries(sitio.temas ?? {})) if (t.includes(tema) && existe(c)) return c
  return portada
}

/** @param {string} dirCuenta */
function leerIdeas(dirCuenta) {
  try {
    const j = JSON.parse(readFileSync(join(dirCuenta, 'ideas.json'), 'utf8'))
    return Array.isArray(j) ? j : (j.ideas ?? [])
  } catch {
    return []
  }
}

/**
 * La captura que muestra el celular del cierre.
 * @param {{ dirCta: string, destino: Destino, pagina: string | null }} p
 * @returns {{ portada?: string, resultado?: string, ancho: number, marco: { x: number, y: number, w: number, h: number } | null } | null}
 */
export function capturaDe({ dirCta, destino, pagina }) {
  if (!destino.sitio) return null
  const rutaSitio = dentro(dirCta, destino.sitio)
  /** @type {Sitio} */
  const sitio = JSON.parse(readFileSync(rutaSitio, 'utf8'))
  const dirSitio = dirname(rutaSitio)
  const jpg = (/** @type {string} */ c) => join(dirSitio, `${c}.jpg`)
  const portada = destino.portada ?? 'inicio'
  const elegida = pagina && sitio.capturas[pagina] && existsSync(jpg(pagina)) ? pagina : portada
  if (!existsSync(jpg(elegida))) return null
  return {
    portada: existsSync(jpg(portada)) ? jpg(portada) : jpg(elegida),
    resultado: jpg(elegida),
    ancho: 780,
    marco: sitio.capturas[elegida]?.resultado ?? null,
  }
}

const DURACION_BASE = 4.9
/** 4,9 s como los de calcular y APEX; una frase más larga estira el cierre para que no se corte. @param {{ palabras: { fin_s: number }[] } | null} voz */
export const duracionCierre = (voz) => Math.max(DURACION_BASE, Math.ceil(((voz?.palabras.at(-1)?.fin_s ?? 0) + 0.15 + 0.6) * 10) / 10)

/**
 * Renderiza un cierre (sin música) y lo deja en `salida` con voz y sfx a −16 LUFS, como los cuerpos.
 * @param {{ dirCuenta: string, cuenta: any, paleta: string, motivo?: string, estilo: string, destino: Destino, pagina?: string | null,
 *   salida: string, env: Record<string, string>, log?: (m: string) => void, raiz?: string, renderizar?: typeof renderizarProyecto, topeBytes?: number }} p
 * @returns {Promise<{ archivo: string, duracion_s: number }>}
 */
export async function renderizarCierre({ dirCuenta, cuenta, paleta, motivo, estilo, destino, pagina = null, salida, env, log = () => {}, raiz = resolve(dirCuenta, '..', '..'), renderizar = renderizarProyecto, topeBytes = 0 }) {
  const dirCta = join(dirCuenta, 'cta')
  const { temaDe } = await import(pathToFileURL(join(raiz, 'formatos', '_comun', 'tema.mjs')).href)
  const { armarCierre } = await import(pathToFileURL(join(raiz, 'formatos', '_cierre', 'armar.mjs')).href)
  const tema = temaDe({ cuenta, dirCuenta, paleta, motivo: motivo ?? cuenta.marca.motivos[0] })
  const trabajo = `${salida}.proyecto`
  rmSync(trabajo, { recursive: true, force: true })
  const crudo = `${salida}.crudo.mp4`
  try {
    const voz = vozDelCierre(dirCta, destino.voz)
    const { duracion_s } = await armarCierre({ tema, estilo, salida: trabajo, textos: destino.textos, captura: capturaDe({ dirCta, destino, pagina }), voz, duracion: duracionCierre(voz) })
    await renderizar({ proyecto: trabajo, salida: crudo, env, log, estricto: true })
    mkdirSync(dirname(salida), { recursive: true })
    await nivelarCierre({ crudo, salida, duracion_s, env, topeBytes })
    return { archivo: salida, duracion_s }
  } finally {
    rmSync(trabajo, { recursive: true, force: true })
    rmSync(crudo, { force: true })
  }
}

/**
 * Ganancia fija medida con ebur128 más limitador: loudnorm sobre 4,9 s se pasaba 0,7-1,3 LU del objetivo.
 * `topeBytes`: los clips commiteados van en ≤ 2 MB; el cierre propio de un reel, sin tope.
 * @param {{ crudo: string, salida: string, duracion_s: number, env: Record<string, string>, borde?: boolean, topeBytes?: number }} p
 */
export async function nivelarCierre({ crudo, salida, duracion_s, env, borde = process.platform === 'win32', topeBytes = 0 }) {
  const s = await sondear(crudo, env)
  /** @type {string[]} */
  let audio = ['-an']
  if (s.audio) {
    const { lufs } = await medirAudio(crudo, env)
    if (!Number.isFinite(lufs) || lufs < -60) audio = ['-af', 'aresample=48000', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2']
    else audio = ['-af', `aresample=48000,volume=${(LUFS_CIERRE - lufs).toFixed(2)}dB,alimiter=limit=${(10 ** (PICO_CIERRE / 20)).toFixed(3)}:level=false`, '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2']
  }
  for (const crf of topeBytes ? [20, 23, 26, 29, 32] : [20]) {
    await ffmpeg([
      '-i', crudo,
      '-vf', `fps=30,scale=1080:1920,setsar=1${borde ? ',fillborders=right=8:mode=smear' : ''},format=yuv420p`,
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', String(crf), '-g', '60',
      ...audio, '-t', duracion_s.toFixed(3), '-movflags', '+faststart', salida,
    ], env)
    if (!topeBytes || statSync(salida).size <= topeBytes) break
  }
}

/**
 * El cierre que va en este reel: uno propio con la página del tema si la cuenta lo pide y el tema
 * tiene captura; si no (o si falla), el clip genérico de `cta/clips.json`.
 * @param {{ clip: Clip, destino: 'reel' | 'historia', firma: import('../estado.mjs').Firma, cuerpo: string, dir: string,
 *   env: Record<string, string>, guion?: any, log?: (m: string) => void, renderizar?: typeof renderizarProyecto }} p
 * @returns {Promise<{ archivo: string, propio: boolean, pagina: string | null }>}
 */
export async function cierreDelReel({ clip, destino, firma, cuerpo, dir, env, guion, log = () => {}, renderizar }) {
  const generico = { archivo: clip.archivo, propio: false, pagina: null }
  const dirCuenta = cuentaDeArchivo(clip.archivo)
  if (!dirCuenta) return generico
  const dirCta = join(dirCuenta, 'cta')
  /** @type {ConfigCierre | null} */
  let config
  try {
    config = leerConfigCierre(dirCta)
  } catch (e) {
    log(`cierre.json ilegible, va el clip ${clip.id}: ${String(/** @type {Error} */ (e).message).split('\n')[0]}`)
    return generico
  }
  const d = config?.[destino]
  if (!d?.por_reel || !d.sitio) return generico
  try {
    const g = guion ?? null
    const sitio = JSON.parse(readFileSync(dentro(dirCta, d.sitio), 'utf8'))
    const dirSitio = dirname(dentro(dirCta, d.sitio))
    const portada = d.portada ?? 'inicio'
    const pagina = paginaDe({ guion: g, sitio, ideas: leerIdeas(dirCuenta), hay: (c) => existsSync(join(dirSitio, `${c}.jpg`)), portada })
    if (pagina === portada) return generico
    const cuenta = JSON.parse(readFileSync(join(dirCuenta, 'cuenta.json'), 'utf8'))
    const salida = join(dir, `cierre-${destino}-${firma.paleta}-${clip.estilo}-${pagina}.mp4`)
    if (!existsSync(salida)) await renderizarCierre({ dirCuenta, cuenta, paleta: firma.paleta, motivo: firma.motivo, estilo: clip.estilo, destino: d, pagina, salida, env, log, renderizar })
    return { archivo: salida, propio: true, pagina }
  } catch (e) {
    log(`el cierre propio del reel falló, va el clip ${clip.id}: ${String(/** @type {Error} */ (e).message).split('\n')[0]}`)
    return generico
  }
}

