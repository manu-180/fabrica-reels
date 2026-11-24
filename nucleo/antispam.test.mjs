import assert from 'node:assert/strict'
import { test } from 'node:test'
import { actualizarRampa, aplicarErrorRampa, leerCuentaReal, leerCupo, levantarPausaVencida, puedePublicar } from './antispam.mjs'
import { creativo, cuentaAr, cuentaWeb, estadoCon, graphFalso, sinEspera } from './__fixtures__/ayuda.mjs'

const AHORA = new Date('2026-11-09T16:00:00Z')
const real = (/** @type {any} */ extra = {}) => ({ publicaciones_24h: [], ultima_at: null, cupo: { usado: 5, total: 100 }, username: 'prueba.ar', recientes: [], historias: [], ...extra })

test('leerCuentaReal: todo lo de 24 h (reels, feed e historias, propio y ajeno), el cupo y el usuario', async () => {
  const g = graphFalso([
    ['GET', /^\/178$/, () => ({ id: '178', username: 'prueba.ar' })],
    ['GET', /^\/178\/media$/, () => ({ data: [
      { id: 'm1', caption: 'propio', timestamp: '2026-11-09T15:00:00+0000', media_product_type: 'REELS' },
      { id: 'm2', caption: 'de demos', timestamp: '2026-11-09T10:00:00+0000', media_product_type: 'REELS' },
      { id: 'm3', caption: 'de ayer', timestamp: '2026-11-08T10:00:00+0000', media_product_type: 'FEED' },
    ] })],
    ['GET', /^\/178\/stories$/, () => ({ data: [{ id: 's1', timestamp: '2026-11-09T15:30:00+0000' }] })],
    ['GET', /^\/178\/content_publishing_limit$/, () => ({ data: [{ quota_usage: 7, config: { quota_total: 100 } }] })],
  ])
  const e = estadoCon('prueba-ar', [creativo('2026-11-09-a', [{ prueba: { ig_media_id: 'm1', publicado_at: '2026-11-09T15:00:00.000Z' } }])])
  const r = await leerCuentaReal({ igUser: '178', token: 't', ahora: AHORA, fetch: g.fetch, espera: sinEspera, estado: e })
  assert.deepEqual(r.publicaciones_24h.map((p) => [p.id, p.tipo, p.propia]), [['s1', 'STORY', false], ['m1', 'REELS', true], ['m2', 'REELS', false]])
  assert.equal(r.ultima_at, '2026-11-09T15:30:00.000Z')
  assert.deepEqual(r.cupo, { usado: 7, total: 100 })
  assert.equal(r.username, 'prueba.ar')
  assert.equal(r.recientes.length, 3)
  assert.deepEqual(r.historias, [{ id: 's1', at: '2026-11-09T15:30:00.000Z' }])
})

test('leerCupo lee /content_publishing_limit', () => {
  assert.deepEqual(leerCupo({ data: [{ quota_usage: 5, config: { quota_total: 100, quota_duration: 86400 } }] }), { total: 100, usado: 5 })
  assert.equal(leerCupo({ data: [] }), null)
})

