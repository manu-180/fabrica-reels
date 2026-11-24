// @ts-check
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { temaDe } from '../_comun/tema.mjs'
import { armarCierre } from './armar.mjs'

/* Renderiza un cierre de prueba con el tema de una cuenta:
   node formatos/_cierre/probar.mjs --cuenta <id> --paleta p --estilo tipografico|buscador
     --titular "..." --destacado "..." [--corte n] [--ficha "..."] [--pista "..."]
     [--captura img] [--portada img] [--ancho 780] [--marco x,y,w,h] [--voz wav --palabras json] [--salida dir] */

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const args = process.argv.slice(2)
const op = (/** @type {string} */ n, /** @type {string} */ d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? String(args[i + 1]) : d }
const id = op('cuenta')
const dirCuenta = join(RAIZ, 'cuentas', id)
const cuenta = JSON.parse(readFileSync(join(dirCuenta, 'cuenta.json'), 'utf8'))
const tema = temaDe({ cuenta, dirCuenta, paleta: op('paleta'), motivo: op('motivo', cuenta.marca.motivos[0]) })
const estilo = /** @type {'tipografico' | 'buscador'} */ (op('estilo', 'tipografico'))
const base = resolve(op('salida', 'pruebas'))
const nombre = `cierre-${id}-${tema.paleta.clave}-${estilo}`
const proyecto = join(base, nombre)
rmSync(proyecto, { recursive: true, force: true })
const marco = op('marco') ? op('marco').split(',').map(Number) : null
const palabras = op('palabras') ? JSON.parse(readFileSync(op('palabras'), 'utf8')) : null
await armarCierre({
  tema, estilo, salida: proyecto,
  textos: { titular: op('titular'), destacado: op('destacado'), corte: op('corte') ? Number(op('corte')) : null, ficha: op('ficha') || null, pista: op('pista') },
  captura: op('captura') || op('portada') ? { resultado: op('captura') || undefined, portada: op('portada') || undefined, ancho: Number(op('ancho', '780')), marco: marco ? { x: Number(marco[0]), y: Number(marco[1]), w: Number(marco[2]), h: Number(marco[3]) } : null } : null,
  voz: op('voz') && palabras ? { wav: op('voz'), palabras: palabras.palabras ?? palabras } : null,
})
const mp4 = join(base, `${nombre}.mp4`)
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const r = spawnSync(npx, ['--yes', 'hyperframes@0.8.140', 'render', proyecto, '--output', mp4, '--fps', '30', '--quality', 'delivery', '--quiet', '--experimental-fast-capture=false', '--video-frame-format', 'jpg'], { stdio: 'inherit', shell: process.platform === 'win32' })
if (r.status !== 0 || !existsSync(mp4)) throw new Error('render falló')
spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', 'fps=2,scale=270:480,tile=5x2', '-frames:v', '1', '-update', '1', join(base, `${nombre}-hoja.jpg`)])
console.log(`render: ${mp4}`)
