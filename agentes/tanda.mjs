// @ts-check
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { leerBancoCuenta, leerHechos, leerIdeas } from '../nucleo/banco.mjs'
import { cargarCuenta, dirCuenta, listarCuentas } from '../nucleo/cuenta.mjs'
import { enVentana, guionesQuemados, historialGuion, temaDe, temasQueNoRepiten } from '../nucleo/elegir.mjs'
import { estadoVacio, leerEstado, todasLasPublicaciones } from '../nucleo/estado.mjs'
import { datosPersonales, leerCarpeta, revisarHechosPropuestos, revisarIdeas, revisarTanda, unirPorId, validarHechos } from '../nucleo/hechos.mjs'
import { puntuar } from '../nucleo/puntaje.mjs'
import { diaAR, diasEntre } from '../nucleo/tiempo.mjs'

/**
 * Lo que deciden los workflows `guiones.yml` e `ideas.yml` antes y después del agente: cuándo escribir,
 * qué ideas y en qué formato, y qué de lo que escribió entra a la rama `estado`. El agente sólo escribe;
 * todo lo que se decide con números está acá, con tests.
 * @typedef {import('../nucleo/cuenta.mjs').Cuenta} Cuenta
 * @typedef {import('../nucleo/banco.mjs').Idea} Idea
 * @typedef {import('../nucleo/banco.mjs').Hecho} Hecho
 */

// Diseño § 4.3: se escribe cuando quedan menos de 15 días de guiones y la tanda es de 7 días.
export const MINIMO_DIAS_GUIONES = 15
export const TANDA_DIAS_GUIONES = 7
// Ideas: se piden cuando quedan menos de 60 días de ideas libres; la tanda es de 30 días, con techo.
export const MINIMO_DIAS_IDEAS = 60
export const TANDA_DIAS_IDEAS = 30
export const TECHO_IDEAS = 40
// Un guion de temporada tiene que estar escrito antes de que abra su ventana.
export const DIAS_ANTICIPO_TEMPORADA = 45
// De cada tanda, a lo sumo un cuarto son variantes de temas que rindieron: lo nuevo no se deja de buscar.
const PARTE_VARIANTES = 4
const MEDIDOS_PARA_VARIANTE = 2
// Formatos que necesitan algo de la idea para tener sentido.
const SOLO_CON_FECHA = new Set(['cuenta-regresiva'])

/** @param {string} ruta */
const leerTexto = (ruta) => (existsSync(ruta) ? readFileSync(ruta, 'utf8') : '')

/**
 * Todo lo que la cuenta tiene, juntando main y la rama `estado`.
 * @param {{ cuenta: Cuenta, raiz: string, dirEstado: string | null }} p
 */
export function bancoCompleto({ cuenta, raiz, dirEstado }) {
  const b = leerBancoCuenta(cuenta, raiz)
  const auto = dirEstado ? join(dirEstado, 'cuentas', cuenta.id) : null
  const ideasAuto = auto ? leerIdeas(leerTexto(join(auto, 'ideas-auto.json'))) : new Map()
  const hechosAuto = auto ? leerHechos(leerTexto(join(auto, 'hechos-auto.json'))) : new Map()
  const ideas = new Map([...ideasAuto, ...b.ideas])
  const hechos = new Map([...hechosAuto, ...b.hechos])
  const dirAuto = auto ? join(auto, 'guiones-auto') : null
  // estado.sh (F6) copia los guiones-auto a guiones/ del checkout: la misma clave cuenta una vez.
  const guiones = [...new Map([...leerCarpeta(b.dirGuiones), ...(dirAuto ? leerCarpeta(dirAuto) : [])].map((g) => [g.clave, g])).values()]
  const textoEstado = auto ? leerTexto(join(auto, 'estado.json')) : ''
  const estado = textoEstado.trim() ? leerEstado(textoEstado, cuenta.id) : estadoVacio(cuenta.id)
  const dolores = auto && existsSync(join(auto, 'dolores.json')) ? JSON.parse(leerTexto(join(auto, 'dolores.json'))) : null
  return { ...b, ideas, hechos, ideasAuto, hechosAuto, guiones, dirAuto, estado, dolores }
}

