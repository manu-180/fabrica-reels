// @ts-check
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LUFS, PICO, TOPE_MB, correr, ffmpeg, medirAudio, revisarAudio, revisarSalida, sondear } from './medios.mjs'

/*
  El video final de una variante, sólo con ffmpeg: el cuerpo (con zoom, encuadre y velocidad de la
  firma), el clip del cierre pegado con corte limpio, color y textura sobre las dos partes, música por
  debajo de todo (con ducking bajo la voz) y −14 LUFS. Primero el audio (dos pasadas de loudnorm sobre
  un WAV) y después una sola codificación de video. Cada salida se revisa contra lo que exige Meta.
*/

const VOZ_LUFS = -16
// Con voz, la música va 11 dB debajo; en chat no hay voz y la música es la que sostiene.
const MUSICA_LUFS = { voz: -27, chat: -20 }
// El AAC sube el pico verdadero al codificar (medido: hasta +0,8 dB sobre lo que deja loudnorm): se
// apunta más abajo del tope y, si el AAC de prueba igual se pasa, se baja otro dB.
const PICOS_MEZCLA = [PICO - 1, PICO - 2, PICO - 3]
const AAC = ['-c:a', 'aac', '-b:a', '120k', '-ar', '48000', '-ac', '2']
// veryfast: en 2 núcleos ~25 % menos que medium (medido 2026-11-08) y Meta recodifica igual.
const PRESET = 'veryfast'
const MAX_VELOCIDAD = 0.04
const FORMATO_AUDIO = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'

/** @param {number} x */
const r3 = (x) => Math.round(x * 1000) / 1000

/**
 * @typedef {import('../estado.mjs').Firma} Firma
 * @typedef {{ zoom: number, encuadre: string, velocidad: number, color: string, textura: string }} Ejes
 * @typedef {{ archivo: string, duracion_s: number, conAudio: boolean, lufs: number }} Medio
 */

/** Los ejes de ffmpeg de una firma (los que no trae, neutros). @param {Firma} f @returns {Ejes} */
export const ejesDe = (f) => ({ zoom: f.ffmpeg?.zoom ?? 1, encuadre: f.ffmpeg?.encuadre ?? 'centro', velocidad: f.ffmpeg?.velocidad ?? 1, color: f.color ?? 'neutro', textura: f.textura ?? 'nada' })

/** @param {number} v */
function revisarVelocidad(v) {
  if (!(Math.abs(v - 1) <= MAX_VELOCIDAD + 1e-9)) throw new Error(`velocidad ${v}: nunca más de ${MAX_VELOCIDAD * 100} %`)
}

/** @param {{ cuerpo_s: number, cierre_s: number, velocidad: number }} p */
export const duracionVariante = ({ cuerpo_s, cierre_s, velocidad }) => r3(r3(cuerpo_s / velocidad) + cierre_s)

/** dB para llevar `medido` LUFS a `objetivo`, acotado; lo mudo no se toca. @param {number} objetivo @param {number} medido */
export function ganancia(objetivo, medido) {
  if (!Number.isFinite(medido) || medido < -60) return 0
  return Math.max(-20, Math.min(20, r3(objetivo - medido)))
}

/** Tope de bitrate para que el mp4 entre en TOPE_MB con aire, nunca más de 8 Mbps. @param {number} duracion */
export const maxrateDe = (duracion) => Math.round(Math.max(800_000, Math.min(8_000_000, (TOPE_MB * 1048576 * 0.92 * 8) / duracion - 128_000)))

/**
 * El tamaño al que se escala el cuerpo y dónde se recorta. El recorte vertical queda siempre adentro de
 * la zona segura de Reels (220 px arriba, 420 abajo): con 1,12 se pierden 230 px en total y el encuadre
 * nunca los saca de un solo lado.
 * @param {number} zoom @param {string} encuadre
 */
export function ventanaZoom(zoom, encuadre) {
  const ancho = Math.round((1080 * zoom) / 2) * 2
  const alto = Math.round((1920 * zoom) / 2) * 2
  const f = encuadre === 'arriba' ? 0.2 : encuadre === 'abajo' ? 0.8 : 0.5
  return { ancho, alto, x: Math.floor((ancho - 1080) / 4) * 2, y: Math.floor(((alto - 1920) * f) / 2) * 2 }
}

/** Sutiles: que se note como otra toma, no como un filtro. @param {string} color */
function filtroColor(color) {
  switch (color) {
    case 'calido':
      return 'colorbalance=rs=0.03:gs=0.005:bs=-0.035:rm=0.025:bm=-0.025:rh=0.015:bh=-0.02'
    case 'frio':
      return 'colorbalance=rs=-0.03:bs=0.035:rm=-0.02:bm=0.025:rh=-0.01:bh=0.02'
    case 'contraste':
      return 'eq=contrast=1.07:saturation=1.06'
    case 'mate':
      return "curves=all='0/0.045 0.5/0.5 1/0.96',eq=saturation=0.92"
    default:
      return null
  }
}

/** @param {string} textura */
function filtroTextura(textura) {
  if (textura === 'grano') return 'noise=c0s=6:c0f=t'
  if (textura === 'vineta') return 'vignette=angle=0.36'
  return null
}

