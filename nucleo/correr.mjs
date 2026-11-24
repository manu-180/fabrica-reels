// @ts-check
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cargarCuenta, listarCuentas, variablePausa } from './cuenta.mjs'
import { cola, descartarViejas } from './agenda.mjs'
import { cargarFormato, leerBancoCuenta, leerGuiones } from './banco.mjs'
import { entraHoy, guionesQuemados } from './elegir.mjs'
import { MAX_INTENTOS, fusionarEstado, leerEstado, serializarEstado, todasLasPublicaciones } from './estado.mjs'
import { DIAS_MEDIR } from './meta/medir.mjs'
import { publicadasSinId } from './meta/publicar.mjs'
import { debeProducir } from './producir.mjs'
import { DIA } from './tiempo.mjs'

/*
  La entrada de los workflows (docs/CONTRATO.md § 8):

    node nucleo/correr.mjs planear  [--cuenta <id>]
    node nucleo/correr.mjs producir --cuenta <id> [--guion <clave>] [--seco <dir>]
    node nucleo/correr.mjs publicar --cuenta <id> [--ahora] [--seco]
    node nucleo/correr.mjs medir    --cuenta <id>
    node nucleo/correr.mjs fusionar <base> <remoto> <propio> <salida>

  FABRICA_RAIZ es el checkout de main y FABRICA_ESTADO el de la rama `estado`. Con FABRICA_PUSH=1 cada
  guardado del estado se commitea y se pushea a la rama `estado` (fusión de tres vías, 8 vueltas,
  siempre fast-forward): así un contenedor recién creado queda a salvo aunque el runner muera.
*/

const AQUI = dirname(fileURLToPath(import.meta.url))
export const AUTOR = { nombre: 'manu-180', mail: '157671390+manu-180@users.noreply.github.com' }
const RAMA = 'estado'
const VUELTAS = 8

/** @param {string} raiz */
export const dirEstadoPorDefecto = (raiz) => process.env.FABRICA_ESTADO ?? join(raiz, '.estado')
/** @param {string} id */
export const rutaRelEstado = (id) => `cuentas/${id}/estado.json`

/** @param {string} ruta @param {string} id */
export const leerArchivoEstado = (ruta, id) => leerEstado(existsSync(ruta) ? readFileSync(ruta, 'utf8') : '', id)


/**
 * Los guiones que de verdad se pueden producir hoy: válidos, aceptados por el validar() de su formato,
 * no quemados y adentro de su ventana. Se revalida cada vez.
 * @param {{ cuenta: import('./cuenta.mjs').Cuenta, estado: import('./estado.mjs').EstadoV2, raiz: string, hoy: string }} p
 */
export async function guionesDisponibles({ cuenta, estado, raiz, hoy }) {
  const banco = leerBancoCuenta(cuenta, raiz)
  const guiones = leerGuiones(banco.dirGuiones, { cuenta, ...banco })
  const quemados = guionesQuemados(estado)
  /** @type {string[]} */
  const disponibles = []
  for (const g of guiones) {
    if (g.problemas.length || quemados.has(g.guion.clave) || !entraHoy(g.guion, estado, hoy)) continue
    try {
      const formato = await cargarFormato(join(raiz, 'formatos'), g.guion.formato)
      if (!formato.validar(g.guion).length) disponibles.push(g.guion.clave)
    } catch {
      /* formato que no existe o no carga: no está disponible */
    }
  }
  return { disponibles, total: guiones.length }
}

/**
 * Qué toca en una cuenta en esta corrida. Sólo lee.
 * @param {{ cuenta: import('./cuenta.mjs').Cuenta, estado: import('./estado.mjs').EstadoV2, ahora: Date, env: Record<string, string | undefined>, disponibles: number | null }} p
 */
