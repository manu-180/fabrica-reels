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

test('pregunta: el ejemplo valida; sin signo de pregunta o sin la pregunta en la voz, no', () => {
  assert.deepEqual(validar(ejemplo), [])
  const g = structuredClone(ejemplo)
  g.contenido.pregunta = 'Necesito una web si ya tengo Instagram'
  assert.ok(validar(g).some((x) => /termina en/.test(x)))
  const h = structuredClone(ejemplo)
  h.voz = 'Otra cosa totalmente distinta. Sí, y te cuento por qué.'
  assert.ok(validar(h).some((x) => /no lee la pregunta/.test(x)))
})

test('pregunta: la respuesta entra después de leída la pregunta y las claves después de la respuesta', () => {
  const p = planificar(ejemplo, 0, vozDe(ejemplo))
  assert.ok(p.respuesta.t > p.pregunta.fin)
  let previo = p.respuesta.t
  for (const k of p.claves) { assert.ok(k.t > previo); previo = k.t }
})
