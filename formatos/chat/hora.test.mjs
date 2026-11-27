import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { validar } from './armar.mjs'

const leer = (ruta) => JSON.parse(readFileSync(new URL(ruta, import.meta.url), 'utf8'))

test('la hora propia del chat se acepta y todos los guiones de chat de las cuentas validan', () => {
  let vistos = 0
  for (const cuenta of readdirSync(new URL('../../cuentas/', import.meta.url))) {
    for (const f of readdirSync(new URL(`../../cuentas/${cuenta}/guiones/`, import.meta.url))) {
      const g = leer(`../../cuentas/${cuenta}/guiones/${f}`)
      if (g.formato !== 'chat') continue
      assert.deepEqual(validar(g), [], `${cuenta}/${f}`)
      vistos++
    }
  }
  assert.ok(vistos > 0)
  const g = leer('../../cuentas/assistify/guiones/001-chat-cancela-a-medianoche.json')
  assert.equal(g.contenido.hora, '00:07')
  g.contenido.hora = 'medianoche'
  assert.match(validar(g).join(), /contenido.hora/)
})
