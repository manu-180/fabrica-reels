// @ts-check
import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync, statSync } from 'node:fs'

/*
  ffmpeg y ffprobe para el render: correr con tope y entorno propio, sondear un mp4, medir loudness y
  revisar que la salida cumpla lo que pide Meta. Todo proceso de terceros se lanza con el `env` que
  recibe (entornoSinSecretos de nucleo/entorno.mjs): nunca con process.env.
*/

export const TOPE_MB = 15
export const LUFS = -14
export const TOLERANCIA_LUFS = 1
export const PICO = -1.5

/**
 * @typedef {Record<string, string>} Entorno
 * @typedef {{ duracion: number, bytes: number, atomos: string[],
 *   video: { codec: string, perfil: string | null, nivel: number | null, ancho: number, alto: number, fps: number, pix_fmt: string, bitrate: number | null, duracion: number } | null,
 *   audio: { codec: string, frecuencia: number, canales: number, bitrate: number | null } | null }} Sondeo
 */

/** @param {Entorno} env @param {'ffmpeg' | 'ffprobe'} nombre */
const bin = (env, nombre) => (nombre === 'ffmpeg' ? env.FFMPEG_PATH || 'ffmpeg' : env.FFPROBE_PATH || 'ffprobe')

/**
 * @param {string} cmd @param {string[]} args
 * @param {{ env: Entorno, shell?: boolean, tope?: number, registro?: string, cwd?: string }} op
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export function correr(cmd, args, { env, shell = false, tope = 0, registro, cwd }) {
  if (!env) throw new Error(`correr ${cmd}: falta el entorno (entornoSinSecretos)`)
  return new Promise((ok, mal) => {
    const hijo = spawn(cmd, args, { cwd, shell, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    const anotar = (/** @type {Buffer} */ b) => {
      if (registro) appendFileSync(registro, b)
    }
    hijo.stdout.on('data', (d) => {
      stdout += d
      anotar(d)
    })
    hijo.stderr.on('data', (d) => {
      stderr += d
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000)
      anotar(d)
    })
    const reloj = tope
      ? setTimeout(() => {
          hijo.kill('SIGKILL')
          mal(new Error(`${cmd} no terminó en ${Math.round(tope / 60_000)} min`))
        }, tope)
      : null
    hijo.on('error', (e) => {
      if (reloj) clearTimeout(reloj)
      mal(new Error(`no se pudo correr ${cmd}: ${e.message}`))
    })
    hijo.on('close', (codigo) => {
      if (reloj) clearTimeout(reloj)
      if (codigo === 0) ok({ stdout, stderr })
      else mal(new Error(`${cmd} ${args.slice(0, 3).join(' ')} salió con ${codigo}: ${(stderr || stdout).trim().split('\n').slice(-6).join(' | ')}`))
    })
  })
}

/** @param {string[]} args @param {Entorno} env */
export const ffmpeg = (args, env) => correr(bin(env, 'ffmpeg'), ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], { env })

/** Los átomos de primer nivel de un mp4, en orden. @param {Buffer} b @returns {string[]} */
export function ordenAtomos(b) {
  /** @type {string[]} */
  const tipos = []
  let off = 0
  while (off + 8 <= b.length) {
    let largo = b.readUInt32BE(off)
    tipos.push(b.toString('latin1', off + 4, off + 8))
    if (largo === 1 && off + 16 <= b.length) largo = Number(b.readBigUInt64BE(off + 8))
    if (largo < 8) break
    off += largo
  }
  return tipos
}

/** @param {string} archivo @param {Entorno} env @returns {Promise<Sondeo>} */
export async function sondear(archivo, env) {
  const { stdout } = await correr(bin(env, 'ffprobe'), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', archivo], { env })
  const j = JSON.parse(stdout)
  /** @type {any[]} */
  const streams = j.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video')
  const a = streams.find((s) => s.codec_type === 'audio')
  const [n, d] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number)
  const total = Number(j.format?.duration) || 0
  return {
    duracion: total,
    bytes: statSync(archivo).size,
    atomos: ordenAtomos(readFileSync(archivo)),
    video: v
      ? { codec: v.codec_name, perfil: v.profile ?? null, nivel: Number.isFinite(Number(v.level)) ? Number(v.level) : null, ancho: v.width, alto: v.height, fps: d ? (n ?? 0) / d : 0, pix_fmt: v.pix_fmt, bitrate: Number(v.bit_rate) || null, duracion: Number(v.duration) || total }
      : null,
    audio: a ? { codec: a.codec_name, frecuencia: Number(a.sample_rate) || 0, canales: a.channels, bitrate: Number(a.bit_rate) || null } : null,
  }
}