/**
 * La próxima vez que abre la ventana, en días desde hoy (0 si está abierta).
 * @param {{ desde: string, hasta: string }} v @param {string} hoy
 */
export function diasHastaVentana(v, hoy) {
  if (enVentana(v, hoy)) return 0
  const anio = Number(hoy.slice(0, 4))
  const este = `${anio}-${v.desde}`
  return diasEntre(hoy, este >= hoy ? este : `${anio + 1}-${v.desde}`)
}

/**
 * Formatos en los que puede salir una idea: los de la cuenta, y la cuenta regresiva sólo si la idea
 * tiene fecha (una ventana).
 * @param {Idea} idea @param {string[]} formatos
 */
export const formatosPara = (idea, formatos) => formatos.filter((f) => !SOLO_CON_FECHA.has(f) || Boolean(idea.ventana))

/**
 * El formato de cada pedido: reparte la tanda entre todos los formatos de la cuenta (el menos usado de la
 * tanda primero, después el menos usado del banco, después el sugerido por la idea).
 * @param {{ pedidos: { idea: Idea }[], formatos: string[], banco: Record<string, number> }} p
 * @returns {string[]}
 */
export function repartirFormatos({ pedidos, formatos, banco }) {
  /** @type {Record<string, number>} */
  const enTanda = Object.fromEntries(formatos.map((f) => [f, 0]))
  // Las ideas con menos formatos posibles eligen primero, para que la cuenta regresiva quede para las de fecha.
  const orden = pedidos.map((p, i) => ({ i, opciones: formatosPara(p.idea, formatos) })).sort((a, b) => a.opciones.length - b.opciones.length || a.i - b.i)
  /** @type {string[]} */
  const salida = new Array(pedidos.length)
  for (const { i, opciones } of orden) {
    const sugerido = pedidos[i]?.idea.formato_sugerido
    const fecha = Boolean(pedidos[i]?.idea.ventana)
    const costo = (/** @type {string} */ f) => (enTanda[f] ?? 0) * 1000 + (banco[f] ?? 0) - (f === sugerido ? 0.5 : 0) - (fecha && SOLO_CON_FECHA.has(f) ? 0.75 : 0)
    const f = [...opciones].sort((a, b) => costo(a) - costo(b) || formatos.indexOf(a) - formatos.indexOf(b))[0] ?? formatos[0] ?? 'explicador'
    enTanda[f] = (enTanda[f] ?? 0) + 1
    salida[i] = f
  }
  return salida
}

/**
 * Si la cuenta necesita guiones y cuáles pedir (diseño § 4.3 y § 6.3).
 * @param {{ cuenta: Cuenta, estado: any, guiones: any[], ideas: Map<string, Idea>, hechos: Map<string, Hecho>, hoy: string, ahora?: Date,
 *   tope?: number | null, forzar?: boolean, minimoDias?: number }} p
 */
