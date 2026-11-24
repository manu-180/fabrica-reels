import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agendar, alPublicar, cola, descartarViejas, moverAFranja, relojEfectivo, siguiente } from './agenda.mjs'
import { publicacionDe, tocarPublicacion } from './estado.mjs'
import { azar, diaAR, instanteAR, minutoAR } from './tiempo.mjs'
import { creativo, cuentaAr, cuentaWeb, estadoCon } from './__fixtures__/ayuda.mjs'

const DIA = '2026-11-10'
const vacia = (/** @type {string} */ id, /** @type {number} */ slot, /** @type {number} */ variantes = 1) =>
  creativo(id, Array.from({ length: variantes }, () => ({ prueba: {}, normal: {}, historia: {} })), { slot, fecha: DIA })
const real = { publicaciones_24h: [], ultima_at: null, cupo: { usado: 5, total: 100 }, username: 'prueba.ar', recientes: [], historias: [] }

test('agendar: cada slot en su parte de las franjas, minutos que no terminan en 0 ni 5, con segundos, y determinista', () => {
  const cuenta = cuentaAr()
  const creativos = [vacia(`${DIA}-a`, 0), vacia(`${DIA}-b`, 1), vacia(`${DIA}-c`, 2)]
  const a = agendar({ cuenta, creativos, dia: DIA, semilla: cuenta.id })
  assert.deepEqual(agendar({ cuenta, creativos, dia: DIA, semilla: cuenta.id }), a)
  const pruebas = a.map((c) => /** @type {string} */ (c.variantes[0].publicaciones.prueba?.no_antes_de))
  const minutos = pruebas.map((t) => minutoAR(t))
  // 09:00 a 23:59 en tres partes; la última no pasa de 23:59 menos (60 + 30 + 50).
  assert.ok(minutos[0] >= 9 * 60 && minutos[0] < 14 * 60, `${pruebas[0]}`)
  assert.ok(minutos[1] >= 14 * 60 && minutos[1] < 19 * 60, `${pruebas[1]}`)
  assert.ok(minutos[2] >= 19 * 60 && minutos[2] <= 23 * 60 + 59 - 140, `${pruebas[2]}`)
  for (const t of pruebas) {
    assert.equal(diaAR(t), DIA)
    assert.notEqual(minutoAR(t) % 5, 0)
    assert.notEqual(new Date(t).getUTCSeconds(), 0)
  }
  for (const c of a) {
    assert.equal(c.variantes[0].publicaciones.normal?.no_antes_de, null)
    assert.equal(c.variantes[0].publicaciones.historia?.no_antes_de, null)
    assert.equal(c.variantes[0].publicaciones.prueba?.vence, '2026-11-11T02:59:59.000Z')
  }
})

test('agendar: con dos variantes (APEX) son dos slots por creativo sobre las dos franjas', () => {
  const cuenta = cuentaWeb()
  const [c] = agendar({ cuenta, creativos: [vacia(`${DIA}-a`, 0, 2)], dia: DIA, semilla: 'x' })
  const [m0, m1] = /** @type {any} */ (c).variantes.map((/** @type {any} */ v) => minutoAR(v.publicaciones.prueba.no_antes_de))
  // 11:30 a 14:30 y 18:00 a 23:30 son 510 minutos: la primera mitad termina a las 19:15, y la segunda prueba
  // no pasa de 23:30 menos (60 + 30 + 50) para que entren su normal y su historia.
  assert.ok(m0 >= 11 * 60 + 30 && m0 < 19 * 60 + 15 && !(m0 > 14 * 60 + 30 && m0 < 18 * 60), String(m0))
  assert.ok(m1 >= 19 * 60 + 15 && m1 <= 21 * 60 + 10, String(m1))
})