export function planCuenta({ cuenta, estado, ahora, env, disponibles }) {
  const accion = env.ACCION || 'todo'
  /** @type {string[]} */
  const notas = []
  /** @type {string[]} */
  const avisos = []
  const r = { cuenta: cuenta.id, producir: false, publicar: false, medir: false, notas, avisos }
  if (!cuenta.activa) {
    notas.push('la cuenta no está activa')
    return r
  }
  const pausadaVar = env.FABRICA_PAUSADA === '1' ? 'FABRICA_PAUSADA=1' : env[variablePausa(cuenta.id)] === '1' ? `${variablePausa(cuenta.id)}=1` : null
  if (pausadaVar) notas.push(`${pausadaVar}: no se produce ni se publica`)
  const vencidaLaPausa = Boolean(estado.pausado && estado.pausado_hasta && Date.parse(estado.pausado_hasta) <= ahora.getTime())
  if (!pausadaVar && (accion === 'todo' || accion === 'producir')) {
    const d = debeProducir({ cuenta, estado: vencidaLaPausa ? { ...estado, pausado: null } : estado, ahora, forzado: Boolean(env.GUION) })
    r.producir = d.producir
    notas.push(`producir: ${d.motivo}`)
    if (r.producir && !env.GUION && disponibles !== null && d.slots.every((s) => !s.reintentar)) {
      if (disponibles === 0) {
        r.producir = false
        avisos.push(`no hay guiones disponibles en cuentas/${cuenta.id} (rotos, quemados, fuera de su ventana o que su formato rechaza): banco vacío`)
      } else notas.push(`hay ${disponibles} guiones disponibles`)
    }
  }
  if (!pausadaVar && cuenta.modo === 'real' && (accion === 'todo' || accion === 'publicar')) {
    const ya = env.AHORA === 'true'
    const vencidas = cola({ estado, cuenta, ahora }).filter((x) => ya || Date.parse(x.no_antes_de) <= ahora.getTime())
    const pausaQueSePrueba = Boolean(estado.pausado) && (estado.pausado_por === 'token' || vencidaLaPausa)
    const bloqueada = Boolean(estado.pausado) && !pausaQueSePrueba
    r.publicar = !bloqueada && (vencidas.length > 0 || descartarViejas({ estado, ahora }).descartadas > 0 || publicadasSinId(estado, ahora).length > 0 || pausaQueSePrueba)
    if (estado.pausado) notas.push(`pausado: ${estado.pausado}`)
  } else if (cuenta.modo === 'sombra') notas.push('modo sombra: no se publica')
  if (accion === 'todo' || accion === 'medir' || accion === 'publicar') {
    const desde = ahora.getTime() - DIAS_MEDIR * DIA
    r.medir = todasLasPublicaciones(estado).some((x) => x.pub.ig_media_id && Date.parse(String(x.pub.publicado_at)) >= desde)
  }
  return r
}

/** La matriz del workflow: sólo las cuentas con algo que hacer. @param {ReturnType<typeof planCuenta>[]} planes */
export const matrizDe = (planes) => ({ include: planes.filter((p) => p.producir || p.publicar || p.medir).map(({ cuenta, producir, publicar, medir }) => ({ cuenta, producir, publicar, medir })) })


/**
 * @param {string} dir @returns {(args: string[]) => string}
 */
