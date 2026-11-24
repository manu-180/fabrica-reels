// @ts-check
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizarTexto, partirOraciones, planDeFrases } from './texto.mjs'

const PAUSAS = { tras_hook: 0.85, entre: 0.8, antes_cta: 0.9, coma: 0.25 }

test('normalizarTexto: NFC y espacios simples', () => {
  assert.equal(normalizarTexto('  Hola \n  vos  '), 'Hola vos')
  assert.equal(normalizarTexto('café'), 'café')
})

test('partirOraciones pega las de menos de tres palabras a la anterior', () => {
  assert.deepEqual(partirOraciones('Tu aguinaldo se calcula sobre el mejor sueldo. Así nomás. ¿Lo sabías vos?'), [
    'Tu aguinaldo se calcula sobre el mejor sueldo. Así nomás.',
    '¿Lo sabías vos?',
  ])
})

test('planDeFrases: pausas de la regla de Manuel y coma sólo con tres palabras a cada lado', () => {
  const f = planDeFrases({
    hook: 'Nadie te cuenta esto del aguinaldo.',
    cuerpo: 'Se calcula con el mejor sueldo del semestre, no con el último que cobraste. Si cambiaste de trabajo, también cuenta. Hacé la cuenta con tus números.',
    pausas: PAUSAS,
  })
  assert.deepEqual(f.map((x) => [x.parte, x.texto, x.pausa]), [
    ['hook', 'Nadie te cuenta esto del aguinaldo.', 0.85],
    ['cuerpo', 'Se calcula con el mejor sueldo del semestre,', 0.25],
    ['cuerpo', 'no con el último que cobraste.', 0.8],
    ['cuerpo', 'Si cambiaste de trabajo, también cuenta.', 0.9],
    ['cuerpo', 'Hacé la cuenta con tus números.', 0.5],
  ])
})

test('planDeFrases: el cuerpo no depende del hook (se comparte entre variantes)', () => {
  const cuerpo = 'Primera oración del cuerpo compartido. Segunda oración del mismo cuerpo.'
  const a = planDeFrases({ hook: 'Un hook bien distinto.', cuerpo, pausas: PAUSAS }).filter((x) => x.parte === 'cuerpo')
  const b = planDeFrases({ hook: 'Otro hook que no se parece.', cuerpo, pausas: PAUSAS }).filter((x) => x.parte === 'cuerpo')
  assert.deepEqual(a, b)
  assert.equal(a[0]?.previo, '')
  const hook = planDeFrases({ hook: 'Un hook bien distinto.', cuerpo, pausas: PAUSAS })[0]
  assert.equal(hook?.siguiente, 'Primera oración del cuerpo compartido. Segunda oración del mismo cuerpo.')
})

test('planDeFrases sin cuerpo: el hook cierra con la cola', () => {
  const f = planDeFrases({ hook: 'Sólo un hook de prueba.', cuerpo: null, pausas: PAUSAS })
  assert.deepEqual(f.map((x) => x.pausa), [0.5])
})
