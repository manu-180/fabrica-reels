// @ts-check
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { EJES } from '../diseno.mjs'
import { entornoSinSecretos } from '../entorno.mjs'
import { cierreDelReel, cuentaDeArchivo, duracionCierre, paginaDe } from './cierre.mjs'
import { fusionarClips, idClip } from './cierres.mjs'
import { CAPTURAS, HYPERFRAMES, argumentosRender, renderizarProyecto } from './hyperframes.mjs'
import { armarFinal } from './index.mjs'
import { leerEbur128, ordenAtomos, revisarAudio, revisarSalida } from './medios.mjs'
import { duracionVariante, ejesDe, ganancia, grafoAudio, grafoVideo, maxrateDe } from './variar.mjs'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HAY_FFMPEG = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0
const sinFfmpeg = { skip: HAY_FFMPEG ? false : 'sin ffmpeg en esta máquina' }

/** @param {Record<string, unknown>} [extra] */
const ejes = (extra = {}) => ({ zoom: 1, encuadre: 'centro', velocidad: 1, color: 'neutro', textura: 'nada', ...extra })
/** @param {Record<string, unknown>} [extra] @returns {any} */
const firma = (extra = {}) => ({ formato: 'mito', layout: 'base', motivo: 'cuaderno', paleta: 'papel', hook: 0, musica: 'acustica-1', cierre: 'papel-buscador', color: 'neutro', textura: 'nada', ffmpeg: { zoom: 1, encuadre: 'centro', velocidad: 1 }, ...extra })

test('ejesDe: los ejes de ffmpeg salen de la firma, neutros si faltan', () => {
  assert.deepEqual(ejesDe(firma({ color: 'frio', textura: 'grano', ffmpeg: { zoom: 1.06, encuadre: 'arriba', velocidad: 1.02 } })), { zoom: 1.06, encuadre: 'arriba', velocidad: 1.02, color: 'frio', textura: 'grano' })
  assert.deepEqual(ejesDe(/** @type {any} */ ({ color: 'mate' })), { zoom: 1, encuadre: 'centro', velocidad: 1, color: 'mate', textura: 'nada' })
})

test('duracionVariante: el cuerpo cambia con la velocidad y el cierre no', () => {
  assert.equal(duracionVariante({ cuerpo_s: 20.4, cierre_s: 4.2, velocidad: 1.02 }), 24.2)
  assert.equal(duracionVariante({ cuerpo_s: 20, cierre_s: 4, velocidad: 1 }), 24)
})

test('grafoVideo: zoom con su encuadre, velocidad sólo en el cuerpo, color y textura sobre todo', () => {
  const g = grafoVideo({ ejes: ejes({ zoom: 1.06, encuadre: 'arriba', velocidad: 1.02, color: 'calido', textura: 'grano' }), cuerpo_s: 20.4, cierre_s: 4.2 })
  assert.match(g, /\[0:v\]setpts=PTS\/1\.02,fps=30,scale=1144:2036:flags=lanczos,crop=1080:1920:32:22/)
  assert.match(g, /\[1:v\]fps=30,scale=1080:1920/)
  assert.match(g, /concat=n=2:v=1:a=0,colorbalance=/)
  const neutro = grafoVideo({ ejes: ejes(), cuerpo_s: 20, cierre_s: 4 })
  assert.doesNotMatch(neutro, /colorbalance|eq=|curves|noise|vignette|setpts=PTS\/|fillborders/)
  assert.match(grafoVideo({ ejes: ejes({ textura: 'vineta', color: 'mate' }), cuerpo_s: 20, cierre_s: 4 }), /curves=.*vignette=/)
})

test('grafoVideo con borde: rellena las 8 columnas que HyperFrames deja negras en Windows, sólo en el cuerpo', () => {
  const g = grafoVideo({ ejes: ejes(), cuerpo_s: 20, cierre_s: 4, borde: true })
  assert.match(g, /\[0:v\]fps=30,scale=1080:1920:flags=lanczos,fillborders=right=8:mode=smear,setsar=1/)
  assert.doesNotMatch(g.split(';')[1] ?? '', /fillborders/)
})

