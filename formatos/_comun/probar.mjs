// @ts-check
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { temaDe } from './tema.mjs'

/* Arma y renderiza un cuerpo con el tema de una cuenta, sin pasar por producir:
   node formatos/_comun/probar.mjs --cuenta <id> --guion <archivo.json | clave> [--paleta p] [--motivo m]
     [--layout l] [--ronda n] [--hook h] [--voz <dir>/<prefijo>] [--salida dir] [--nombre n] [--solo-armar]
   --voz usa <prefijo>-hook-<h>.json, <prefijo>-cuerpo.json y <prefijo>-voz-<h>.wav (los de una prueba
   anterior: no se paga voz). Sin --voz, una voz muda con tiempos sintéticos: sirve para ver el diseño. */

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const HYPERFRAMES = 'hyperframes@0.8.140'
const CAPTURAS = [
  ['--video-frame-format', 'jpg', '--no-low-memory-mode', '--workers', '1'],
  ['--video-frame-format', 'jpg'],
]
const args = process.argv.slice(2)
const op = (/** @type {string} */ n, /** @type {string} */ d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? String(args[i + 1]) : d }
/** @param {string[]} a */
const ff = (a) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...a], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`)
}
const r3 = (/** @type {number} */ x) => Math.round(x * 1000) / 1000

const idCuenta = op('cuenta')
if (!idCuenta) throw new Error('uso: probar.mjs --cuenta <id> --guion <archivo | clave> [...]')
const dirCuenta = join(RAIZ, 'cuentas', idCuenta)
const cuenta = JSON.parse(readFileSync(join(dirCuenta, 'cuenta.json'), 'utf8'))
const rutaGuion = existsSync(op('guion')) ? op('guion') : join(dirCuenta, 'guiones', `${op('guion')}.json`)
const guion = JSON.parse(readFileSync(rutaGuion, 'utf8'))
const paletas = JSON.parse(readFileSync(join(dirCuenta, cuenta.marca.paletas), 'utf8'))
const paleta = op('paleta', guion.paleta && paletas[guion.paleta] ? guion.paleta : Object.keys(paletas)[0])
const motivo = op('motivo', cuenta.marca.motivos[0])
const ronda = Number(op('ronda', '0'))
const hook = /** @type {0 | 1 | 2} */ (Number(op('hook', '0')))
const base = resolve(op('salida', join(process.cwd(), 'pruebas')))
mkdirSync(base, { recursive: true })
const tema = temaDe({ cuenta, dirCuenta, paleta, motivo })
const layout = op('layout', '')
const nombre = op('nombre', `${idCuenta}-${guion.clave}-${layout || `r${ronda}`}-${paleta}`)

/** @type {any} */
let voz = null
if (guion.voz) {
  const prefijo = op('voz')
  if (prefijo) {
    const h = JSON.parse(readFileSync(`${prefijo}-hook-${hook}.json`, 'utf8'))
    const c = JSON.parse(readFileSync(`${prefijo}-cuerpo.json`, 'utf8'))
    const inicio = r3(Math.max(0, Math.max(h.palabras[0]?.inicio ?? 0, h.inicio_voz_s ?? 0) - 0.03))
    const finHook = Math.min(h.palabras.at(-1)?.fin ?? h.duracion_s, h.fin_voz_s ?? Infinity)
    const corte = r3(Math.min(h.duracion_s, finHook + 0.12))
    const inicioCuerpo = Math.max(c.palabras[0]?.inicio ?? 0, c.inicio_voz_s ?? 0)
    const d = r3(Math.max(corte - inicio + 0.05, finHook - inicio + 0.85 - inicioCuerpo))
    voz = {
      wav: `${prefijo}-voz-${hook}.wav`,
      duracion_s: r3(d + c.duracion_s),
      palabras: [
        ...h.palabras.map((/** @type {any} */ p) => ({ texto: p.texto, inicio_s: r3(Math.max(0, p.inicio - inicio)), fin_s: r3(Math.max(0, Math.min(p.fin, corte) - inicio)) })),
        ...c.palabras.map((/** @type {any} */ p) => ({ texto: p.texto, inicio_s: r3(p.inicio + d), fin_s: r3(p.fin + d) })),
      ],
    }
  } else {
    // Muda: 0,34 s por palabra, aire tras la puntuación y la pausa del hook. Los subtítulos y los visuales calzan igual.
    let t = 0.05
    const palabras = []
    for (const [k, frase] of [guion.hooks[hook], guion.voz].entries()) {
      for (const w of String(frase).trim().split(/\s+/)) {
        const dur = 0.16 + 0.03 * w.length
        palabras.push({ texto: w, inicio_s: r3(t), fin_s: r3(t + dur) })
        t += dur + 0.06 + (/[.,;:?!]$/.test(w) ? 0.28 : 0)
      }
      if (k === 0) t += 0.6
    }
    const wav = join(base, `${nombre}-muda.wav`)
    ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(r3(t + 0.5)), '-c:a', 'pcm_s16le', wav])
    voz = { wav, duracion_s: r3(t + 0.5), palabras }
  }
}

const proyecto = join(base, nombre)
rmSync(proyecto, { recursive: true, force: true })
const formato = await import(pathToFileURL(join(RAIZ, 'formatos', guion.formato, 'armar.mjs')).href)
const problemas = formato.validar(guion)
if (problemas.length) throw new Error(problemas.join('; '))
const armado = await formato.armar({ guion, hook, voz, salida: proyecto, diseno: { ronda, layout: layout || undefined, paleta, firma: null }, tema })
console.log(`armado ${nombre}: ${armado.duracion_s} s`)
if (args.includes('--solo-armar')) process.exit(0)

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const mp4 = join(base, `${nombre}.mp4`)
let ok = false
for (const extra of CAPTURAS) {
  const r = spawnSync(npx, ['--yes', HYPERFRAMES, 'render', proyecto, '--output', mp4, '--fps', '30', '--quality', 'delivery', '--quiet', '--experimental-fast-capture=false', ...extra], {
    stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' },
  })
  if (r.status === 0 && existsSync(mp4)) { ok = true; break }
}
if (!ok) throw new Error('render falló')
ff(['-i', mp4, '-vf', 'fps=2,scale=270:480,tile=6x4', '-frames:v', '1', '-update', '1', join(base, `${nombre}-hoja.jpg`)])
console.log(`render: ${mp4}\nhoja: ${join(base, `${nombre}-hoja.jpg`)}`)