test('agendar: con la prueba apagada, la normal toma el reloj del slot; producido tarde no agenda en el pasado', () => {
  const cuenta = cuentaAr()
  const e = { ...estadoCon('prueba-ar', []), destinos_apagados: { prueba: { motivo: 'x', at: 'x' } } }
  const [c] = agendar({ cuenta, creativos: [vacia(`${DIA}-a`, 0)], dia: DIA, semilla: 'x', estado: e })
  assert.equal(c?.variantes[0].publicaciones.prueba?.no_antes_de, null)
  assert.ok(c?.variantes[0].publicaciones.normal?.no_antes_de)
  const tarde = new Date(instanteAR(DIA, 22 * 60 + 30))
  const [d] = agendar({ cuenta, creativos: [vacia(`${DIA}-a`, 0)], dia: DIA, semilla: 'x', ahora: tarde })
  assert.ok(d?.variantes[0].publicaciones.prueba?.descartada_at)
  assert.equal(d?.variantes[0].publicaciones.prueba?.motivo_descarte, 'sin franja')
})

test('alPublicar: la normal sale espera + 3 a 25 min después de la prueba, la historia igual desde la normal', () => {
  const cuenta = cuentaAr()
  const id = `${DIA}-a`
  let e = estadoCon('prueba-ar', agendar({ cuenta, creativos: [vacia(id, 1)], dia: DIA, semilla: 'x' }))
  const prueba = instanteAR(DIA, 15 * 60 + 7).toISOString()
  e = tocarPublicacion(e, { creativo: id, variante: 0, destino: 'prueba' }, { publicado_at: prueba, ig_media_id: '1' })
  e = alPublicar({ estado: e, cuenta, ref: { creativo: id, variante: 0, destino: 'prueba' }, publicado_at: prueba, semilla: 'x' })
  const normal = /** @type {string} */ (publicacionDe(e, { creativo: id, variante: 0, destino: 'normal' })?.no_antes_de)
  const dif = (Date.parse(normal) - Date.parse(prueba)) / 60_000
  assert.ok(dif >= 63 && dif <= 86, String(dif))
  assert.notEqual(minutoAR(normal) % 5, 0)
  e = tocarPublicacion(e, { creativo: id, variante: 0, destino: 'normal' }, { publicado_at: normal, ig_media_id: '2' })
  e = alPublicar({ estado: e, cuenta, ref: { creativo: id, variante: 0, destino: 'normal' }, publicado_at: normal, semilla: 'x' })
  const historia = /** @type {string} */ (publicacionDe(e, { creativo: id, variante: 0, destino: 'historia' })?.no_antes_de)
  const dif2 = (Date.parse(historia) - Date.parse(normal)) / 60_000
  assert.ok(dif2 >= 33 && dif2 <= 56, String(dif2))
})

test('alPublicar: fuera de franja se corre a la siguiente; sin franja se descarta; una historia tras una normal de después de las 23 también', () => {
  const cuenta = cuentaWeb()
  const id = `${DIA}-a`
  const base = estadoCon('prueba-web', [vacia(id, 0)])
  const prueba = instanteAR(DIA, 14 * 60 + 2).toISOString()
  const e = alPublicar({ estado: base, cuenta, ref: { creativo: id, variante: 0, destino: 'prueba' }, publicado_at: prueba, semilla: 'x' })
  const normal = minutoAR(/** @type {string} */ (publicacionDe(e, { creativo: id, variante: 0, destino: 'normal' })?.no_antes_de))
  assert.ok(normal >= 18 * 60 + 3 && normal <= 18 * 60 + 26, String(normal))
  const tarde = instanteAR(DIA, 23 * 60 + 10).toISOString()
  const e2 = alPublicar({ estado: base, cuenta, ref: { creativo: id, variante: 0, destino: 'normal' }, publicado_at: tarde, semilla: 'x' })
  assert.match(String(publicacionDe(e2, { creativo: id, variante: 0, destino: 'historia' })?.motivo_descarte), /23/)
  const e3 = alPublicar({ estado: base, cuenta, ref: { creativo: id, variante: 0, destino: 'prueba' }, publicado_at: instanteAR(DIA, 22 * 60 + 50).toISOString(), semilla: 'x' })
  assert.equal(publicacionDe(e3, { creativo: id, variante: 0, destino: 'normal' })?.motivo_descarte, 'sin franja')
  assert.equal(moverAFranja(cuenta, DIA, instanteAR(DIA, 12 * 60).getTime(), azar('x')), instanteAR(DIA, 12 * 60).getTime())
  assert.equal(moverAFranja(cuenta, DIA, instanteAR(DIA, 23 * 60 + 40).getTime(), azar('x')), null)
})