test('grafoVideo vuelve a 4:2:0 antes de la textura: el grano va en la luma', () => {
  for (const color of ['calido', 'frio', 'contraste', 'mate']) {
    for (const textura of ['grano', 'vineta']) {
      assert.match(grafoVideo({ ejes: ejes({ color, textura }), cuerpo_s: 20, cierre_s: 4 }), /format=yuv420p,(noise|vignette)=/, `${color} + ${textura}`)
    }
  }
})

test('ninguna combinación de color, textura y zoom ensucia los bordes (ffmpeg de verdad)', sinFfmpeg, () => {
  const dir = mkdtempSync(join(tmpdir(), 'render-bordes-'))
  const fondo = (/** @type {string} */ nombre, /** @type {number} */ d) =>
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x15171c:s=1080x1920:r=30:d=${d}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(dir, nombre)])
  fondo('cuerpo.mp4', 0.6)
  fondo('cierre.mp4', 0.3)
  for (const color of EJES.color) {
    for (const textura of EJES.textura) {
      for (const zoom of [1, 1.12]) {
        const g = grafoVideo({ ejes: ejes({ color, textura, zoom }), cuerpo_s: 0.6, cierre_s: 0.3 })
        const crudo = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(dir, 'cuerpo.mp4'), '-i', join(dir, 'cierre.mp4'), '-filter_complex', `${g};[v]trim=start=0.3,crop=1080:8:0:960,format=rgb24[o]`, '-map', '[o]', '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1e7 })
        const tinte = (/** @type {number} */ x) => {
          const i = x * 3
          return Math.max(Math.abs((crudo[i] ?? 0) - (crudo[i + 2] ?? 0)), Math.abs((crudo[i + 1] ?? 0) - (crudo[i + 2] ?? 0)))
        }
        const centro = tinte(540)
        for (const x of [0, 4, 1075, 1079]) assert.ok(Math.abs(tinte(x) - centro) <= 24, `${color} + ${textura} + zoom ${zoom}: el borde x=${x} se tiñe`)
      }
    }
  }
})

test('nunca acelera más de 4 %', () => {
  assert.throws(() => grafoVideo({ ejes: ejes({ velocidad: 1.06 }), cuerpo_s: 20, cierre_s: 4 }))
  assert.throws(() => grafoAudio({ ejes: ejes({ velocidad: 0.94 }), cuerpo_s: 20, cierre_s: 4, conVoz: true, cuerpoConAudio: true, g: { cuerpo: 0, cierre: 0, musica: 0 } }))
})

test('grafoAudio: atempo en la voz, ducking por sidechain y música que sigue bajo el cierre', () => {
  const g = grafoAudio({ ejes: ejes({ velocidad: 0.98 }), cuerpo_s: 20, cierre_s: 4, conVoz: true, cuerpoConAudio: true, g: { cuerpo: 1.5, cierre: -2, musica: -11 } })
  assert.match(g, /\[0:a\]atempo=0\.98,/)
  assert.match(g, /volume=1\.50dB/)
  assert.match(g, /sidechaincompress=/)
  assert.match(g, /\[1:a\].*atrim=0:24\.408/)
  assert.match(g, /amix=inputs=2:normalize=0:duration=first/)
})

test('grafoAudio en chat y con un cierre mudo: lo que no tiene audio se rellena con silencio', () => {
  const g = grafoAudio({ ejes: ejes(), cuerpo_s: 20, cierre_s: 4, conVoz: false, cuerpoConAudio: false, g: { cuerpo: 0, cierre: -2, musica: -4 } })
  assert.match(g, /anullsrc=r=48000:cl=stereo.*\[cu\]/)
  assert.match(g, /\[sil\]\[ci2\]concat=n=2:v=0:a=1\[llave\]/)
  const mudo = grafoAudio({ ejes: ejes(), cuerpo_s: 20, cierre_s: 4, conVoz: true, cuerpoConAudio: true, cierreConAudio: false, g: { cuerpo: 0, cierre: 0, musica: -4 } })
  assert.doesNotMatch(mudo, /\[2:a\]/)
  assert.match(mudo, /atrim=0:4,aformat=sample_fmts=fltp:channel_layouts=stereo\[ci\]/)
})

