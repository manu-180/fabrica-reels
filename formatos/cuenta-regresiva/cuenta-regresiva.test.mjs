// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { grillaDelMes, planificar, validar } from './armar.mjs'

const ejemplo = JSON.parse(readFileSync(new URL('./ejemplo.json', import.meta.url), 'utf8'))
const vozDe = (/** @type {any} */ g) => {
  let t = 0
  return { palabras: [g.hooks[0], g.voz].join(' ').split(/\s+/).map((texto) => { const p = { texto, inicio_s: t, fin_s: t + 0.3 }; t += 0.4; return p }) }
}

test('cuenta-regresiva: el ejemplo valida; fecha imposible o días que suben, no', () => {
  assert.deepEqual(validar(ejemplo), [])
  const g = structuredClone(ejemplo)
  g.contenido.fecha = '2026-02-30'
  g.contenido.pasos[2].dias = 30
  const p = validar(g)
  assert.ok(p.some((x) => /fecha/.test(x)) && p.some((x) => /va bajando/.test(x)))
})

test('cuenta-regresiva: la grilla de diciembre de 2026 arranca martes y tiene 31 días', () => {
  const g = grillaDelMes(new Date('2026-12-18T12:00:00Z'))
  assert.equal(g.celdas.indexOf(1), 1)
  assert.equal(Math.max(.../** @type {number[]} */ (g.celdas.filter((x) => x !== null))), 31)
  assert.equal(g.celdas.length % 7, 0)
})

test('cuenta-regresiva: la fecha sale en el idioma de la cuenta y los pasos marcan su día del mes', () => {
  const es = planificar(ejemplo, 0, vozDe(ejemplo), 'es-AR')
  assert.equal(es.fecha.texto, '18 de diciembre')
  assert.deepEqual(es.pasos.map((/** @type {any} */ p) => p.dia), [null, 11, 17])
  assert.ok(es.llega > /** @type {any} */ (es.pasos[2]).t)
  assert.equal(planificar(ejemplo, 0, vozDe(ejemplo), 'en-US').fecha.texto, 'December 18')
})