/**
 * Loudness integrado y pico verdadero de la primera pista de audio (−Infinity si es muda).
 * @param {string} archivo @param {Entorno} env @returns {Promise<{ lufs: number, pico: number }>}
 */
export async function medirAudio(archivo, env) {
  const { stderr } = await correr(bin(env, 'ffmpeg'), ['-hide_banner', '-nostdin', '-i', archivo, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { env })
  return leerEbur128(stderr)
}

/** @param {string} stderr */
export function leerEbur128(stderr) {
  const resumen = stderr.slice(stderr.lastIndexOf('Summary:'))
  const i = resumen.match(/I:\s+(-?[\d.]+|-inf) LUFS/)
  const p = resumen.match(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/)
  const num = (/** @type {RegExpMatchArray | null} */ m) => (m && m[1] !== '-inf' ? Number(m[1]) : -Infinity)
  return { lufs: num(i), pico: num(p) }
}

/**
 * Lo que exige Meta para un Reel (h264 4:2:0 con faststart, 23-60 fps, aac hasta 48 kHz y ~128 kbps,
 * 3 s a 15 min) más lo propio: High 4.1, 1080x1920, ≤ TOPE_MB y la duración esperada.
 * @param {Sondeo} s @param {{ duracion_s: number }} esperado @returns {string[]}
 */
export function revisarSalida(s, { duracion_s }) {
  /** @type {string[]} */
  const p = []
  if (!s.video) p.push('sin pista de video')
  else {
    if (s.video.codec !== 'h264') p.push(`el video es ${s.video.codec}, no h264`)
    if (s.video.perfil !== null && s.video.perfil !== 'High') p.push(`el h264 es ${s.video.perfil}, no High`)
    if (s.video.nivel !== null && s.video.nivel > 41) p.push(`el h264 es nivel ${s.video.nivel / 10}, más que 4.1`)
    if (s.video.ancho !== 1080 || s.video.alto !== 1920) p.push(`el video es ${s.video.ancho}x${s.video.alto}, no 1080x1920`)
    if (!(s.video.fps >= 23 && s.video.fps <= 60)) p.push(`el video va a ${s.video.fps} fps`)
    if (s.video.pix_fmt !== 'yuv420p') p.push(`el video no es 4:2:0 (${s.video.pix_fmt})`)
    if ((s.video.bitrate ?? 0) > 25e6) p.push('el video pasa los 25 Mbps')
  }
  if (!s.audio) p.push('sin pista de audio')
  else {
    if (s.audio.codec !== 'aac') p.push(`el audio es ${s.audio.codec}, no aac`)
    if (s.audio.frecuencia > 48000) p.push(`el audio va a ${s.audio.frecuencia} Hz`)
    if ((s.audio.bitrate ?? 0) > 132_000) p.push(`el audio va a ${Math.round((s.audio.bitrate ?? 0) / 1000)} kbps`)
  }
  if (Math.abs(s.duracion - duracion_s) > 0.35) p.push(`dura ${s.duracion.toFixed(2)} s y tenía que durar ${duracion_s.toFixed(2)} s`)
  if (s.duracion < 3 || s.duracion > 900) p.push(`dura ${s.duracion.toFixed(1)} s (Meta pide de 3 s a 15 min)`)
  if (s.bytes > TOPE_MB * 1024 * 1024) p.push(`pesa ${(s.bytes / 1048576).toFixed(1)} MB (tope ${TOPE_MB} MB)`)
  const moov = s.atomos.indexOf('moov')
  const mdat = s.atomos.indexOf('mdat')
  if (moov < 0 || (mdat >= 0 && moov > mdat)) p.push('sin faststart: moov va después de mdat')
  return p
}

/** @param {{ lufs: number, pico: number }} m @returns {string[]} */
export function revisarAudio({ lufs, pico }) {
  /** @type {string[]} */
  const p = []
  if (!(Math.abs(lufs - LUFS) <= TOLERANCIA_LUFS)) p.push(`quedó en ${lufs} LUFS (objetivo ${LUFS} ± ${TOLERANCIA_LUFS})`)
  if (!(pico <= PICO)) p.push(`pico verdadero de ${pico} dBTP (tope ${PICO})`)
  return p
}
