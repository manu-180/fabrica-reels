// @ts-check
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { PANTALLAS_APP, esApp, layouts, pantallasDe, validar } from './armar.mjs'

const AQUI = fileURLToPath(new URL('.', import.meta.url))
const leer = (/** @type {string} */ f) => JSON.parse(readFileSync(join(AQUI, f), 'utf8'))

test('antes-despues: la web vieja para negocios, el caos de papel para quien da clases', () => {
  const web = leer('ejemplo.json')
  const app = leer('ejemplo-app.json')
  assert.deepEqual(validar(web), [])
  assert.deepEqual(validar(app), [])
  assert.equal(esApp(web), false)
  assert.equal(esApp(app), true)
  const apto = (/** @type {any} */ g) => layouts.filter((l) => l.apto(g)).map((l) => l.id)
  assert.deepEqual(apto(web), ['web'])
  assert.deepEqual(apto(app), ['app'])
  // Sin antes.tipo lo dicen los defectos (dos o más de planilla, grupo, cuaderno...). Una lista de precios no es caos.
  const sinTipo = structuredClone(app)
  delete sinTipo.contenido.antes.tipo
  delete sinTipo.contenido.despues.pantallas
  assert.equal(esApp(sinTipo), true)
  const precios = structuredClone(web)
  precios.contenido.antes.defectos = ['Turnos solo por teléfono', 'Fotos de hace años', 'Lista de precios vieja']
  assert.equal(esApp(precios), false)
})

test('antes-despues: cada pantalla del layout app es una captura que existe, y no se repiten', () => {
  for (const id of Object.keys(PANTALLAS_APP)) assert.ok(existsSync(join(AQUI, 'pantallas', `${id}.jpg`)), id)
  assert.deepEqual(readdirSync(join(AQUI, 'pantallas')).map((x) => x.replace(/\.jpg$/, '')).sort(), Object.keys(PANTALLAS_APP).sort())
  assert.deepEqual(pantallasDe({ secciones: ['Mis clases', 'Lista de espera', 'Historial'] }), ['misclases', 'calendario', 'historial'])
  assert.equal(new Set(pantallasDe({ secciones: ['Pagos', 'Alumnos', 'Calendario'] })).size, 3)
  const malo = leer('ejemplo-app.json')
  malo.contenido.despues.pantallas = ['inventada']
  assert.ok(validar(malo).some((x) => /pantallas\[0\]/.test(x)))
})
