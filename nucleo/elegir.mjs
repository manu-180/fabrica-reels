// @ts-check
import { basename } from 'node:path'
import { todasLasPublicaciones } from './estado.mjs'
import { azar, diasEntre } from './tiempo.mjs'

/**
 * Qué guion sale en cada creativo del día (diseño § 6.3): calendario, nuevo, ganador repetido.
 * @typedef {import('./estado.mjs').EstadoV2} EstadoV2
 * @typedef {import('./estado.mjs').Creativo} Creativo
 * @typedef {import('./banco.mjs').GuionLeido} GuionLeido
 * @typedef {{ desde: string, hasta: string }} Ventana
 * @typedef {'calendario' | 'nuevo' | 'ganador'} Motivo
 */

// Un ganador vuelve recién a las 3 semanas y como mucho 4 veces: más seguido cansa a la misma audiencia.
export const DIAS_ENTRE_RONDAS = 21
export const RONDAS_MAX = 4
// Desde que la cuenta tiene 30 días medidos, 1 de cada 7 creativos repite un ganador aunque haya nuevos.
export const CADA_GANADOR = 7
export const DIAS_MEDIDOS_PARA_GANADOR = 30
// Con poco volumen el puntaje es ruido: 20 % de las veces se elige otro de los candidatos.
const AZAR_GANADOR = 0.2
const MEDIDOS_PARA_DESCARTAR = 4

/** Si `dia` (AAAA-MM-DD) cae en la ventana; con `desde` > `hasta` cruza el año. @param {Ventana} v @param {string} dia */
export function enVentana(v, dia) {
  const md = dia.slice(5)
  return v.desde <= v.hasta ? md >= v.desde && md <= v.hasta : md >= v.desde || md <= v.hasta
}

/** El día en que empezó la vuelta de la ventana que contiene a `dia`. @param {Ventana} v @param {string} dia */
export function inicioVentana(v, dia) {
  const anio = Number(dia.slice(0, 4))
  const cruzaYEstaEnEnero = v.desde > v.hasta && dia.slice(5) < v.desde
  return `${cruzaYEstaEnEnero ? anio - 1 : anio}-${v.desde}`
}

/** Las veces que salió el guion, de la más vieja a la más nueva. @param {{ creativos: Record<string, any> }} estado @param {string} clave @returns {Creativo[]} */
export const historialGuion = (estado, clave) =>
  Object.values(estado.creativos)
    .filter((c) => c.clave === clave && c.producido_at)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.producido_at).localeCompare(String(b.producido_at)))

/**
 * Los guiones que no vuelven nunca: los que fallaron por el guion (su formato no lo pudo armar). Lo que
 * falló por algo general (Blob, la voz, un render colgado) no quema el guion.
 * @param {EstadoV2} estado
 */
export function guionesQuemados(estado) {
  const producidos = new Set(Object.values(estado.creativos).filter((c) => c.producido_at).map((c) => c.clave))
  return new Set(Object.values(estado.creativos).filter((c) => c.falla === 'guion' && !producidos.has(c.clave)).map((c) => c.clave))
}

/**
 * El creativo que salió justo antes de (hoy, slot): para no repetir categoría, formato ni diseño seguidos.
 * @param {EstadoV2} estado @param {string} hoy @param {number} slot @returns {Creativo | null}
 */
export function creativoAnterior(estado, hoy, slot) {
  const orden = (/** @type {Creativo} */ c) => `${c.fecha}#${String(c.slot ?? 0).padStart(2, '0')}#${c.producido_at ?? ''}`
  const limite = `${hoy}#${String(slot).padStart(2, '0')}#`
  const previos = Object.values(estado.creativos)
    .filter((c) => (c.producido_at || c.fecha === hoy) && orden(c) < limite)
    .sort((a, b) => orden(a).localeCompare(orden(b)))
  return previos.at(-1) ?? null
}

/**
 * Un guion con `ventana` sólo se produce adentro y una vez por vuelta; uno con `caduca` no sale después
 * de esa fecha.
 * @param {any} guion @param {EstadoV2} estado @param {string} hoy
 */
export function entraHoy(guion, estado, hoy) {
  if (guion?.caduca && hoy > guion.caduca) return false
  const v = guion?.ventana
  if (!v) return true
  if (!enVentana(v, hoy)) return false
  const inicio = inicioVentana(v, hoy)
  return !historialGuion(estado, guion.clave).some((c) => c.fecha >= inicio)
}

/** El tema de un guion: el suyo, el de su idea o su categoría. @param {any} g @param {Map<string, { tema: string }>} [ideas] */
export const temaDe = (g, ideas) => g?.tema ?? (g?.idea ? ideas?.get(g.idea)?.tema : undefined) ?? g?.categoria ?? null

/** Días que lleva la cuenta con métricas. @param {EstadoV2} estado @param {string} hoy */
export function diasMedidos(estado, hoy) {
  const primera = todasLasPublicaciones(estado).filter((x) => x.pub.metricas && x.pub.publicado_at).map((x) => x.creativo.fecha).sort()[0]
  return primera ? diasEntre(primera, hoy) : 0
}

/** Temas del tercil más bajo con 4 o más creativos medidos: no se insiste. @param {Record<string, { puntaje: number, n: number }>} temas */
export function temasQueNoRepiten(temas) {
  const medidos = Object.entries(temas).filter(([, t]) => t.n >= MEDIDOS_PARA_DESCARTAR).sort((a, b) => a[1].puntaje - b[1].puntaje)
  if (medidos.length < 3) return new Set()
  return new Set(medidos.slice(0, Math.floor(medidos.length / 3)).map(([k]) => k))
}