export function planGuiones({ cuenta, estado, guiones, ideas, hechos, hoy, ahora = new Date(`${hoy}T15:00:00Z`), tope = null, forzar = false, minimoDias = MINIMO_DIAS_GUIONES }) {
  const porDia = cuenta.creativos_por_dia
  const quemados = guionesQuemados(estado)
  const sinSalir = guiones.filter((g) => historialGuion(estado, g.clave).length === 0 && !quemados.has(g.clave) && !(g.caduca && hoy > g.caduca)).length
  const diasStock = Math.round((sinSalir / porDia) * 10) / 10
  const n = Math.max(0, Math.min(tope ?? Infinity, TANDA_DIAS_GUIONES * porDia))
  const { temas } = puntuar({ estado, cuenta, ahora })
  const noInsistir = temasQueNoRepiten(temas)
  const conGuion = new Set(guiones.map((g) => g.idea).filter(Boolean))
  /** @type {Record<string, number>} */
  const porTema = {}
  for (const g of guiones) {
    const t = temaDe(g, ideas)
    if (t) porTema[t] = (porTema[t] ?? 0) + 1
  }
  /** @type {Record<string, number>} */
  const banco = {}
  for (const g of guiones) banco[g.formato] = (banco[g.formato] ?? 0) + 1

  const libres = [...ideas.values()].filter((i) => !conGuion.has(i.id) && !noInsistir.has(i.tema) && Array.isArray(i.hechos) && i.hechos.length && i.hechos.every((h) => hechos.has(h)))
  const temporada = libres.filter((i) => i.ventana && diasHastaVentana(i.ventana, hoy) <= DIAS_ANTICIPO_TEMPORADA).sort((a, b) => diasHastaVentana(/** @type {any} */ (a.ventana), hoy) - diasHastaVentana(/** @type {any} */ (b.ventana), hoy) || a.id.localeCompare(b.id))
  // Las de temporada lejana esperan: si se escriben hoy, el guion queda meses sin poder salir.
  const comunes = libres.filter((i) => !i.ventana)

  /** @type {{ idea: Idea, motivo: 'temporada' | 'variante' | 'nueva', evitar?: string[] }[]} */
  const pedidos = []
  for (const i of temporada) if (pedidos.length < n) pedidos.push({ idea: i, motivo: 'temporada' })

  const rindieron = Object.entries(temas)
    .filter(([t, v]) => v.n >= MEDIDOS_PARA_VARIANTE && !noInsistir.has(t))
    .sort((a, b) => b[1].puntaje - a[1].puntaje)
  const mejores = rindieron.slice(0, Math.max(1, Math.floor(rindieron.length / 3)))
  const cupoVariantes = Math.floor(n / PARTE_VARIANTES)
  for (const [tema] of mejores) {
    if (pedidos.filter((p) => p.motivo === 'variante').length >= cupoVariantes || pedidos.length >= n) break
    const delTema = guiones.filter((g) => temaDe(g, ideas) === tema)
    const idea = delTema.map((g) => ideas.get(g.idea)).find((i) => i && i.hechos?.every((h) => hechos.has(h)))
    if (idea) pedidos.push({ idea, motivo: 'variante', evitar: delTema.map((g) => g.clave) })
  }

  // Lo nuevo, de a uno por tema: primero los temas con menos guiones, para que una tanda no sea un solo asunto.
  /** @type {Map<string, Idea[]>} */
  const colas = new Map()
  for (const i of [...comunes].sort((a, b) => (porTema[a.tema] ?? 0) - (porTema[b.tema] ?? 0) || a.id.localeCompare(b.id))) colas.set(i.tema, [...(colas.get(i.tema) ?? []), i])
  while (pedidos.length < n && [...colas.values()].some((l) => l.length))
    for (const l of colas.values()) {
      const i = l.shift()
      if (i && pedidos.length < n) pedidos.push({ idea: i, motivo: 'nueva' })
    }

  const formatos = repartirFormatos({ pedidos, formatos: cuenta.marca.formatos, banco })
  const numeros = guiones.map((g) => Number(String(g.clave).split('-')[0])).filter(Number.isFinite)
  const necesita = forzar || diasStock < minimoDias
  return {
    cuenta: cuenta.id,
    sin_salir: sinSalir,
    por_dia: porDia,
    dias_stock: diasStock,
    ideas_libres: libres.length,
    escribir: necesita && pedidos.length > 0,
    faltan_ideas: necesita && pedidos.length < n,
    motivo: !necesita ? `quedan ${diasStock} días de guiones` : pedidos.length ? `quedan ${diasStock} días: se piden ${pedidos.length}` : 'no quedan ideas libres',
    proximo_numero: Math.max(99, ...numeros) + 1,
    formatos_en_banco: banco,
    pedidos: pedidos.map((p, k) => ({
      numero: Math.max(99, ...numeros) + 1 + k,
      idea: p.idea,
      formato: formatos[k],
      motivo: p.motivo,
      ...(p.evitar ? { evitar: p.evitar } : {}),
      hechos: (p.idea.hechos ?? []).map((h) => hechos.get(h)).filter(Boolean),
    })),
  }
}

