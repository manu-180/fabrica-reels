import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estadoVacio, fusionarEstado, leerEstado, leerRef, migrarV1, publicacionDe, serializarEstado, textoRef, tocarPublicacion } from './estado.mjs'
import { creativo, estadoCon } from './__fixtures__/ayuda.mjs'

test('leerEstado: vacío da un estado válido; roto, de otra versión o de otra cuenta tira (perderlo duplicaría publicaciones)', () => {
  const e = leerEstado('', 'prueba-ar')
  assert.equal(e.version, 2)
  assert.equal(e.cuenta, 'prueba-ar')
  assert.deepEqual(e.creativos, {})
  assert.equal(e.pausado, null)
  assert.throws(() => leerEstado('{ esto no es json', 'prueba-ar'))
  assert.throws(() => leerEstado('[]', 'prueba-ar'))
  assert.throws(() => leerEstado(JSON.stringify({ version: 1, creativos: {} }), 'prueba-ar'), /migrarV1/)
  assert.throws(() => leerEstado(serializarEstado(estadoVacio('prueba-web')), 'prueba-ar'), /prueba-web/)
})

test('serializarEstado ordena los creativos y es estable', () => {
  const e = estadoCon('prueba-ar', [creativo('2026-11-09-b', []), creativo('2026-11-08-a', [])])
  const texto = serializarEstado(e)
  assert.ok(texto.indexOf('2026-11-08-a') < texto.indexOf('2026-11-09-b'))
  assert.equal(serializarEstado(leerEstado(texto, 'prueba-ar')), texto)
  assert.ok(texto.endsWith('}\n'))
})

test('refs: texto ida y vuelta, y tocarPublicacion no muta', () => {
  const r = { creativo: '2026-11-09-a', variante: 1, destino: /** @type {const} */ ('normal') }
  assert.equal(textoRef(r), '2026-11-09-a/1/normal')
  assert.deepEqual(leerRef('2026-11-09-a/1/normal'), r)
  assert.throws(() => leerRef('x/y/z'))
  const e = estadoCon('prueba-ar', [creativo('2026-11-09-a', [{ prueba: {} }, { prueba: {}, normal: {} }])])
  const e2 = tocarPublicacion(e, r, { ig_media_id: '9' })
  assert.equal(publicacionDe(e2, r)?.ig_media_id, '9')
  assert.equal(publicacionDe(e, r)?.ig_media_id, null)
})

test('fusionarEstado: por creativo, variante y publicación gana lo que cambió esta corrida', () => {
  const base = estadoCon('prueba-ar', [creativo('2026-11-09-a', [{ prueba: {}, normal: {} }, { prueba: {} }])])
  const remoto = structuredClone(base)
  remoto.creativos['2026-11-08-z'] = creativo('2026-11-08-z', [])
  remoto.creativos['2026-11-09-a'].variantes[0].publicaciones.prueba.metricas = /** @type {any} */ ({ likes: 4 })
  remoto.insights = { disponible: true, motivo: null }
  const propio = structuredClone(base)
  propio.creativos['2026-11-09-a'].variantes[1].publicaciones.prueba.ig_media_id = '777'
  propio.creativos['2026-11-09-a'].variantes[0].publicaciones.normal.ig_container_id = 'c-1'
  propio.pausado = 'token vencido'
  propio.actualizado = '2026-11-09T16:00:00.000Z'
  const f = fusionarEstado(base, remoto, propio)
  assert.ok(f.creativos['2026-11-08-z'])
  const [v0, v1] = f.creativos['2026-11-09-a'].variantes
  assert.deepEqual(v0.publicaciones.prueba.metricas, { likes: 4 })
  assert.equal(v0.publicaciones.normal.ig_container_id, 'c-1')
  assert.equal(v1.publicaciones.prueba.ig_media_id, '777')
  assert.equal(f.pausado, 'token vencido')
  assert.deepEqual(f.insights, { disponible: true, motivo: null })
  assert.equal(f.actualizado, '2026-11-09T16:00:00.000Z')
})

test('fusionarEstado: los ids de Meta y las marcas de publicado nunca se pierden en una carrera', () => {
  const base = estadoCon('prueba-ar', [creativo('2026-11-09-a', [{ historia: {} }])])
  const remoto = structuredClone(base)
  Object.assign(remoto.creativos['2026-11-09-a'].variantes[0].publicaciones.historia, { creando_at: '2026-11-09T20:00:00.000Z', ig_container_id: 'c-h' })
  const propio = structuredClone(base)
  Object.assign(propio.creativos['2026-11-09-a'].variantes[0].publicaciones.historia, { error_publicar: 'algo' })
  const h = fusionarEstado(base, remoto, propio).creativos['2026-11-09-a'].variantes[0].publicaciones.historia
  assert.equal(h.error_publicar, 'algo')
  assert.equal(h.ig_container_id, 'c-h')
  assert.equal(h.creando_at, '2026-11-09T20:00:00.000Z')
})

