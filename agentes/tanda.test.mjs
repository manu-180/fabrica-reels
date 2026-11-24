import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { creativo, cuentaAr, estadoCon } from '../nucleo/__fixtures__/ayuda.mjs'
import { estadoVacio } from '../nucleo/estado.mjs'
import { diasHastaVentana, guardarIdeas, limpiarDolores, planGuiones, planIdeas, repartirFormatos } from './tanda.mjs'

const TODOS = ['chat', 'mito', 'explicador', 'antes-despues', 'lista-de-errores', 'pregunta', 'comparador', 'cuenta-regresiva']
const cuenta = (/** @type {number} */ porDia = 1) => {
  const c = cuentaAr()
  return { ...c, creativos_por_dia: porDia, marca: { ...c.marca, formatos: TODOS } }
}
const HECHOS = new Map([['h1', { id: 'h1', tipo: /** @type {const} */ ('dato'), texto: 'x', cifras: [], fuente: 'manuel:2026-11-23', envejece: null }]])
/** @param {string} id @param {any} [x] */
const idea = (id, x = {}) => ({ id, tema: `tema-${id}`, idea: id, angulo: 'dato', formato_sugerido: 'explicador', hechos: ['h1'], ventana: null, origen: 'hechos', ...x })
/** @param {string} clave @param {any} [x] */
const guion = (clave, x = {}) => ({ clave, idea: null, formato: 'explicador', categoria: 'x', hooks: [], ...x })
const HOY = '2026-11-24'

test('diasHastaVentana: 0 adentro, días hasta la próxima apertura afuera, también cruzando el año', () => {
  assert.equal(diasHastaVentana({ desde: '11-20', hasta: '12-18' }, HOY), 0)
  assert.equal(diasHastaVentana({ desde: '12-10', hasta: '12-31' }, HOY), 16)
  assert.equal(diasHastaVentana({ desde: '02-10', hasta: '03-31' }, HOY), 78)
  assert.equal(diasHastaVentana({ desde: '12-20', hasta: '01-10' }, '2027-01-05'), 0)
})

test('planGuiones: con stock de sobra no escribe; con poco pide 7 días repartidos en todos los formatos', () => {
  const ideas = new Map(Array.from({ length: 12 }, (_, i) => [`i${i}`, idea(`i${i}`)]))
  const lleno = Array.from({ length: 20 }, (_, i) => guion(`${100 + i}-g`))
  const p1 = planGuiones({ cuenta: cuenta(), estado: estadoVacio('prueba-ar'), guiones: lleno, ideas, hechos: HECHOS, hoy: HOY })
  assert.equal(p1.escribir, false)
  assert.equal(p1.dias_stock, 20)

  const p2 = planGuiones({ cuenta: cuenta(), estado: estadoVacio('prueba-ar'), guiones: lleno.slice(0, 5), ideas, hechos: HECHOS, hoy: HOY })
  assert.equal(p2.escribir, true)
  assert.equal(p2.pedidos.length, 7)
  assert.equal(new Set(p2.pedidos.map((p) => p.formato)).size, 7, 'siete formatos distintos en siete guiones')
  assert.ok(!p2.pedidos.some((p) => p.formato === 'cuenta-regresiva'), 'sin ideas de fecha no hay cuenta regresiva')
  assert.equal(p2.pedidos[0]?.numero, 105)
  assert.equal(p2.proximo_numero, 105)
  assert.deepEqual(p2.pedidos[0]?.hechos.map((h) => h.id), ['h1'])
})

test('planGuiones: tope, ideas con guion afuera y lo que ya salió no cuenta como stock', () => {
  const ideas = new Map([['i0', idea('i0')], ['i1', idea('i1')], ['i2', idea('i2')]])
  const guiones = [guion('100-a', { idea: 'i0' }), guion('101-b')]
  const estado = estadoCon('prueba-ar', [creativo('2026-11-20-101-b', [{ prueba: {} }])])
  const p = planGuiones({ cuenta: cuenta(), estado, guiones, ideas, hechos: HECHOS, hoy: HOY, tope: 1 })
  assert.equal(p.sin_salir, 1)
  assert.equal(p.pedidos.length, 1)
  assert.notEqual(p.pedidos[0]?.idea.id, 'i0')
})

test('planGuiones: primero la temporada vigente o próxima, que se lleva la cuenta regresiva; la lejana espera', () => {
  const ideas = new Map([
    ['comun', idea('comun')],
    ['lejana', idea('lejana', { origen: 'temporada', ventana: { desde: '06-01', hasta: '06-30' } })],
    ['proxima', idea('proxima', { origen: 'temporada', ventana: { desde: '12-10', hasta: '12-31' } })],
    ['vigente', idea('vigente', { origen: 'temporada', ventana: { desde: '11-20', hasta: '12-18' } })],
  ])
  const p = planGuiones({ cuenta: cuenta(), estado: estadoVacio('prueba-ar'), guiones: [], ideas, hechos: HECHOS, hoy: HOY })
  assert.deepEqual(p.pedidos.map((x) => x.idea.id), ['vigente', 'proxima', 'comun'])
  assert.equal(p.pedidos[0]?.motivo, 'temporada')
  assert.ok(p.pedidos.slice(0, 2).some((x) => x.formato === 'cuenta-regresiva'))
  assert.equal(p.faltan_ideas, true)
})

