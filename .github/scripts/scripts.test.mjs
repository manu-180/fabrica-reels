// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FIXTURES, leerPlan, partir, raizDe, variableActiva } from './matriz.mjs'
import { revisar } from './vigia.mjs'

const RAIZ = fileURLToPath(new URL('../..', import.meta.url))
const secretosDe = (/** @type {string} */ id) => ({ ig_user: `IG_${id.toUpperCase().replace(/-/g, '_')}_USER_ID`, ig_token: `IG_${id.toUpperCase().replace(/-/g, '_')}_TOKEN`, ig_insights: null })
const raices = (/** @type {Record<string, string>} */ m) => (/** @type {string} */ id) => m[id] ?? null
const plan = (/** @type {string} */ cuenta, extra = {}) => ({ cuenta, producir: false, publicar: false, medir: false, ...extra })

test('variableActiva sigue el formato de variablePausa', () => {
  assert.equal(variableActiva('apex-stack'), 'FABRICA_ACTIVA_APEX_STACK')
})

test('raizDe encuentra las cuentas reales y las de prueba', () => {
  assert.equal(raizDe(RAIZ, 'calcular-ar'), '.')
  assert.equal(raizDe(RAIZ, 'prueba-ar'), FIXTURES)
  assert.equal(raizDe(RAIZ, 'no-existe'), null)
})

test('sin su variable la cuenta no entra aunque planear diga que hay algo', () => {
  const r = partir({ planes: [plan('a', { producir: true }), plan('b', { publicar: true, medir: true })], ids: [], dry: false, esMain: true, env: { FABRICA_ACTIVA_B: '1' }, raizDe: raices({ a: '.', b: '.' }), secretosDe })
  assert.deepEqual(r.producir, [])
  assert.deepEqual(r.publicar.map((f) => f.cuenta), ['b'])
  assert.equal(r.publicar[0].ig_token, 'IG_B_TOKEN')
  assert.equal(r.publicar[0].ig_insights, '')
  assert.match(r.avisos[0], /FABRICA_ACTIVA_A=1/)
})

test('producir y publicar salen en matrices separadas; medir solo cae en publicar', () => {
  const env = { FABRICA_ACTIVA_A: '1', FABRICA_ACTIVA_B: '1' }
  const r = partir({ planes: [plan('a', { producir: true, publicar: true }), plan('b', { medir: true })], ids: [], dry: false, esMain: true, env, raizDe: raices({ a: '.', b: '.' }), secretosDe })
  assert.deepEqual(r.producir.map((f) => f.cuenta), ['a'])
  assert.deepEqual(r.publicar.map((f) => f.cuenta), ['a', 'b'])
})

test('fuera de main no corre nada real', () => {
  const r = partir({ planes: [plan('a', { producir: true })], ids: [], dry: false, esMain: false, env: { FABRICA_ACTIVA_A: '1' }, raizDe: raices({ a: '.' }), secretosDe })
  assert.equal(r.producir.length + r.publicar.length, 0)
  assert.equal(r.avisos.length, 1)
})

test('dry_run produce las pedidas sin mirar variables ni planear, y nunca publica', () => {
  const r = partir({ planes: null, ids: ['a', 'prueba-ar'], dry: true, esMain: false, env: {}, raizDe: raices({ a: '.', 'prueba-ar': FIXTURES }), secretosDe })
  assert.deepEqual(r.producir.map((f) => [f.cuenta, f.raiz]), [['a', '.'], ['prueba-ar', FIXTURES]])
  assert.deepEqual(r.publicar, [])
})

test('una cuenta de prueba nunca corre en real', () => {
  const r = partir({ planes: [plan('prueba-ar', { publicar: true })], ids: [], dry: false, esMain: true, env: { FABRICA_ACTIVA_PRUEBA_AR: '1' }, raizDe: raices({ 'prueba-ar': FIXTURES }), secretosDe })
  assert.equal(r.publicar.length, 0)
  assert.equal(r.errores.length, 1)
})

test('dry_run de una cuenta que no existe es error', () => {
  const r = partir({ planes: null, ids: ['nada'], dry: true, esMain: true, env: {}, raizDe: raices({}), secretosDe })
  assert.equal(r.errores.length, 1)
})

test('leerPlan toma la salida de correr.mjs planear', () => {
  assert.deepEqual(leerPlan('matriz={"include":[{"cuenta":"a","producir":true,"publicar":false,"medir":false}]}\nhay=true\n'), [plan('a', { producir: true })])
  assert.throws(() => leerPlan('hay=false\n'))
})

test('vigía: avisa una cuenta prendida con el estado quieto más de 26 h', () => {
  const ahora = new Date('2026-11-23T12:00:00Z')
  const cuentas = [{ id: 'a', activa: true }, { id: 'b', activa: true }, { id: 'c', activa: true }, { id: 'd', activa: false }]
  const estados = { a: { actualizado: '2026-11-22T00:00:00Z' }, b: { actualizado: '2026-11-23T10:00:00Z' }, c: { actualizado: '2026-11-01T00:00:00Z' }, d: { actualizado: '2026-01-01T00:00:00Z' } }
  const env = { FABRICA_ACTIVA_A: '1', FABRICA_ACTIVA_B: '1', FABRICA_ACTIVA_D: '1' }
  const r = revisar({ cuentas, estados, env, ahora })
  assert.equal(r.problemas.length, 1)
  assert.match(r.problemas[0], /^a: .*36 h/)
})

test('los crons de fabrica.yml calzan con el diseño (§ 8.5 y § 9)', () => {
  const yml = readFileSync(new URL('../workflows/fabrica.yml', import.meta.url), 'utf8')
  const crons = [...yml.matchAll(/cron: '([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(crons, ['5 20,22 * * *', '5 8 * * *', '17,47 11-23,0-2 * * *'])
})