export const gitEn = (dir) => (args) => execFileSync('git', ['-C', dir, '-c', `user.name=${AUTOR.nombre}`, '-c', `user.email=${AUTOR.mail}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** @param {number} ms */
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Commitea el estado propio sobre la punta remota de la rama `estado` y pushea. Si alguien pusheó en
 * el medio, fusiona de nuevo (base = lo último que esta corrida sabe que estaba arriba) y reintenta,
 * con espera creciente; nunca force push.
 * @param {{ dir: string, cuentaId: string, base: import('./estado.mjs').EstadoV2, propio: import('./estado.mjs').EstadoV2, mensaje: string,
 *   git?: (args: string[]) => string, espera?: (ms: number) => Promise<unknown>, vueltas?: number }} p
 * @returns {Promise<{ estado: import('./estado.mjs').EstadoV2, empujado: boolean }>}
 */
export async function empujarEstado({ dir, cuentaId, base, propio, mensaje, git = gitEn(dir), espera = dormir, vueltas = VUELTAS }) {
  const rel = rutaRelEstado(cuentaId)
  const ruta = join(dir, rel)
  /** @type {unknown} */
  let ultimo = null
  for (let k = 0; k < vueltas; k++) {
    if (k > 0) await espera(1000 * 2 ** (k - 1))
    let hayRemoto = true
    try {
      git(['fetch', '-q', 'origin', RAMA])
    } catch {
      hayRemoto = false
    }
    /** @type {string} */
    let remotoTexto = ''
    if (hayRemoto) {
      try {
        remotoTexto = git(['show', `origin/${RAMA}:${rel}`])
      } catch {
        remotoTexto = ''
      }
    }
    const remoto = leerEstado(remotoTexto, cuentaId)
    const fusion = fusionarEstado(base, remoto, propio)
    const sinFecha = (/** @type {import('./estado.mjs').EstadoV2} */ e) => serializarEstado({ ...e, actualizado: '' })
    if (remotoTexto && sinFecha(fusion) === sinFecha(remoto)) return { estado: remoto, empujado: false }
    if (hayRemoto) {
      try {
        git(['checkout', '-q', '--', rel])
      } catch {
        /* el archivo todavía no está en el índice */
      }
      git(['checkout', '-q', '--detach', `origin/${RAMA}`])
    }
    mkdirSync(dirname(ruta), { recursive: true })
    writeFileSync(ruta, serializarEstado(fusion))
    git(['add', rel])
    git(['commit', '-q', '-m', mensaje])
    try {
      git(['push', '-q', 'origin', `HEAD:refs/heads/${RAMA}`])
      return { estado: fusion, empujado: true }
    } catch (e) {
      ultimo = e
    }
  }
  throw new Error(`no se pudo pushear el estado de ${cuentaId} en ${vueltas} vueltas: ${String(/** @type {Error} */ (ultimo)?.message ?? ultimo).split('\n')[0]}`)
}

/**
 * El guardado que usan producir y publicar: escribe el archivo y, con FABRICA_PUSH=1, lo pushea.
 * @param {{ dir: string, cuentaId: string, base: import('./estado.mjs').EstadoV2, env?: Record<string, string | undefined>, log?: (m: string) => void, git?: (args: string[]) => string, espera?: (ms: number) => Promise<unknown> }} p
 */
export function crearGuardar({ dir, cuentaId, base: inicial, env = process.env, log = () => {}, git, espera }) {
  let base = inicial
  const ruta = join(dir, rutaRelEstado(cuentaId))
  /** @param {import('./estado.mjs').EstadoV2} e @param {string} [mensaje] */
  return async (e, mensaje = `estado ${cuentaId}`) => {
    const propio = { ...e, actualizado: new Date().toISOString() }
    if (env.FABRICA_PUSH !== '1') {
      mkdirSync(dirname(ruta), { recursive: true })
      writeFileSync(ruta, serializarEstado(propio))
      return
    }
    const r = await empujarEstado({ dir, cuentaId, base, propio, mensaje, ...(git ? { git } : {}), ...(espera ? { espera } : {}) })
    base = r.estado
    if (r.empujado) log(`estado de ${cuentaId} pusheado`)
  }
}

/**
 * El estado de esta corrida (propio) sobre la punta de la rama (remoto), con lo que se leyó al
 * arrancar como base. Un archivo que no existe es un estado vacío; uno roto tira. Si no cambió nada más
 * que `actualizado`, queda la rama tal cual (sin commit).
 * @param {{ base: string, remoto: string, propio: string, salida: string }} p
 */
export function fusionarArchivos({ base, remoto, propio, salida }) {
  const texto = readFileSync(propio, 'utf8')
  const id = JSON.parse(texto).cuenta
  if (typeof id !== 'string') throw new Error(`${propio} no dice de qué cuenta es`)
  const r = leerArchivoEstado(remoto, id)
  const f = fusionarEstado(leerArchivoEstado(base, id), r, leerEstado(texto, id))
  const sinFecha = (/** @type {import('./estado.mjs').EstadoV2} */ e) => serializarEstado({ ...e, actualizado: '' })
  mkdirSync(dirname(salida), { recursive: true })
  if (existsSync(remoto) && sinFecha(f) === sinFecha(r)) writeFileSync(salida, readFileSync(remoto, 'utf8'))
  else writeFileSync(salida, serializarEstado(f))
}


/** @param {string} n */
const arg = (n) => {
  const i = process.argv.indexOf(n)
  const v = i !== -1 ? process.argv[i + 1] : undefined
  return v && !v.startsWith('--') ? v : null
}
const enActions = Boolean(process.env.GITHUB_ACTIONS)
/** @param {'notice' | 'warning' | 'error'} tipo @param {string} cuenta @param {string} m */
const anotar = (tipo, cuenta, m) => console.log(enActions ? `::${tipo}::[fabrica:${cuenta}] ${m}` : `[fabrica:${cuenta}] ${tipo}: ${m}`)
/** @param {Record<string, string>} pares */
function salidas(pares) {
  const texto = Object.entries(pares).map(([k, v]) => `${k}=${v}`).join('\n')
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `${texto}\n`, { flag: 'a' })
  else console.log(texto)
}

class Uso extends Error {}

/** @param {string} raiz */
function contexto(raiz) {
  const id = arg('--cuenta')
  if (!id) throw new Uso('falta --cuenta <id>')
  const cuenta = cargarCuenta(id, raiz)
  const dir = dirEstadoPorDefecto(raiz)
  const estado = leerArchivoEstado(join(dir, rutaRelEstado(id)), id)
  const log = (/** @type {string} */ m) => console.log(`[fabrica:${id}] ${m}`)
  return { cuenta, dir, estado, log }
}

/** @param {string} raiz */
async function comandoPlanear(raiz) {
  const una = arg('--cuenta')
  const ids = una ? [una] : listarCuentas(raiz)
  const ahora = new Date()
  const planes = []
  for (const id of ids) {
    try {
      const cuenta = cargarCuenta(id, raiz)
      const estado = leerArchivoEstado(join(dirEstadoPorDefecto(raiz), rutaRelEstado(id)), id)
      const env = process.env
      const necesitaBanco = cuenta.activa && (env.ACCION || 'todo') !== 'publicar' && !env.GUION
      const disponibles = necesitaBanco ? (await guionesDisponibles({ cuenta, estado, raiz, hoy: (await import('./producir.mjs')).diaObjetivo(ahora) })).disponibles.length : null
      const p = planCuenta({ cuenta, estado, ahora, env, disponibles })
      for (const n of p.notas) console.log(`[fabrica:${id}] ${n}`)
      for (const a of p.avisos) anotar('warning', id, a)
      planes.push(p)
    } catch (e) {
      anotar('error', id, String(/** @type {Error} */ (e).message).split('\n').slice(0, 4).join(' | '))
      process.exitCode = 1
    }
  }
  const matriz = matrizDe(planes)
  salidas({ matriz: JSON.stringify(matriz), hay: matriz.include.length ? 'true' : 'false' })
}

/** @param {string} raiz */
async function comandoProducir(raiz) {
  const { cuenta, dir, estado, log } = contexto(raiz)
  const { producir } = await import('./producir.mjs')
  const seco = arg('--seco')
  const guardar = seco
    ? async (/** @type {import('./estado.mjs').EstadoV2} */ e) => {
        mkdirSync(resolve(seco), { recursive: true })
        writeFileSync(join(resolve(seco), 'estado.json'), serializarEstado(e))
      }
    : crearGuardar({ dir, cuentaId: cuenta.id, base: estado, log })
  const r = await producir({ cuenta, estado, raiz, guionClave: arg('--guion') ?? (process.env.GUION || null), seco: seco ? resolve(seco) : null, log, guardar })
  salidas({ creativos: r.resultados.filter((x) => x.ok && x.creativo).map((x) => x.creativo).join(' ') })
  if (!r.resultados.length) anotar('notice', cuenta.id, r.motivo)
  for (const x of r.resultados) {
    const intentos = x.creativo ? (r.estado.creativos[x.creativo]?.intentos ?? 0) : 0
    const definitiva = !x.ok && Boolean(x.creativo) && intentos >= MAX_INTENTOS
    anotar(x.ok ? 'notice' : definitiva ? 'error' : 'warning', cuenta.id, x.motivo)
    if (definitiva) process.exitCode = 1
  }
}

/** @param {string} raiz */
async function comandoPublicar(raiz) {
  const { cuenta, dir, estado, log } = contexto(raiz)
  if (process.argv.includes('--seco')) {
    log('--seco: no se publica nada')
    return
  }
  const { publicarCuenta } = await import('./meta/publicar.mjs')
  const guardar = crearGuardar({ dir, cuentaId: cuenta.id, base: estado, log })
  const r = await publicarCuenta({ cuenta, estado, ya: process.argv.includes('--ahora') || process.env.AHORA === 'true', guardar, log })
  await guardar(r.estado)
  salidas({ publicadas: String(r.publicadas.length) })
  if (r.fallar) {
    anotar('error', cuenta.id, r.motivo)
    process.exitCode = 1
  } else anotar(r.publicadas.length ? 'notice' : 'warning', cuenta.id, r.motivo)
}

/** @param {string} raiz */
async function comandoMedir(raiz) {
  const { cuenta, dir, estado, log } = contexto(raiz)
  const { medir } = await import('./meta/medir.mjs')
  try {
    const r = await medir({ cuenta, estado, log })
    if (r.medidas) await crearGuardar({ dir, cuentaId: cuenta.id, base: estado, log })(r.estado, `estado ${cuenta.id}: métricas`)
    log(`${r.medidas} publicaciones medidas; insights ${r.estado.insights.disponible ? 'disponibles' : `no (${r.estado.insights.motivo})`}`)
  } catch (e) {
    anotar('warning', cuenta.id, `medir falló: ${String(/** @type {Error} */ (e).message).split('\n')[0]}`)
  }
}

function comandoFusionar() {
  const [base, remoto, propio, salida] = process.argv.slice(3)
  if (!base || !remoto || !propio || !salida) throw new Uso('uso: correr.mjs fusionar <base> <remoto> <propio> <salida>')
  fusionarArchivos({ base, remoto, propio, salida })
  console.log(`[fabrica] estado fusionado en ${salida}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const raiz = resolve(process.env.FABRICA_RAIZ ?? join(AQUI, '..'))
  /** @type {Record<string, () => unknown>} */
  const tareas = { planear: () => comandoPlanear(raiz), producir: () => comandoProducir(raiz), publicar: () => comandoPublicar(raiz), medir: () => comandoMedir(raiz), fusionar: comandoFusionar }
  const tarea = tareas[process.argv[2] ?? '']
  if (!tarea) {
    console.error('uso: node nucleo/correr.mjs planear [--cuenta id] | producir --cuenta id [--guion X] [--seco dir] | publicar --cuenta id [--ahora] [--seco] | medir --cuenta id | fusionar <base> <remoto> <propio> <salida>')
    process.exit(2)
  }
  Promise.resolve()
    .then(tarea)
    .catch((e) => {
      console.error(`[fabrica] ${String(/** @type {Error} */ (e).message).split('\n')[0]}`)
      process.exit(e instanceof Uso ? 2 : 1)
    })
}