test('ganancia hacia el objetivo, acotada y sin tocar lo mudo', () => {
  assert.equal(ganancia(-16, -20), 4)
  assert.equal(ganancia(-27, -16), -11)
  assert.equal(ganancia(-16, -Infinity), 0)
  assert.equal(ganancia(-16, -70), 0)
  assert.equal(ganancia(-16, -50), 20)
})

test('maxrateDe: entra en 15 MB con aire y nunca pasa 8 Mbps', () => {
  for (const d of [10, 20, 30, 45]) {
    const m = maxrateDe(d)
    assert.ok(m <= 8_000_000)
    assert.ok(((m + 128_000) * d) / 8 <= 15 * 1048576 * 0.96, `${d} s: ${m}`)
  }
})

/** @param {any} [extra] @returns {any} */
const sondeo = (extra = {}) => ({
  duracion: 25, bytes: 9 * 1048576, atomos: ['ftyp', 'moov', 'mdat'],
  video: { codec: 'h264', perfil: 'High', nivel: 41, ancho: 1080, alto: 1920, fps: 30, pix_fmt: 'yuv420p', bitrate: 3e6, duracion: 25 },
  audio: { codec: 'aac', frecuencia: 48000, canales: 2, bitrate: 120_000 },
  ...extra,
})

test('revisarSalida: lo que pide Meta más High 4.1, 1080x1920 y 15 MB', () => {
  assert.deepEqual(revisarSalida(sondeo(), { duracion_s: 25 }), [])
  assert.match(revisarSalida(sondeo({ atomos: ['ftyp', 'mdat', 'moov'] }), { duracion_s: 25 }).join(), /faststart/)
  assert.match(revisarSalida(sondeo({ bytes: 16 * 1048576 }), { duracion_s: 25 }).join(), /15 MB/)
  assert.match(revisarSalida(sondeo({ video: { ...sondeo().video, perfil: 'Main' } }), { duracion_s: 25 }).join(), /no High/)
  assert.match(revisarSalida(sondeo({ video: { ...sondeo().video, nivel: 42 } }), { duracion_s: 25 }).join(), /4\.1/)
  assert.match(revisarSalida(sondeo({ video: { ...sondeo().video, pix_fmt: 'yuv444p' } }), { duracion_s: 25 }).join(), /4:2:0/)
  assert.match(revisarSalida(sondeo({ audio: { ...sondeo().audio, bitrate: 140_000 } }), { duracion_s: 25 }).join(), /kbps/)
  assert.match(revisarSalida(sondeo(), { duracion_s: 26 }).join(), /tenía que durar/)
  assert.match(revisarSalida(sondeo({ audio: null }), { duracion_s: 25 }).join(), /sin pista de audio/)
})

test('revisarAudio: −14 LUFS ± 1 y pico verdadero ≤ −1,5 dBTP', () => {
  assert.deepEqual(revisarAudio({ lufs: -14.4, pico: -1.9 }), [])
  assert.equal(revisarAudio({ lufs: -15.2, pico: -2 }).length, 1)
  assert.equal(revisarAudio({ lufs: -14, pico: -1.2 }).length, 1)
  assert.equal(revisarAudio({ lufs: -Infinity, pico: -Infinity }).length, 1)
})

test('leerEbur128 y ordenAtomos', () => {
  const log = 'basura\nSummary:\n\n  Integrated loudness:\n    I:         -14.2 LUFS\n    Threshold: -24.3 LUFS\n\n  True peak:\n    Peak:       -1.8 dBFS\n'
  assert.deepEqual(leerEbur128(log), { lufs: -14.2, pico: -1.8 })
  assert.deepEqual(leerEbur128('Summary:\n I:  -inf LUFS\n True peak:\n Peak: -inf dBFS'), { lufs: -Infinity, pico: -Infinity })
  const caja = (/** @type {string} */ t, /** @type {number} */ n) => Buffer.concat([Buffer.from([0, 0, 0, n]), Buffer.from(t, 'latin1'), Buffer.alloc(n - 8)])
  assert.deepEqual(ordenAtomos(Buffer.concat([caja('ftyp', 16), caja('moov', 8), caja('mdat', 12)])), ['ftyp', 'moov', 'mdat'])
})

