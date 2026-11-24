import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CADA_GANADOR, creativoAnterior, elegirGuion, enVentana, entraHoy, guionesQuemados, inicioVentana, temasQueNoRepiten } from './elegir.mjs'
import { MAX_INTENTOS, estadoVacio } from './estado.mjs'
import { sumarDias } from './tiempo.mjs'
import { creativo } from './__fixtures__/ayuda.mjs'

/** @param {string} clave @param {string} categoria @param {Record<string, unknown>} [extra] */
const entrada = (clave, categoria, extra = {}) => ({ archivo: `${clave}.json`, guion: { clave, categoria, formato: 'chat', tema: clave, ...extra }, problemas: [] })
/** @param {string} clave @param {string} fecha @param {Record<string, unknown>} [extra] */
const salio = (clave, fecha, extra = {}) => creativo(`${fecha}-${clave}`, [], { clave, fecha, ...extra })
const vacio = () => estadoVacio('prueba-ar')

test('elegirGuion: el primero por nombre de archivo que nunca salió', () => {
  const guiones = [entrada('b-dos', 'tecnico'), entrada('a-uno', 'comedia'), entrada('c-tres', 'negocio')]
  const e = vacio()
  const r = elegirGuion({ guiones, estado: e, hoy: '2026-11-09' })
  assert.equal(r.elegido?.guion.clave, 'a-uno')
  assert.equal(r.motivo, 'nuevo')
  e.creativos['2026-11-08-a-uno'] = salio('a-uno', '2026-11-08')
  assert.equal(elegirGuion({ guiones, estado: e, hoy: '2026-11-09' }).elegido?.guion.clave, 'b-dos')
})

test('elegirGuion no repite la categoría ni el formato del anterior si hay otro', () => {
  const guiones = [entrada('a-uno', 'comedia'), entrada('b-dos', 'comedia'), entrada('c-tres', 'mito')]
  const e = vacio()
  e.creativos['2026-11-08-a-uno'] = salio('a-uno', '2026-11-08', { categoria: 'comedia' })
  assert.equal(elegirGuion({ guiones, estado: e, hoy: '2026-11-09' }).elegido?.guion.clave, 'c-tres')
  const formatos = [entrada('a', 'x', { formato: 'chat' }), entrada('b', 'y', { formato: 'chat' }), entrada('c', 'y', { formato: 'explicador' })]
  const e2 = vacio()
  e2.creativos['2026-11-09-x'] = salio('x', '2026-11-09', { categoria: 'mito', formato: 'chat', slot: 0 })
  assert.equal(elegirGuion({ guiones: formatos, estado: e2, hoy: '2026-11-09', slot: 1, excluir: new Set(['x']) }).elegido?.guion.clave, 'c')
  assert.equal(creativoAnterior(e2, '2026-11-09', 1)?.clave, 'x')
  assert.equal(creativoAnterior(e2, '2026-11-09', 0), null)
})

test('elegirGuion saltea y anota los inválidos; banco vacío no es un error', () => {
  const malo = { archivo: 'a-malo.json', guion: null, problemas: ['no es JSON'] }
  const r = elegirGuion({ guiones: [malo, entrada('b-bueno', 'mito')], estado: vacio(), hoy: '2026-11-09' })
  assert.equal(r.elegido?.guion.clave, 'b-bueno')
  assert.deepEqual(r.saltados, [{ clave: 'a-malo', motivo: 'no es JSON' }])
  assert.equal(elegirGuion({ guiones: [], estado: vacio(), hoy: '2026-11-09' }).elegido, null)
})

test('elegirGuion: lo que falló por algo general vuelve; lo que falló por el guion queda quemado; dos días de falla general va al final', () => {
  const guiones = [entrada('a-uno', 'comedia'), entrada('b-dos', 'mito'), entrada('c-tres', 'tecnico')]
  const e = vacio()
  const fallido = (/** @type {string} */ fecha, /** @type {'guion' | 'general'} */ falla) => salio('a-uno', fecha, { producido_at: null, error: 'boom', intentos: MAX_INTENTOS, falla })
  e.creativos['2026-11-08-a-uno'] = fallido('2026-11-08', 'general')
  assert.equal(elegirGuion({ guiones, estado: e, hoy: '2026-11-09' }).elegido?.guion.clave, 'a-uno')
  e.creativos['2026-11-08-a-uno'] = fallido('2026-11-08', 'guion')
  assert.ok(guionesQuemados(e).has('a-uno'))
  assert.equal(elegirGuion({ guiones, estado: e, hoy: '2026-11-09' }).elegido?.guion.clave, 'b-dos')
  e.creativos['2026-11-08-a-uno'] = fallido('2026-11-08', 'general')
  e.creativos['2026-11-09-a-uno'] = fallido('2026-11-09', 'general')
  assert.equal(elegirGuion({ guiones, estado: e, hoy: '2026-11-10' }).elegido?.guion.clave, 'b-dos')
  assert.equal(elegirGuion({ guiones, estado: e, hoy: '2026-11-10', excluir: new Set(['b-dos', 'c-tres']) }).elegido?.guion.clave, 'a-uno')
})