test('planGuiones: un tema que rindió pide una variante que evita los guiones que ya tiene', () => {
  const ideas = new Map([['vieja', idea('vieja', { tema: 'sobrino' })], ...Array.from({ length: 10 }, (_, i) => /** @type {[string, any]} */ ([`n${i}`, idea(`n${i}`)]))])
  const metricas = (/** @type {number} */ likes) => ({ medido_at: 'x', vistas: null, alcance: null, likes, comentarios: 0, compartidos: null, guardados: null, comentarios_web: 0, promedio_visto_s: null, respuestas: null, avances: null, salidas: null, preguntas: null })
  const medido = (/** @type {string} */ id, /** @type {string} */ tema, /** @type {number} */ likes) => creativo(id, [{ prueba: { ig_media_id: id, publicado_at: `${id.slice(0, 10)}T15:00:00.000Z`, metricas_72h: metricas(likes) } }], { tema })
  const estado = estadoCon('prueba-ar', [medido('2026-11-10-a', 'sobrino', 90), medido('2026-11-10-b', 'otro', 1), medido('2026-11-11-c', 'sobrino', 80), medido('2026-11-11-d', 'otro', 2)])
  const guiones = [guion('a', { idea: 'vieja', tema: 'sobrino' }), guion('c', { idea: 'vieja', tema: 'sobrino' })]
  const p = planGuiones({ cuenta: cuenta(), estado, guiones, ideas, hechos: HECHOS, hoy: HOY, ahora: new Date('2026-11-24T12:00:00Z') })
  const v = p.pedidos.find((x) => x.motivo === 'variante')
  assert.ok(v, 'hay una variante')
  assert.equal(v?.idea.id, 'vieja')
  assert.deepEqual(v?.evitar, ['a', 'c'])
})

test('repartirFormatos respeta el sugerido cuando empata y deja la cuenta regresiva para las de fecha', () => {
  const f = repartirFormatos({ pedidos: [{ idea: idea('a', { formato_sugerido: 'mito' }) }, { idea: idea('b', { ventana: { desde: '12-01', hasta: '12-31' } }) }], formatos: ['mito', 'cuenta-regresiva', 'chat'], banco: { mito: 5, chat: 5 } })
  assert.deepEqual(f, ['mito', 'cuenta-regresiva'])
})

test('planIdeas: pide cuando quedan menos de 60 días de ideas libres, con techo, y trae hechos sin idea', () => {
  const ideas = new Map([['i0', idea('i0', { hechos: ['h1'] })]])
  const hechos = new Map([...HECHOS, ['h2', { ...HECHOS.get('h1'), id: 'h2' }]])
  const p = planIdeas({ cuenta: cuenta(5), estado: estadoVacio('prueba-ar'), guiones: [], ideas, hechos: /** @type {any} */ (hechos), hoy: HOY })
  assert.equal(p.escribir, true)
  assert.equal(p.cuantas, 40)
  assert.deepEqual(p.hechos_sin_idea.map((h) => h.id), ['h2'])
  const muchas = new Map(Array.from({ length: 70 }, (_, i) => [`i${i}`, idea(`i${i}`)]))
  assert.equal(planIdeas({ cuenta: cuenta(1), estado: estadoVacio('prueba-ar'), guiones: [], ideas: muchas, hechos: HECHOS, hoy: HOY }).escribir, false)
  assert.equal(planIdeas({ cuenta: cuenta(1), estado: estadoVacio('prueba-ar'), guiones: [], ideas: muchas, hechos: HECHOS, hoy: HOY, forzar: true, tope: 3 }).cuantas, 3)
})

test('limpiarDolores saca lo que parezca un dato personal', () => {
  assert.deepEqual(limpiarDolores({ dolores: [{ categoria: 'precio', n: 4 }, { categoria: 'escribió juan@x.com', n: 1 }] }), [{ categoria: 'precio', n: 4 }])
  assert.equal(limpiarDolores(null), null)
})

test('guardarIdeas suma sin pisar y reemplaza pendientes por id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'estado-'))
  writeFileSync(join(dir, 'ideas-auto.json'), JSON.stringify({ ideas: [idea('vieja')] }))
  writeFileSync(join(dir, 'hechos-propuestos.json'), JSON.stringify({ hechos: [{ id: 'p1', motivo: 'viejo' }, { id: 'p2', motivo: 'sigue' }] }))
  const r = guardarIdeas({ dirCuentaEstado: dir, resultado: { ideas: [idea('vieja', { idea: 'otra' }), idea('nueva')], hechos: [{ id: 'p2' }], pendientes: [{ id: 'p1', motivo: 'nuevo' }] } })
  assert.deepEqual(r, { ideas: 2, hechos: 1, pendientes: 1 })
  const ideas = JSON.parse(readFileSync(join(dir, 'ideas-auto.json'), 'utf8')).ideas
  assert.equal(ideas[0].idea, 'vieja')
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'hechos-propuestos.json'), 'utf8')).hechos, [{ id: 'p1', motivo: 'nuevo' }])
})