test('HyperFrames: 0.8.140, las tres capturas en orden y el entorno sin secretos', async () => {
  assert.equal(HYPERFRAMES, 'hyperframes@0.8.140')
  const a = argumentosRender({ proyecto: 'p', salida: 's.mp4', extra: /** @type {string[]} */ (CAPTURAS[0]) })
  assert.deepEqual(a.slice(0, 4), ['--yes', 'hyperframes@0.8.140', 'render', 'p'])
  assert.ok(a.includes('--experimental-fast-capture=false') && a.includes('jpg') && a.includes('--no-low-memory-mode'))
  const env = entornoSinSecretos({ PATH: '/bin', BLOB_READ_WRITE_TOKEN: 'x', ELEVENLABS_API_KEY: 'y', IG_APEX_STACK_TOKEN: 'z' })
  /** @type {{ args: string[], op: any }[]} */
  const llamadas = []
  const dir = mkdtempSync(join(tmpdir(), 'render-hf-'))
  const salida = join(dir, 'cuerpo.mp4')
  const ejecutar = async (/** @type {string} */ _cmd, /** @type {string[]} */ args, /** @type {any} */ op) => {
    llamadas.push({ args, op })
    if (llamadas.length < 3) throw new Error('capture stalled')
    writeFileSync(salida, 'mp4')
  }
  /** @type {string[]} */
  const logs = []
  await renderizarProyecto({ proyecto: dir, salida, env, log: (m) => logs.push(m), ejecutar })
  assert.equal(llamadas.length, 3)
  assert.deepEqual(llamadas.map((l) => l.args.slice(-CAPTURAS[0].length - 1).join(' ').includes('png')), [false, false, true])
  for (const l of llamadas) {
    assert.equal(l.op.tope, 15 * 60_000)
    assert.deepEqual(Object.keys(l.op.env).filter((k) => /TOKEN|KEY/.test(k)), [])
  }
  assert.equal(logs.length, 2)
  await assert.rejects(renderizarProyecto({ proyecto: dir, salida, env: /** @type {any} */ (undefined) }), /sin secretos/)
  await assert.rejects(renderizarProyecto({ proyecto: dir, salida, env, ejecutar: async () => { throw new Error('se colgó') } }), /se colgó/)
})

const sitio = {
  base: 'https://calcular.ar',
  temas: { aguinaldo: 'aguinaldo', despido: 'indemnizacion' },
  capturas: { inicio: { ruta: '/', resultado: null }, aguinaldo: { ruta: '/aguinaldo', resultado: { x: 1, y: 2, w: 3, h: 4 } }, indemnizacion: { ruta: '/indemnizacion', resultado: null }, vacaciones: { ruta: '/vacaciones', resultado: null } },
}

test('paginaDe: la página de la idea, si no la del tema de la clave, si no la portada', () => {
  const hay = () => true
  const ideas = [{ id: 'i1', pagina: 'https://calcular.ar/vacaciones/' }, { id: 'i2', pagina: 'https://calcular.ar/no-hay' }]
  assert.equal(paginaDe({ guion: { clave: '009-aguinaldo-mitos', idea: 'i1' }, sitio, ideas, hay }), 'vacaciones')
  assert.equal(paginaDe({ guion: { clave: '009-aguinaldo-mitos', idea: 'i2' }, sitio, ideas, hay }), 'aguinaldo')
  assert.equal(paginaDe({ guion: { clave: '020-chat-tia', tema: 'despido-sin-causa' }, sitio, ideas, hay }), 'indemnizacion')
  assert.equal(paginaDe({ guion: { clave: '050-monotributo' }, sitio, ideas, hay }), 'inicio')
  assert.equal(paginaDe({ guion: { clave: '009-aguinaldo-mitos' }, sitio, ideas, hay: (c) => c !== 'aguinaldo' }), 'inicio')
  assert.equal(paginaDe({ guion: null, sitio, hay }), 'inicio')
})

test('duracionCierre: 4,9 s salvo que la frase no entre', () => {
  assert.equal(duracionCierre(null), 4.9)
  assert.equal(duracionCierre({ palabras: [{ fin_s: 3.6 }] }), 4.9)
  assert.equal(duracionCierre({ palabras: [{ fin_s: 5.4 }] }), 6.2)
})