/**
 * Entradas: 0 = cuerpo, 1 = clip del cierre. El cuerpo termina quieto 0,3 s (contrato del formato):
 * ahí entra el cierre con un corte limpio.
 * `borde`: HyperFrames en Windows captura las últimas 8 columnas en negro (en Linux salen bien); se
 * rellenan con el borde. Sólo importa en las corridas locales.
 * @param {{ ejes: Ejes, cuerpo_s: number, cierre_s: number, borde?: boolean }} p
 */
export function grafoVideo({ ejes: c, cuerpo_s, cierre_s, borde = false }) {
  revisarVelocidad(c.velocidad)
  const v = ventanaZoom(c.zoom, c.encuadre)
  const d1 = r3(cuerpo_s / c.velocidad)
  const cuerpo = [
    c.velocidad !== 1 ? `setpts=PTS/${c.velocidad}` : null,
    'fps=30',
    borde ? 'scale=1080:1920:flags=lanczos,fillborders=right=8:mode=smear' : null,
    c.zoom > 1 ? `scale=${v.ancho}:${v.alto}:flags=lanczos,crop=1080:1920:${v.x}:${v.y}` : borde ? null : 'scale=1080:1920:flags=lanczos',
    'setsar=1,format=yuv420p',
    `trim=duration=${d1}`,
    'setpts=PTS-STARTPTS',
  ].filter(Boolean)
  // colorbalance deja el cuadro en RGB planar: ahí el c0 de noise es el verde y pintaba una franja
  // roja en las últimas 8 columnas (2026-11-08). La textura va siempre sobre 4:2:0.
  const t = filtroTextura(c.textura)
  const despues = [filtroColor(c.color), t ? `format=yuv420p,${t}` : null, 'format=yuv420p'].filter(Boolean)
  return [
    `[0:v]${cuerpo.join(',')}[vb]`,
    `[1:v]fps=30,scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p,trim=duration=${r3(cierre_s)},setpts=PTS-STARTPTS[vc]`,
    `[vb][vc]concat=n=2:v=1:a=0,${despues.join(',')}[v]`,
  ].join(';')
}

/**
 * Entradas: 0 = cuerpo (voz + sfx), 1 = música (en loop), 2 = clip del cierre.
 * La música sigue por debajo del cierre y se agacha bajo la voz (sidechain); en chat la llave es sólo
 * el cierre, para que los sfx no la hagan bombear.
 * @param {{ ejes: Ejes, cuerpo_s: number, cierre_s: number, conVoz: boolean, cuerpoConAudio: boolean, cierreConAudio?: boolean, g: { cuerpo: number, cierre: number, musica: number } }} p
 */
export function grafoAudio({ ejes: c, cuerpo_s, cierre_s, conVoz, cuerpoConAudio, cierreConAudio = true, g }) {
  revisarVelocidad(c.velocidad)
  const d1 = r3(cuerpo_s / c.velocidad)
  const d2 = r3(cierre_s)
  const total = r3(d1 + d2)
  const db = (/** @type {number} */ x) => `volume=${x.toFixed(2)}dB`
  const mudo = (/** @type {number} */ d, /** @type {string} */ nombre) => `anullsrc=r=48000:cl=stereo,atrim=0:${d},aformat=sample_fmts=fltp:channel_layouts=stereo[${nombre}]`
  const partes = [
    cuerpoConAudio ? `[0:a]${c.velocidad !== 1 ? `atempo=${c.velocidad},` : ''}${FORMATO_AUDIO},${db(g.cuerpo)},apad,atrim=0:${d1},asetpts=N/SR/TB[cu]` : mudo(d1, 'cu'),
    cierreConAudio ? `[2:a]${FORMATO_AUDIO},${db(g.cierre)},apad,atrim=0:${d2},asetpts=N/SR/TB[ci]` : mudo(d2, 'ci'),
  ]
  if (conVoz) partes.push('[cu][ci]concat=n=2:v=0:a=1,asplit=2[voz][llave]')
  else partes.push('[ci]asplit=2[ci1][ci2]', '[cu][ci1]concat=n=2:v=0:a=1[voz]', mudo(d1, 'sil'), '[sil][ci2]concat=n=2:v=0:a=1[llave]')
  partes.push(
    `[1:a]${FORMATO_AUDIO},atrim=0:${total},asetpts=N/SR/TB,${db(g.musica)},afade=t=in:d=0.4,afade=t=out:st=${r3(Math.max(0, total - 0.8))}:d=0.8[mus]`,
    '[mus][llave]sidechaincompress=threshold=0.035:ratio=4:attack=60:release=700:knee=3[musd]',
    `[voz][musd]amix=inputs=2:normalize=0:duration=first,atrim=0:${total}[mix]`,
  )
  return partes.join(';')
}

/** Mide lo que la mezcla necesita de un medio. @param {string} archivo @param {Record<string, string>} env @returns {Promise<Medio>} */
export async function medio(archivo, env) {
  const s = await sondear(archivo, env)
  const conAudio = Boolean(s.audio)
  return { archivo, duracion_s: r3(s.video?.duracion || s.duracion), conAudio, lufs: conAudio ? (await medirAudio(archivo, env)).lufs : -Infinity }
}