test('cola y relojEfectivo: la normal hereda el reloj de una prueba que quedó afuera; mientras la prueba está pendiente, espera', () => {
  const cuenta = cuentaAr()
  const id = `${DIA}-a`
  const e = estadoCon('prueba-ar', [creativo(id, [{ prueba: { no_antes_de: '2026-11-10T15:00:00.000Z' }, normal: {}, historia: {} }], { fecha: DIA })])
  const ahora = new Date('2026-11-10T16:00:00Z')
  assert.deepEqual(cola({ estado: e, cuenta, ahora }).map((x) => x.ref.destino), ['prueba'])
  const afuera = tocarPublicacion(e, { creativo: id, variante: 0, destino: 'prueba' }, { intentos_publicar: 3 })
  assert.equal(relojEfectivo(afuera, cuenta, { creativo: id, variante: 0, destino: 'normal' }), '2026-11-10T15:00:00.000Z')
  assert.deepEqual(cola({ estado: afuera, cuenta, ahora }).map((x) => x.ref.destino), ['normal'])
  const apagada = { ...e, destinos_apagados: { prueba: { motivo: 'x', at: 'x' } } }
  assert.deepEqual(cola({ estado: apagada, cuenta, ahora }).map((x) => x.ref.destino), ['normal'])
})

test('siguiente: la vencida más vieja si pasa el antispam; con --ahora, la próxima de hoy', () => {
  const cuenta = cuentaAr()
  const e = estadoCon('prueba-ar', [
    creativo(`${DIA}-a`, [{ prueba: { no_antes_de: '2026-11-10T15:10:00.000Z' } }], { fecha: DIA }),
    creativo(`${DIA}-b`, [{ prueba: { no_antes_de: '2026-11-10T14:10:00.000Z' } }], { fecha: DIA, slot: 1 }),
    creativo(`${DIA}-c`, [{ prueba: { no_antes_de: '2026-11-10T22:10:00.000Z' } }], { fecha: DIA, slot: 2 }),
  ])
  const ahora = new Date('2026-11-10T16:00:00Z')
  assert.equal(siguiente({ estado: e, cuenta, ahora, cuentaReal: real }).ref?.creativo, `${DIA}-b`)
  assert.equal(siguiente({ estado: e, cuenta, ahora: new Date('2026-11-10T13:00:00Z'), cuentaReal: real }).ref, null)
  assert.equal(siguiente({ estado: e, cuenta, ahora: new Date('2026-11-10T13:00:00Z'), cuentaReal: real, ya: true }).ref?.creativo, `${DIA}-b`)
  const ajena = { ...real, publicaciones_24h: [{ id: 'x', at: '2026-11-10T15:40:00.000Z', tipo: 'REELS', propia: false }] }
  const s = siguiente({ estado: e, cuenta, ahora, cuentaReal: ajena })
  assert.equal(s.ref, null)
  assert.match(s.motivo, /gap/)
})

test('descartarViejas: lo que venció sin salir se descarta con motivo, una sola vez', () => {
  const e = estadoCon('prueba-ar', [creativo('2026-11-08-a', [{ prueba: { no_antes_de: '2026-11-09T01:30:00.000Z' }, normal: { ig_media_id: '9', publicado_at: '2026-11-08T20:01:00.000Z' } }])])
  const ahora = new Date('2026-11-09T12:20:00Z')
  const r = descartarViejas({ estado: e, ahora })
  assert.equal(r.descartadas, 1)
  const p = publicacionDe(r.estado, { creativo: '2026-11-08-a', variante: 0, destino: 'prueba' })
  assert.equal(p?.descartada_at, ahora.toISOString())
  assert.match(String(p?.motivo_descarte), /2026-11-08/)
  assert.equal(publicacionDe(r.estado, { creativo: '2026-11-08-a', variante: 0, destino: 'normal' })?.descartada_at, null)
  assert.equal(descartarViejas({ estado: r.estado, ahora }).descartadas, 0)
})