/** Una cuenta de mentira con su cta/ en una carpeta temporal. @param {any} cierre */
function cuentaFalsa(cierre) {
  const raiz = mkdtempSync(join(tmpdir(), 'render-cuenta-'))
  const dc = join(raiz, 'cuentas', 'prueba')
  mkdirSync(join(dc, 'cta', 'clips'), { recursive: true })
  mkdirSync(join(dc, 'cta', 'sitio'), { recursive: true })
  mkdirSync(join(dc, 'guiones'), { recursive: true })
  writeFileSync(join(dc, 'cuenta.json'), JSON.stringify({ id: 'prueba', marca: { motivos: ['cuaderno'] } }))
  writeFileSync(join(dc, 'cta', 'clips', 'papel-buscador.mp4'), 'mp4')
  writeFileSync(join(dc, 'cta', 'cierre.json'), JSON.stringify(cierre))
  writeFileSync(join(dc, 'cta', 'sitio', 'sitio.json'), JSON.stringify(sitio))
  for (const c of ['inicio', 'aguinaldo']) writeFileSync(join(dc, 'cta', 'sitio', `${c}.jpg`), 'jpg')
  writeFileSync(join(dc, 'guiones', '009-aguinaldo-mitos.json'), JSON.stringify({ clave: '009-aguinaldo-mitos', tema: 'aguinaldo' }))
  const clip = { id: 'papel-buscador', paleta: 'papel', estilo: 'buscador', destino: /** @type {'reel'} */ ('reel'), archivo: join(dc, 'cta', 'clips', 'papel-buscador.mp4'), duracion_s: 4.9 }
  return { raiz, dc, clip }
}

test('cierreDelReel: el clip genérico salvo que la cuenta pida el propio y el tema tenga página', async () => {
  const destino = { estilos: ['buscador'], textos: { titular: 'T', destacado: 'd' }, voz: null, sitio: 'sitio/sitio.json', por_reel: true }
  const { dc, clip } = cuentaFalsa({ reel: destino })
  assert.equal(cuentaDeArchivo(clip.archivo), dc)
  const cuerpo = join(tmpdir(), 'seco', '2026-11-25-009-aguinaldo-mitos', 'v0', 'cuerpo.mp4')
  const dir = mkdtempSync(join(tmpdir(), 'render-v0-'))
  /** @type {string[]} */
  const logs = []
  const guion = { clave: '009-aguinaldo-mitos', tema: 'aguinaldo' }
  const falla = await cierreDelReel({ clip, destino: 'reel', firma: firma(), cuerpo, dir, env: {}, guion, log: (m) => logs.push(m), renderizar: async () => { throw new Error('hyperframes se cayó') } })
  assert.deepEqual(falla, { archivo: clip.archivo, propio: false, pagina: null })
  assert.match(logs.join(), /va el clip papel-buscador/)
  const portada = await cierreDelReel({ clip, destino: 'reel', firma: firma(), cuerpo, dir, env: {}, guion: { clave: '050-monotributo' } })
  assert.equal(portada.propio, false)
  const historia = await cierreDelReel({ clip, destino: 'historia', firma: firma(), cuerpo, dir, env: {}, guion })
  assert.equal(historia.propio, false)
  const sin = cuentaFalsa({ reel: { ...destino, por_reel: false } })
  assert.equal((await cierreDelReel({ clip: sin.clip, destino: 'reel', firma: firma(), cuerpo, dir, env: {}, guion })).propio, false)
})

test('clips: ids por destino y fusión estable por id', () => {
  assert.equal(idClip('reel', 'noche', 'tipografico'), 'noche-tipografico')
  assert.equal(idClip('historia', 'noche', 'tipografico'), 'historia-noche-tipografico')
  const viejos = [{ id: 'crema-a', destino: 'reel', paleta: 'crema', estilo: 'a', v: 1 }, { id: 'noche-a', destino: 'reel', paleta: 'noche', estilo: 'a' }]
  const r = fusionarClips(viejos, [{ id: 'historia-noche-a', destino: 'historia', paleta: 'noche', estilo: 'a' }, { id: 'crema-a', destino: 'reel', paleta: 'crema', estilo: 'a', v: 2 }], ['noche', 'crema'])
  assert.deepEqual(r.map((c) => c.id), ['noche-a', 'crema-a', 'historia-noche-a'])
  assert.equal(r[1].v, 2)
})