/**
 * Si la cuenta necesita ideas y con qué materia prima (diseño § 4.3).
 * @param {{ cuenta: Cuenta, estado: any, guiones: any[], ideas: Map<string, Idea>, hechos: Map<string, Hecho>, hoy: string, ahora?: Date,
 *   tope?: number | null, forzar?: boolean, dolores?: any }} p
 */
export function planIdeas({ cuenta, estado, guiones, ideas, hechos, hoy, ahora = new Date(`${hoy}T15:00:00Z`), tope = null, forzar = false, dolores = null }) {
  const porDia = cuenta.creativos_por_dia
  const conGuion = new Set(guiones.map((g) => g.idea).filter(Boolean))
  const libres = [...ideas.values()].filter((i) => !conGuion.has(i.id)).length
  const dias = Math.round((libres / porDia) * 10) / 10
  const n = Math.max(0, Math.min(tope ?? Infinity, TECHO_IDEAS, TANDA_DIAS_IDEAS * porDia))
  const citados = new Set([...ideas.values()].flatMap((i) => i.hechos ?? []))
  const { temas, con_insights } = puntuar({ estado, cuenta, ahora })
  const ordenados = Object.entries(temas).sort((a, b) => b[1].puntaje - a[1].puntaje)
  const preguntas = [...new Set(todasLasPublicaciones(estado).flatMap((x) => x.pub.metricas_72h?.preguntas ?? x.pub.metricas?.preguntas ?? []))].filter((q) => !datosPersonales(q).length).slice(0, 30)
  /** @type {Record<string, number>} */
  const porTema = {}
  for (const i of ideas.values()) porTema[i.tema] = (porTema[i.tema] ?? 0) + 1
  const necesita = forzar || dias < MINIMO_DIAS_IDEAS
  return {
    cuenta: cuenta.id,
    ideas_libres: libres,
    dias_ideas: dias,
    escribir: necesita && n > 0,
    motivo: necesita ? `quedan ${dias} días de ideas: se piden ${n}` : `quedan ${dias} días de ideas`,
    cuantas: n,
    formatos: cuenta.marca.formatos,
    hechos_sin_idea: [...hechos.values()].filter((h) => !citados.has(h.id)),
    temas: porTema,
    rendimiento: {
      con_insights,
      mejores: ordenados.filter(([, v]) => v.n >= MEDIDOS_PARA_VARIANTE).slice(0, 10).map(([t, v]) => ({ tema: t, ...v })),
      peores: ordenados.filter(([, v]) => v.n >= MEDIDOS_PARA_VARIANTE).slice(-10).map(([t, v]) => ({ tema: t, ...v })),
      no_insistir: [...temasQueNoRepiten(temas)],
      preguntas,
    },
    dolores: limpiarDolores(dolores),
  }
}

/** Lo de `dolores.json` sin nada que parezca un dato personal: ya llega así, pero el repo es público. @param {any} d */
export function limpiarDolores(d) {
  if (!d) return null
  const lista = Array.isArray(d) ? d : Array.isArray(d?.dolores) ? d.dolores : []
  return lista.filter((x) => x && typeof x === 'object' && !datosPersonales(JSON.stringify(x)).length)
}

/** Las líneas de un archivo de un repo con checkout en disco. @param {Record<string, string>} repos dueño/repo → carpeta */
export function lectorDeRepos(repos) {
  /** @type {Map<string, string | null>} */
  const cache = new Map()
  return (/** @type {string} */ repo, /** @type {string} */ archivo) => {
    const dir = repos[repo]
    if (!dir) return null
    const ruta = resolve(dir, archivo)
    if (!ruta.startsWith(resolve(dir))) return null
    if (!cache.has(ruta)) cache.set(ruta, existsSync(ruta) ? readFileSync(ruta, 'utf8') : null)
    return cache.get(ruta) ?? null
  }
}

