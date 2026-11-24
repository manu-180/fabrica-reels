// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { layouts, planificar, validar } from './armar.mjs'

const ejemplo = JSON.parse(readFileSync(new URL('./ejemplo.json', import.meta.url), 'utf8'))
const vozDe = (/** @type {any} */ g) => {
  let t = 0
  return { palabras: [g.hooks[0], g.voz].join(' ').split(/\s+/).map((texto) => { const p = { texto, inicio_s: t, fin_s: t + 0.3 }; t += 0.4; return p }) }
}

test('lista-de-errores: el ejemplo valida y tiene tres layouts', () => {
  assert.deepEqual(validar(ejemplo), [])
  assert.deepEqual(layouts.map((l) => l.id), ['pila', 'tarjetas', 'tachon'])
})

test('lista-de-errores: rechaza dos errores, textos largos y una voz que no los dice en orden', () => {
  const g = structuredClone(ejemplo)
  g.contenido.errores.pop()
  assert.ok(validar(g).some((x) => /exactamente 3/.test(x)))
  const h = structuredClone(ejemplo)
  h.contenido.errores.reverse()
  assert.ok(validar(h).some((x) => /no va en orden/.test(x)))
  const k = structuredClone(ejemplo)
  k.contenido.errores[0].arreglo = 'x'.repeat(70)
  assert.ok(validar(k).some((x) => /arreglo/.test(x)))
})

test('lista-de-errores: cada error se tacha después de decirse y se arregla después de tacharse, en orden', () => {
  const plan = planificar(ejemplo, 0, vozDe(ejemplo))
  let previo = 0
  for (const it of plan.items) {
    assert.ok(it.entra >= previo && it.tacha > it.dice && it.arregla > it.tacha, JSON.stringify(it))
    previo = it.fin
  }
  assert.ok(plan.duracion > /** @type {any} */ (plan.items[2]).fin)
})
