// @ts-check
import { ZONA } from './cuenta.mjs'

const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' })
const FORMATO_PARTES = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })

export const MIN = 60_000
export const HORA = 3_600_000
export const DIA = 86_400_000

/** @param {Date} fecha */
function partes(fecha) {
  const p = Object.fromEntries(FORMATO_PARTES.formatToParts(fecha).map((x) => [x.type, Number(x.value)]))
  return { anio: p.year ?? 0, mes: p.month ?? 0, dia: p.day ?? 0, hora: p.hour ?? 0, minuto: p.minute ?? 0, segundo: p.second ?? 0 }
}

/** AAAA-MM-DD del día de Buenos Aires. @param {Date | string | number} fecha */
export const diaAR = (fecha) => FORMATO_DIA.format(new Date(fecha))

/** Minutos desde la medianoche de Buenos Aires. @param {Date | string | number} fecha */
export function minutoAR(fecha) {
  const p = partes(new Date(fecha))
  return p.hora * 60 + p.minuto
}

/** @param {string} dia @param {number} [n] */
export function sumarDias(dia, n = 1) {
  const [anio = 0, mes = 1, numero = 1] = dia.split('-').map(Number)
  return new Date(Date.UTC(anio, mes - 1, numero + n)).toISOString().slice(0, 10)
}

/** @param {string} a @param {string} b días de b menos a */
export const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA)

/** @param {number} instante */
function desfase(instante) {
  const p = partes(new Date(instante))
  return Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo) - instante
}

/** El instante de `minutos` después de la medianoche de `dia` en Buenos Aires. @param {string} dia @param {number} minutos */
export function instanteAR(dia, minutos) {
  const [anio = 0, mes = 1, numero = 1] = dia.split('-').map(Number)
  const local = Date.UTC(anio, mes - 1, numero, 0, minutos)
  // Dos pasadas por si algún día Argentina vuelve a tener horario de verano.
  return new Date(local - desfase(local - desfase(local)))
}

/** 23:59:59 de Buenos Aires de `dia`, en ISO. @param {string} dia */
export const finDelDia = (dia) => new Date(instanteAR(dia, 24 * 60).getTime() - 1000).toISOString()

/** 'HH:MM' a minutos. @param {string} h */
export const minutosDe = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

/** Azar determinista. @param {string} semilla @returns {() => number} en [0, 1) */
export function azar(semilla) {
  let h = 2166136261
  for (const c of semilla) h = Math.imul(h ^ (c.codePointAt(0) ?? 0), 16777619)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** @template T @param {T[]} lista @param {() => number} rnd @returns {T[]} */
export function mezclar(lista, rnd) {
  const a = [...lista]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [/** @type {T} */ (a[j]), /** @type {T} */ (a[i])]
  }
  return a
}

/** Entero al azar en [a, b]. @param {() => number} rnd @param {number} a @param {number} b */
export const entre = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1))