test('cada cuenta tiene sus cierres: clips que existen, de cada paleta, y voz grabada', () => {
  for (const id of readdirSync(join(RAIZ, 'cuentas')).filter((x) => !/^[_.]/.test(x) && existsSync(join(RAIZ, 'cuentas', x, 'cuenta.json')))) {
    const dc = join(RAIZ, 'cuentas', id)
    const cuenta = JSON.parse(readFileSync(join(dc, 'cuenta.json'), 'utf8'))
    const ruta = join(dc, cuenta.cierre.clips)
    assert.ok(existsSync(ruta), `${id}: falta ${cuenta.cierre.clips}`)
    /** @type {any[]} */
    const clips = JSON.parse(readFileSync(ruta, 'utf8'))
    const paletas = Object.keys(JSON.parse(readFileSync(join(dc, cuenta.marca.paletas), 'utf8')))
    for (const c of clips) {
      assert.ok(existsSync(join(dirname(ruta), c.archivo)), `${id}: no existe ${c.archivo}`)
      assert.ok(['reel', 'historia'].includes(c.destino), `${id}: ${c.id} sin destino`)
      assert.ok(paletas.includes(c.paleta), `${id}: ${c.id} con una paleta que la cuenta no tiene`)
      assert.ok(c.duracion_s >= 3 && c.duracion_s <= 8, `${id}: ${c.id} dura ${c.duracion_s}`)
    }
    for (const p of paletas) assert.ok(clips.some((c) => c.destino === 'reel' && c.paleta === p), `${id}: la paleta ${p} no tiene cierre de reel`)
    if (cuenta.destinos.historia.cierre === 'historia') assert.ok(clips.some((c) => c.destino === 'historia'), `${id}: pide cierre de historia y no tiene clips`)
    const config = JSON.parse(readFileSync(join(dc, 'cta', 'cierre.json'), 'utf8'))
    for (const d of ['reel', 'historia']) {
      const v = config[d]?.voz
      if (v) for (const f of [v.wav, v.palabras]) assert.ok(existsSync(join(dc, 'cta', f)), `${id}: falta cta/${f}`)
    }
  }
})

test('armarFinal de punta a punta con medios sintéticos: −14 LUFS, pico ≤ −1,5 y pasa revisarSalida', { ...sinFfmpeg, timeout: 120_000 }, async () => {
  const { dc } = cuentaFalsa({ reel: null })
  const dir = mkdtempSync(join(tmpdir(), 'render-final-'))
  const ff = (/** @type {string[]} */ a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
  const cuerpo = join(dir, '2026-11-25-009-aguinaldo-mitos', 'v0', 'cuerpo.mp4')
  mkdirSync(dirname(cuerpo), { recursive: true })
  ff(['-f', 'lavfi', '-i', 'color=c=0x223344:s=1080x1920:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=220:d=4,volume=0.2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', cuerpo])
  const clip = join(dc, 'cta', 'clips', 'papel-buscador.mp4')
  ff(['-f', 'lavfi', '-i', 'color=c=0xeeddcc:s=1080x1920:r=30:d=1.5', '-f', 'lavfi', '-i', 'sine=f=440:d=1.5,volume=0.1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip])
  const musica = join(dir, 'musica.m4a')
  ff(['-f', 'lavfi', '-i', 'sine=f=330:d=3,volume=0.3', '-c:a', 'aac', musica])
  const env = entornoSinSecretos(process.env)
  const r = await armarFinal({ cuerpo, firma: firma({ color: 'calido', textura: 'grano' }), clip: { id: 'papel-buscador', paleta: 'papel', estilo: 'buscador', destino: 'reel', archivo: clip, duracion_s: 1.5 }, musica, conVoz: true, dir: dirname(cuerpo), destino: 'reel', env })
  assert.ok(Math.abs(r.lufs + 14) <= 1, `LUFS ${r.lufs}`)
  assert.ok(r.pico <= -1.5, `pico ${r.pico}`)
  assert.ok(Math.abs(r.duracion_s - 5.5) <= 0.1, `dura ${r.duracion_s}`)
  assert.equal(r.cierre.propio, false)
  assert.ok(existsSync(r.archivo))
})