test('puedePublicar: tope con lo ajeno (D5), tope propio por la rampa, gap, cupo reservado y el usuario del token', () => {
  const cuenta = cuentaAr()
  const vacio = estadoCon('prueba-ar', [])
  assert.deepEqual(puedePublicar({ cuenta, estado: vacio, cuentaReal: real(), ahora: AHORA }), { ok: true })
  const llena = real({ publicaciones_24h: Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, at: `2026-11-09T0${Math.floor(i / 2)}:00:00.000Z`, tipo: 'REELS', propia: false })) })
  assert.match(String(/** @type {any} */ (puedePublicar({ cuenta, estado: vacio, cuentaReal: llena, ahora: AHORA })).motivo), /12 publicaciones/)
  // Rampa: el 9/11 es el día 8 desde el 1/11, segundo escalón (6 acciones); con el estado sosteniendo el primero, 3.
  const propias = estadoCon('prueba-ar', [creativo('2026-11-09-a', Array.from({ length: 3 }, (_, i) => ({ prueba: { ig_media_id: `p${i}`, publicado_at: `2026-11-09T1${i}:00:00.000Z` } })))])
  assert.deepEqual(puedePublicar({ cuenta, estado: propias, cuentaReal: real(), ahora: AHORA }), { ok: true })
  const sostenido = { ...propias, rampa: { escalon: 0, desde: '2026-11-08T00:00:00.000Z', bajadas: [] } }
  assert.match(String(/** @type {any} */ (puedePublicar({ cuenta, estado: sostenido, cuentaReal: real(), ahora: AHORA })).motivo), /tope del día 3/)
  const reciente = estadoCon('prueba-ar', [creativo('2026-11-09-a', [{ prueba: { ig_media_id: 'p', publicado_at: '2026-11-09T15:30:00.000Z' } }])])
  assert.match(String(/** @type {any} */ (puedePublicar({ cuenta, estado: reciente, cuentaReal: real(), ahora: AHORA })).motivo), /hace 30 min/)
  assert.match(String(/** @type {any} */ (puedePublicar({ cuenta, estado: vacio, cuentaReal: real({ cupo: { usado: 85, total: 100 } }), ahora: AHORA })).motivo), /cupo/)
  assert.match(String(/** @type {any} */ (puedePublicar({ cuenta, estado: vacio, cuentaReal: real({ cupo: null }), ahora: AHORA })).motivo), /cupo/)
  assert.match(String(/** @type {any} */ (puedePublicar({ cuenta, estado: vacio, cuentaReal: real({ username: 'apex.stack' }), ahora: AHORA })).motivo), /@apex\.stack/)
  assert.equal(puedePublicar({ cuenta, estado: vacio, cuentaReal: null, ahora: AHORA }).ok, false)
})

test('aplicarErrorRampa: baja un escalón y lo sostiene; dos en 7 días pausan 48 h', () => {
  const cuenta = cuentaAr()
  const e1 = aplicarErrorRampa({ estado: estadoCon('prueba-ar', []), cuenta, codigo: '9/2207078', ahora: AHORA })
  assert.equal(e1.rampa?.escalon, 0)
  assert.equal(e1.pausado, null)
  const e2 = aplicarErrorRampa({ estado: e1, cuenta, codigo: '9/2207078', ahora: new Date('2026-11-12T16:00:00Z') })
  assert.equal(e2.rampa?.escalon, 0)
  assert.equal(e2.pausado_por, 'antispam')
  assert.equal(e2.pausado_hasta, '2026-11-14T16:00:00.000Z')
  assert.equal(levantarPausaVencida(e2, new Date('2026-11-14T15:00:00Z')).pausado_por, 'antispam')
  assert.equal(levantarPausaVencida(e2, new Date('2026-11-14T16:00:00Z')).pausado, null)
  const lejos = aplicarErrorRampa({ estado: e1, cuenta, codigo: '4', ahora: new Date('2026-11-20T16:00:00Z') })
  assert.equal(lejos.pausado, null)
  const sinRampa = aplicarErrorRampa({ estado: estadoCon('prueba-web', []), cuenta: cuentaWeb(), codigo: '9/2207078', ahora: AHORA })
  assert.equal(sinRampa.rampa?.bajadas.length, 1)
})

test('actualizarRampa: tras 7 días sin antispam sube un escalón; cuando alcanza al calendario deja de limitar', () => {
  const cuenta = cuentaAr()
  const e = { ...estadoCon('prueba-ar', []), rampa: { escalon: 0, desde: '2026-11-09T16:00:00.000Z', bajadas: [{ at: '2026-11-09T16:00:00.000Z', codigo: '9/2207078' }] } }
  assert.equal(actualizarRampa({ estado: e, cuenta, ahora: new Date('2026-11-15T16:00:00Z') }), e)
  const subio = actualizarRampa({ estado: e, cuenta, ahora: new Date('2026-11-16T16:00:00Z') })
  assert.equal(subio.rampa?.escalon, 1)
  assert.equal(actualizarRampa({ estado: subio, cuenta, ahora: new Date('2026-11-23T17:00:00Z') }).rampa, null)
})