test('fusionarEstado: borrar un creativo sólo pasa si esta corrida lo sacó (limpiar); uno nuevo del remoto queda', () => {
  const base = estadoCon('prueba-ar', [creativo('2026-10-01-viejo', [])])
  const propio = structuredClone(base)
  delete propio.creativos['2026-10-01-viejo']
  const remoto = structuredClone(base)
  remoto.creativos['2026-11-09-nuevo'] = creativo('2026-11-09-nuevo', [])
  const f = fusionarEstado(base, remoto, propio)
  assert.equal(f.creativos['2026-10-01-viejo'], undefined)
  assert.ok(f.creativos['2026-11-09-nuevo'])
  assert.throws(() => fusionarEstado(base, estadoVacio('prueba-web'), propio))
})

test('migrarV1 de calcular: un video con sus publicaciones por tipo es una variante', () => {
  const v1 = {
    version: 1, actualizado: '2026-11-23T00:00:00.000Z', pausado: null, insights: { disponible: false, motivo: 'x' }, saltados: {},
    creativos: {
      '2026-11-23-001-a': {
        clave: '001-a', fecha: '2026-11-23', franja: 2, ronda: 1, titulo: 't', categoria: 'mito', formato: 'mito', paleta: 'selva', producido_at: '2026-11-23T08:00:00.000Z', error: null, intentos: 0,
        variantes: ['prueba', 'normal', 'historia'].map((tipo) => ({ id: tipo, tipo, cambios: { hook: 1, musica: 'acustica-1', cierre: 'selva-sello', color: 'frio', textura: 'grano' }, resumen: 'r', video_url: 'u', duracion_s: 22, caption: tipo === 'historia' ? '' : `c ${tipo}`, publicar_at: '2026-11-23T15:00:00.000Z', ig_media_id: tipo === 'prueba' ? '1' : null, permalink: null, publicado_at: tipo === 'prueba' ? '2026-11-23T15:01:00.000Z' : null, error_publicar: null, intentos_publicar: 0, metricas: tipo === 'prueba' ? { medido_at: 'x', likes: 2 } : null })),
      },
    },
  }
  const e = migrarV1(v1, 'calcular-ar')
  const c = e.creativos['2026-11-23-001-a']
  assert.equal(c.slot, 2)
  assert.equal(c.variantes.length, 1)
  assert.deepEqual(Object.keys(c.variantes[0].publicaciones), ['prueba', 'normal', 'historia'])
  assert.equal(c.variantes[0].publicaciones.prueba?.ig_media_id, '1')
  assert.equal(c.variantes[0].publicaciones.prueba?.metricas?.respuestas, null)
  assert.equal(c.variantes[0].firma.paleta, 'selva')
  assert.equal(c.variantes[0].publicaciones.normal?.vence, '2026-11-24T02:59:59.000Z')
  assert.equal(serializarEstado(leerEstado(serializarEstado(e), 'calcular-ar')), serializarEstado(e))
})

test('migrarV1 de apex-demos: cada variante vieja es otra variante con su prueba, y el reel real es la normal de la suya', () => {
  const variante = (/** @type {string} */ id) => ({ id, cambios: { hook: 0 }, resumen: id, video_url: `u-${id}`, duracion_s: 29, caption: `c ${id}`, publicar_at: '2026-11-09T12:00:00.000Z', ig_media_id: `m-${id}`, permalink: null, publicado_at: '2026-11-09T12:01:00.000Z', error_publicar: null, intentos_publicar: 0, metricas: null })
  const v1 = {
    version: 1, actualizado: 'x', pausado: null, insights: { disponible: false, motivo: null }, saltados: {},
    creativos: { '2026-11-08-001-s': { clave: '001-s', fecha: '2026-11-08', titulo: 't', categoria: 'comedia', formato: 'chat', paleta: 'noche', producido_at: 'x', error: null, intentos: 0, variantes: [variante('v01'), variante('v02')], real: { variante: 'v02', caption: 'real', ig_container_id: 'c', ig_media_id: 'r', permalink: null, publicado_at: '2026-11-09T22:00:00.000Z', error: null, intentos: 0 } } },
  }
  const c = migrarV1(v1, 'apex-stack').creativos['2026-11-08-001-s']
  assert.equal(c.variantes.length, 2)
  assert.equal(c.variantes[0].publicaciones.prueba?.ig_media_id, 'm-v01')
  assert.equal(c.variantes[0].publicaciones.normal, undefined)
  assert.equal(c.variantes[1].publicaciones.normal?.ig_media_id, 'r')
  assert.equal(c.variantes[1].publicaciones.normal?.caption, 'real')
})