/** @param {string} n */
const arg = (n) => {
  const i = process.argv.indexOf(n)
  return i !== -1 ? process.argv[i + 1] : undefined
}

/** `--repo dueño/repo=carpeta`, repetible. @returns {Record<string, string>} */
function reposDeArgs() {
  /** @type {Record<string, string>} */
  const r = {}
  process.argv.forEach((a, i) => {
    if (a === '--repo') {
      const [k = '', v = ''] = String(process.argv[i + 1]).split('=')
      if (k && v) r[k] = resolve(v)
    }
  })
  return r
}

/** El repo del que salen las ideas de una cuenta (calcular: su repo público; el resto, el primero de sus hechos). @param {Map<string, Hecho>} hechos */
function repoPrincipal(hechos) {
  /** @type {Record<string, number>} */
  const c = {}
  for (const h of hechos.values()) {
    const m = /^repo:([\w.-]+\/[\w.-]+):/.exec(h.fuente)
    if (m) c[String(m[1])] = (c[String(m[1])] ?? 0) + 1
  }
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const comando = String(process.argv[2])
  const raiz = resolve(process.env.FABRICA_RAIZ ?? join(fileURLToPath(import.meta.url), '..', '..'))
  const dirEstado = arg('--estado') ? resolve(String(arg('--estado'))) : null
  const hoy = arg('--hoy') ?? diaAR(new Date())
  const tope = arg('--tope') ? Number(arg('--tope')) : null
  const forzar = process.argv.includes('--forzar')
  const salida = arg('--salida') ? resolve(String(arg('--salida'))) : null
  const escribirSalida = (/** @type {string} */ nombre, /** @type {unknown} */ datos) => {
    if (!salida) return
    mkdirSync(salida, { recursive: true })
    writeFileSync(join(salida, nombre), JSON.stringify(datos, null, 2) + '\n')
  }

  if (comando === 'cuentas') {
    const pedida = arg('--cuenta')
    const ids = listarCuentas(raiz).filter((id) => (pedida ? id === pedida : cargarCuenta(id, raiz).activa))
    console.log(JSON.stringify({ include: ids.map((cuenta) => ({ cuenta })) }))
    process.exit(0)
  }

  if (comando === 'sumar-auto') {
    console.log(JSON.stringify(sumarAuto({ raiz, dirEstado: resolve(String(arg('--estado'))) })))
    process.exit(0)
  }

  if (comando === 'guardar-ideas') {
    const r = guardarIdeas({ dirCuentaEstado: resolve(String(arg('--destino'))), resultado: JSON.parse(readFileSync(resolve(String(arg('--resultado'))), 'utf8')) })
    console.log(JSON.stringify(r))
    process.exit(0)
  }

  const id = arg('--cuenta')
  if (!id || !['plan-guiones', 'revisar-guiones', 'plan-ideas', 'revisar-ideas', 'validar'].includes(comando)) {
    console.error('uso: node agentes/tanda.mjs cuentas [--cuenta id] | plan-guiones|revisar-guiones|plan-ideas|revisar-ideas|validar --cuenta <id> [--estado dir] [--salida dir] [--dir d] [--repo dueño/repo=dir] [--tope n] [--forzar] [--quitar]')
    process.exit(2)
  }
  const cuenta = cargarCuenta(id, raiz)
  const b = bancoCompleto({ cuenta, raiz, dirEstado })
  const repos = reposDeArgs()
  const leer = lectorDeRepos(repos)
  const principal = repoPrincipal(b.hechos)
  const leerRepo = principal && repos[principal] ? (/** @type {string} */ archivo) => leer(principal, archivo) : null

  if (comando === 'plan-guiones') {
    const plan = planGuiones({ cuenta, estado: b.estado, guiones: b.guiones, ideas: b.ideas, hechos: b.hechos, hoy, tope, forzar })
    escribirSalida('pedido.json', plan)
    console.log(JSON.stringify({ ...plan, pedidos: plan.pedidos.map((p) => `${p.numero} ${p.idea.id} → ${p.formato} (${p.motivo})`) }, null, 2))
  } else if (comando === 'revisar-guiones') {
    const dir = resolve(String(arg('--dir')))
    const r = await revisarTanda({ cuenta, dir, dirFormatos: join(raiz, 'formatos'), ideas: b.ideas, hechos: b.hechos, paletas: b.paletas, existentes: b.guiones, leerRepo })
    const malos = r.filter((x) => x.problemas.length)
    for (const m of malos) {
      console.log(`${m.archivo}: ${m.problemas.join('; ')}`)
      if (process.argv.includes('--quitar')) unlinkSync(join(dir, m.archivo))
    }
    console.log(`${r.length - malos.length} de ${r.length} guiones pasan`)
    process.exit(malos.length && !process.argv.includes('--quitar') ? 1 : 0)
  } else if (comando === 'plan-ideas') {
    const plan = planIdeas({ cuenta, estado: b.estado, guiones: b.guiones, ideas: b.ideas, hechos: b.hechos, hoy, tope, forzar, dolores: b.dolores })
    escribirSalida('pedido-ideas.json', { ...plan, repo_fuente: principal && repos[principal] ? { repo: principal, carpeta: repos[principal] } : null })
    if (salida) writeFileSync(join(salida, 'ideas-existentes.txt'), [...b.ideas.values()].map((i) => `${i.id} | ${i.tema} | ${/** @type {any} */ (i).idea ?? ''}`).join('\n') + '\n')
    console.log(JSON.stringify({ ...plan, hechos_sin_idea: plan.hechos_sin_idea.length }, null, 2))
  } else if (comando === 'revisar-ideas') {
    const dir = resolve(String(arg('--dir')))
    const leerLista = (/** @type {string} */ f) => {
      const t = leerTexto(join(dir, f))
      if (!t.trim()) return []
      const d = JSON.parse(t)
      return Array.isArray(d) ? d : (d.ideas ?? d.hechos ?? [])
    }
    const h = revisarHechosPropuestos({ propuestos: leerLista('hechos-propuestos.json'), existentes: b.hechos, leer })
    const hechos = new Map([...b.hechos, ...h.aceptados.map((x) => /** @type {[string, Hecho]} */ ([x.id, x]))])
    const exigirOrigenRepo = Boolean(leerRepo) && [...b.ideas.values()].some((i) => i.origen_repo)
    const r = revisarIdeas({ nuevas: leerLista('ideas-nuevas.json'), existentes: [...b.ideas.values()], cuenta, hechos, exigirOrigenRepo, leerRepo })
    escribirSalida('resultado-ideas.json', { ideas: r.aceptadas, hechos: h.aceptados, pendientes: h.pendientes, descartadas: r.descartadas })
    for (const d of r.descartadas) console.log(`idea ${d.id}: ${d.motivo}`)
    for (const p of h.pendientes) console.log(`hecho ${p.id}: ${p.motivo}`)
    console.log(`${r.aceptadas.length} ideas y ${h.aceptados.length} hechos entran; ${r.descartadas.length} ideas descartadas, ${h.pendientes.length} hechos pendientes`)
  } else {
    const lista = [...leerHechos(leerTexto(join(dirCuenta(cuenta.id, raiz), 'hechos.json'))).values()]
    const r = validarHechos(lista, { leer })
    const malos = r.filter((x) => x.problemas.length)
    for (const m of malos) console.log(`hecho ${m.id}: ${m.problemas.join('; ')}`)
    const { referenciasRotas } = await import('../nucleo/hechos.mjs')
    const rotas = referenciasRotas({ ideas: b.ideas.values(), guiones: b.guiones.map((g) => ({ archivo: g.clave, guion: g })), hechos: b.hechos })
    for (const x of rotas) console.log(x)
    console.log(`${r.length - malos.length} de ${r.length} hechos bien (${r.filter((x) => x.sin_verificar).length} sin verificar contra su fuente); ${rotas.length} referencias rotas`)
    process.exit(malos.length || rotas.length ? 1 : 0)
  }
}