/** Días en que el guion falló sin producirse. @param {EstadoV2} estado @param {string} clave */
const diasFallidos = (estado, clave) => new Set(Object.values(estado.creativos).filter((c) => c.clave === clave && !c.producido_at && c.error).map((c) => c.fecha)).size

/**
 * El guion de un creativo del día y su `ronda` (las veces que ya salió). En orden: uno de calendario
 * (ventana abierta), uno nuevo, un ganador repetido (≥ 21 días desde su última salida y ronda < 4, por
 * puntaje de su tema con 20 % de azar); desde los 30 días medidos, 1 de cada 7 creativos va a ganador
 * aunque haya nuevos. Sin repetir la categoría ni el formato del anterior si hay otro. Lo inválido se
 * saltea y se anota; uno que falló dos días por algo general va al final.
 * @param {{ guiones: GuionLeido[], estado: EstadoV2, hoy: string, slot?: number, excluir?: Set<string>, temas?: Record<string, { puntaje: number, n: number }>,
 *   ideas?: Map<string, any>, semilla?: string }} p
 * @returns {{ elegido: GuionLeido | null, ronda: number, motivo: Motivo | null, saltados: { clave: string, motivo: string }[] }}
 */
export function elegirGuion({ guiones, estado, hoy, slot = 0, excluir = new Set(), temas = {}, ideas = new Map(), semilla = '' }) {
  const quemados = guionesQuemados(estado)
  /** @type {{ clave: string, motivo: string }[]} */
  const saltados = []
  /** @typedef {{ g: GuionLeido, usos: number, ultima: string, temporada: boolean, relegado: boolean, tema: string | null, i: number }} Candidato */
  /** @type {Candidato[]} */
  const candidatos = []
  for (const g of [...guiones].sort((a, b) => (a.archivo < b.archivo ? -1 : a.archivo > b.archivo ? 1 : 0))) {
    const clave = typeof g.guion?.clave === 'string' ? g.guion.clave : basename(g.archivo, '.json')
    if (quemados.has(clave) || excluir.has(clave)) continue
    if (g.problemas.length) {
      saltados.push({ clave, motivo: g.problemas.join('; ') })
      continue
    }
    if (!entraHoy(g.guion, estado, hoy)) continue
    const h = historialGuion(estado, clave)
    candidatos.push({ g, usos: h.length, ultima: h.at(-1)?.fecha ?? '', temporada: Boolean(g.guion.ventana), relegado: diasFallidos(estado, clave) >= 2, tema: temaDe(g.guion, ideas), i: candidatos.length })
  }
  const nada = { elegido: null, ronda: 0, motivo: null, saltados }
  if (!candidatos.length) return nada

  const previo = creativoAnterior(estado, hoy, slot)
  /** @param {Candidato[]} grupo */
  const variado = (grupo) => {
    const cat = (/** @type {Candidato} */ c) => !previo || c.g.guion.categoria !== previo.categoria
    const fmt = (/** @type {Candidato} */ c) => !previo || c.g.guion.formato !== previo.formato
    return grupo.find((c) => cat(c) && fmt(c)) ?? grupo.find(cat) ?? grupo.find(fmt) ?? grupo[0]
  }
  const orden = (/** @type {Candidato} */ a, /** @type {Candidato} */ b) => Number(a.relegado) - Number(b.relegado) || a.ultima.localeCompare(b.ultima) || a.i - b.i
  /** @param {Candidato | undefined} c @param {Motivo} motivo */
  const devolver = (c, motivo) => (c ? { elegido: c.g, ronda: c.usos, motivo, saltados } : nada)

  const calendario = candidatos.filter((c) => c.temporada).sort(orden)
  if (calendario.length) return devolver(variado(calendario), 'calendario')

  const noInsistir = temasQueNoRepiten(temas)
  const ganadores = candidatos.filter((c) => c.usos >= 1 && c.usos < RONDAS_MAX && c.ultima && diasEntre(c.ultima, hoy) >= DIAS_ENTRE_RONDAS && !(c.tema && noInsistir.has(c.tema)))
  const nuevos = candidatos.filter((c) => c.usos === 0).sort(orden)
  const producidos = Object.values(estado.creativos).filter((c) => c.producido_at).length
  const turnoGanador = diasMedidos(estado, hoy) >= DIAS_MEDIDOS_PARA_GANADOR && (producidos + 1) % CADA_GANADOR === 0
  if (nuevos.length && !(turnoGanador && ganadores.length)) return devolver(variado(nuevos), 'nuevo')
  if (!ganadores.length) return nada
  const puntaje = (/** @type {Candidato} */ c) => (c.tema ? (temas[c.tema]?.puntaje ?? 0) : 0)
  const porPuntaje = [...ganadores].sort((a, b) => puntaje(b) - puntaje(a) || orden(a, b))
  const rnd = azar(`ganador:${semilla}:${hoy}:${slot}`)
  if (porPuntaje.length > 1 && rnd() < AZAR_GANADOR) return devolver(porPuntaje[1 + Math.floor(rnd() * (porPuntaje.length - 1))], 'ganador')
  return devolver(variado(porPuntaje), 'ganador')
}