/**
 * Mezcla, normaliza a −14 LUFS en dos pasadas y deja un WAV 48 kHz.
 * @param {{ cuerpo: string, musica: string, cierre: string, grafo: string, salida: string, dir: string, env: Record<string, string> }} p
 */
async function armarAudio({ cuerpo, musica, cierre, grafo, salida, dir, env }) {
  const crudo = join(dir, `mezcla-${process.pid}-${Date.now()}.wav`)
  const prueba = join(dir, `mezcla-${process.pid}-${Date.now()}.m4a`)
  try {
    await ffmpeg(['-i', cuerpo, '-stream_loop', '-1', '-i', musica, '-i', cierre, '-filter_complex', grafo, '-map', '[mix]', '-c:a', 'pcm_s24le', '-ar', '48000', crudo], env)
    for (const tp of PICOS_MEZCLA) {
      const ln = `loudnorm=I=${LUFS}:TP=${tp}:LRA=11`
      const { stderr } = await correr(env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-nostdin', '-i', crudo, '-af', `${ln}:print_format=json`, '-f', 'null', '-'], { env })
      const m = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1))
      await ffmpeg([
        '-i', crudo,
        '-af', `${ln}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
        '-c:a', 'pcm_s24le', '-ar', '48000', salida,
      ], env)
      await ffmpeg(['-i', salida, ...AAC, prueba], env)
      if ((await medirAudio(prueba, env)).pico <= PICO - 0.2) break
    }
  } finally {
    rmSync(crudo, { force: true })
    rmSync(prueba, { force: true })
  }
}

/**
 * @param {{ ejes: Ejes, id: string, cuerpo: Medio, cierre: Medio, musica: Medio, conVoz: boolean, dir: string, env: Record<string, string>, borde?: boolean }} p
 * @returns {Promise<{ archivo: string, duracion_s: number, bytes: number, lufs: number, pico: number, segundos: number }>}
 */
export async function hacerVariante({ ejes: c, id, cuerpo, cierre, musica, conVoz, dir, env, borde = process.platform === 'win32' }) {
  const t0 = Date.now()
  mkdirSync(dir, { recursive: true })
  const duracion = duracionVariante({ cuerpo_s: cuerpo.duracion_s, cierre_s: cierre.duracion_s, velocidad: c.velocidad })
  const g = {
    cuerpo: conVoz ? ganancia(VOZ_LUFS, cuerpo.lufs) : 0,
    cierre: ganancia(VOZ_LUFS, cierre.lufs),
    musica: ganancia(conVoz ? MUSICA_LUFS.voz : MUSICA_LUFS.chat, musica.lufs),
  }
  const audio = join(dir, `${id}.wav`)
  const salida = join(dir, `${id}.mp4`)
  try {
    const grafo = grafoAudio({ ejes: c, cuerpo_s: cuerpo.duracion_s, cierre_s: cierre.duracion_s, conVoz, cuerpoConAudio: cuerpo.conAudio, cierreConAudio: cierre.conAudio, g })
    await armarAudio({ cuerpo: cuerpo.archivo, musica: musica.archivo, cierre: cierre.archivo, grafo, salida: audio, dir, env })
    const video = grafoVideo({ ejes: c, cuerpo_s: cuerpo.duracion_s, cierre_s: cierre.duracion_s, borde })
    let maxrate = maxrateDe(duracion)
    let crf = 21
    for (let vuelta = 0; ; vuelta++) {
      await ffmpeg([
        '-i', cuerpo.archivo, '-i', cierre.archivo, '-i', audio,
        '-filter_complex', video, '-map', '[v]', '-map', '2:a:0',
        '-c:v', 'libx264', '-preset', PRESET, '-profile:v', 'high', '-level:v', '4.1', '-crf', String(crf),
        '-maxrate', String(maxrate), '-bufsize', String(maxrate * 2), '-g', '60', '-keyint_min', '30', '-sc_threshold', '0', '-flags', '+cgop',
        '-pix_fmt', 'yuv420p', '-r', '30',
        // 120k y no 128k: el AAC nativo de ffmpeg se pasa hasta un 4 % en los tramos fuertes y revisarSalida corta en 132 (2026-11-10).
        ...AAC,
        '-t', String(duracion), '-movflags', '+faststart', salida,
      ], env)
      if (statSync(salida).size <= TOPE_MB * 1048576 || vuelta >= 2) break
      crf += 3
      maxrate = Math.round(maxrate * 0.8)
    }
    const s = await sondear(salida, env)
    const a = await medirAudio(salida, env)
    const problemas = [...revisarSalida(s, { duracion_s: duracion }), ...revisarAudio(a)]
    if (problemas.length) throw new Error(`${id}: ${problemas.join('; ')}`)
    return { archivo: salida, duracion_s: r3(s.duracion), bytes: s.bytes, lufs: a.lufs, pico: a.pico, segundos: Math.round((Date.now() - t0) / 100) / 10 }
  } finally {
    rmSync(audio, { force: true })
  }
}