/**
 * Suma el resultado de una tanda de ideas a los archivos de la cuenta en la rama `estado` (la punta que
 * se acaba de bajar): ideas y hechos aceptados se agregan sin pisar, los pendientes reemplazan a los
 * pendientes con el mismo id.
 * @param {{ dirCuentaEstado: string, resultado: { ideas: any[], hechos: any[], pendientes: any[] } }} p
 * @returns {{ ideas: number, hechos: number, pendientes: number }}
 */
export function guardarIdeas({ dirCuentaEstado, resultado }) {
  mkdirSync(dirCuentaEstado, { recursive: true })
  const lista = (/** @type {string} */ f, /** @type {string} */ k) => {
    const t = leerTexto(join(dirCuentaEstado, f))
    if (!t.trim()) return []
    const d = JSON.parse(t)
    return Array.isArray(d) ? d : (d[k] ?? [])
  }
  const ideas = unirPorId(lista('ideas-auto.json', 'ideas'), resultado.ideas)
  const hechos = unirPorId(lista('hechos-auto.json', 'hechos'), resultado.hechos)
  const nuevosPend = new Set(resultado.pendientes.map((x) => x.id))
  const aceptados = new Set(hechos.map((h) => h.id))
  const pendientes = [...lista('hechos-propuestos.json', 'hechos').filter((x) => !nuevosPend.has(x.id) && !aceptados.has(x.id)), ...resultado.pendientes]
  const escribir = (/** @type {string} */ f, /** @type {string} */ k, /** @type {any[]} */ v) => writeFileSync(join(dirCuentaEstado, f), JSON.stringify({ [k]: v }, null, 2) + '\n')
  escribir('ideas-auto.json', 'ideas', ideas)
  escribir('hechos-auto.json', 'hechos', hechos)
  escribir('hechos-propuestos.json', 'hechos', pendientes)
  return { ideas: ideas.length, hechos: hechos.length, pendientes: pendientes.length }
}