test('ganador repetido: agotados los nuevos, vuelve el de mejor tema con 21 días o más y menos de 4 rondas; si no hay, banco vacío', () => {
  const guiones = [entrada('a-uno', 'comedia', { tema: 'aguinaldo' }), entrada('b-dos', 'tecnico', { tema: 'vacaciones' })]
  const e = vacio()
  e.creativos['2026-11-01-a-uno'] = salio('a-uno', '2026-11-01')
  e.creativos['2026-11-02-b-dos'] = salio('b-dos', '2026-11-02')
  assert.equal(elegirGuion({ guiones, estado: e, hoy: '2026-11-15' }).elegido, null, 'nadie cumple 21 días')
  const temas = { aguinaldo: { puntaje: 0.1, n: 1 }, vacaciones: { puntaje: 0.9, n: 1 } }
  const r = elegirGuion({ guiones, estado: e, hoy: '2026-11-25', temas })
  assert.equal(r.motivo, 'ganador')
  assert.equal(r.ronda, 1)
  const elegidos = new Map()
  for (let d = 0; d < 40; d++) {
    const hoy = sumarDias('2026-11-25', d)
    const c = elegirGuion({ guiones, estado: e, hoy, temas, semilla: 's' }).elegido?.guion.clave
    elegidos.set(c, (elegidos.get(c) ?? 0) + 1)
  }
  assert.ok((elegidos.get('b-dos') ?? 0) > (elegidos.get('a-uno') ?? 0), JSON.stringify([...elegidos]))
  assert.ok((elegidos.get('a-uno') ?? 0) > 0, 'el 20 % de azar le da lugar al otro')
  for (const f of ['2026-11-26', '2026-12-20', '2027-01-15']) e.creativos[`${f}-b-dos`] = salio('b-dos', f)
  e.creativos['2026-11-26-a-uno'] = salio('a-uno', '2026-11-26')
  assert.equal(elegirGuion({ guiones: [guiones[1]], estado: e, hoy: '2027-03-01' }).elegido, null, 'b-dos ya salió 4 veces')
})

test('ganador repetido: desde los 30 días medidos, 1 de cada 7 creativos repite aunque haya nuevos', () => {
  const guiones = [entrada('a-viejo', 'comedia', { tema: 'bueno' }), entrada('z-nuevo', 'mito')]
  const e = vacio()
  e.creativos['2026-10-01-a-viejo'] = creativo('2026-10-01-a-viejo', [{ prueba: { publicado_at: '2026-10-01T15:00:00.000Z', metricas: /** @type {any} */ ({ likes: 3 }) } }], { clave: 'a-viejo', fecha: '2026-10-01' })
  for (let i = 0; i < CADA_GANADOR - 3; i++) e.creativos[`2026-10-0${i + 2}-x${i}`] = salio(`x${i}`, `2026-10-0${i + 2}`)
  assert.equal(elegirGuion({ guiones, estado: e, hoy: '2026-11-05' }).motivo, 'nuevo')
  e.creativos['2026-10-09-x9'] = salio('x9', '2026-10-09')
  const r = elegirGuion({ guiones, estado: e, hoy: '2026-11-05' })
  assert.equal(r.motivo, 'ganador')
  assert.equal(r.elegido?.guion.clave, 'a-viejo')
})

test('temasQueNoRepiten: el tercil más bajo con 4 o más medidos', () => {
  const t = { a: { puntaje: -1, n: 5 }, b: { puntaje: 0, n: 4 }, c: { puntaje: 1, n: 6 }, d: { puntaje: -5, n: 2 } }
  assert.deepEqual([...temasQueNoRepiten(t)], ['a'])
  assert.deepEqual([...temasQueNoRepiten({ a: { puntaje: -1, n: 5 } })], [])
})

test('ventana: MM-DD, puede cruzar el año; con ventana sale primero y una vez por temporada; caduca corta para siempre', () => {
  const nav = { desde: '12-01', hasta: '01-10' }
  assert.equal(enVentana(nav, '2026-12-01'), true)
  assert.equal(enVentana(nav, '2027-01-11'), false)
  assert.equal(inicioVentana(nav, '2027-01-05'), '2026-12-01')
  const navidad = entrada('z-navidad', 'negocio', { ventana: nav })
  const guiones = [entrada('a-uno', 'comedia'), navidad]
  const e = vacio()
  assert.equal(elegirGuion({ guiones, estado: e, hoy: '2026-11-20' }).elegido?.guion.clave, 'a-uno')
  const r = elegirGuion({ guiones, estado: e, hoy: '2026-12-05' })
  assert.equal(r.elegido?.guion.clave, 'z-navidad')
  assert.equal(r.motivo, 'calendario')
  e.creativos['2026-12-05-z-navidad'] = salio('z-navidad', '2026-12-05')
  assert.equal(elegirGuion({ guiones: [navidad], estado: e, hoy: '2027-01-05' }).elegido, null)
  assert.equal(elegirGuion({ guiones, estado: e, hoy: '2027-12-02' }).ronda, 1)
  const ley = { clave: '108-x', ventana: { desde: '11-15', hasta: '12-31' }, caduca: '2026-12-31' }
  assert.equal(entraHoy(ley, vacio(), '2026-12-10'), true)
  assert.equal(entraHoy(ley, vacio(), '2027-11-20'), false)
})
