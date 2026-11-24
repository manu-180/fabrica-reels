// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { planificar, validar } from './armar.mjs'

const ejemplo = JSON.parse(readFileSync(new URL('./ejemplo.json', import.meta.url), 'utf8'))
const vozDe = (/** @type {any} */ g) => {
  let t = 0
  return { palabras: [g.hooks[0], g.voz].join(' ').split(/\s+/).map((texto) => { const p = { texto, inicio_s: t, fin_s: t + 0.3 }; t += 0.4; return p }) }
}

test('comparador: el ejemplo valida; un ganador raro o puntos de menos, no', () => {
  assert.deepEqual(validar(ejemplo), [])
  const g = structuredClone(ejemplo)
  g.contenido.ganador = 'c'
  g.contenido.b.puntos.pop()
  const p = validar(g)
  assert.ok(p.some((x) => /ganador/.test(x)) && p.some((x) => /b\.puntos/.test(x)))
})

test('comparador: las filas van en orden y el veredicto llega al final', () => {
  const p = planificar(ejemplo, 0, vozDe(ejemplo))
  const [f0, f1, f2] = /** @type {any[]} */ (p.filas)
  assert.ok(f0.marca < f1.marca && f1.marca < f2.marca)
  assert.ok(p.veredicto.t > f2.marca && p.veredicto.t < p.duracion)
})