/**
 * Para producir: suma al checkout de main las ideas y hechos automáticos de la rama `estado` (lo de main
 * manda si un id está en los dos), así los guiones de `guiones-auto` que citan una idea o un hecho
 * automático validan igual que los del banco. Sólo toca la copia de trabajo del runner, nunca se commitea.
 * @param {{ raiz: string, dirEstado: string }} p @returns {Record<string, { ideas: number, hechos: number }>}
 */
export function sumarAuto({ raiz, dirEstado }) {
  /** @type {Record<string, { ideas: number, hechos: number }>} */
  const r = {}
  for (const id of listarCuentas(raiz)) {
    const auto = join(dirEstado, 'cuentas', id)
    if (!existsSync(auto)) continue
    const cuenta = cargarCuenta(id, raiz)
    const dir = dirCuenta(id, raiz)
    const banco = cuenta.banco ?? {}
    const sumar = (/** @type {string} */ archivo, /** @type {string} */ deAuto, /** @type {string} */ k) => {
      const nuevas = leerTexto(join(auto, deAuto))
      if (!nuevas.trim()) return 0
      const ruta = join(dir, archivo)
      const actual = leerTexto(ruta)
      const d = actual.trim() ? JSON.parse(actual) : { [k]: [] }
      const lista = Array.isArray(d) ? d : (d[k] ?? [])
      const extra = JSON.parse(nuevas)
      const unidas = unirPorId(lista, Array.isArray(extra) ? extra : (extra[k] ?? []))
      writeFileSync(ruta, JSON.stringify(Array.isArray(d) ? unidas : { ...d, [k]: unidas }, null, 2) + '\n')
      return unidas.length - lista.length
    }
    r[id] = { ideas: sumar(banco.ideas ?? 'ideas.json', 'ideas-auto.json', 'ideas'), hechos: sumar(banco.hechos ?? 'hechos.json', 'hechos-auto.json', 'hechos') }
  }
  return r
}
