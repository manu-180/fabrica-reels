import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { distancia } from './diseno.mjs'
import { MAX_INTENTOS } from './estado.mjs'
import { debeProducir, diaObjetivo, producir } from './producir.mjs'
import { minutoAR } from './tiempo.mjs'
import { RAIZ, creativo, cuentaAr, cuentaWeb, estadoCon } from './__fixtures__/ayuda.mjs'

const TARDE = new Date('2026-11-09T20:05:00Z') // 17:05 de Buenos Aires: produce lo de mañana
const MADRUGADA = new Date('2026-11-10T08:05:00Z') // 5:05: produce lo de hoy

/** Dobles de voz, tema, render, cierre y Blob que dejan rastro de cómo los llamaron. */
function dobles() {
  /** @type {Record<string, any[]>} */
  const llamadas = { locutar: [], variar: [], subir: [], temaDe: [] }
  const deps = {
    locutar: async (/** @type {any} */ p) => {
      llamadas.locutar.push(p)
      return { wav: 'voz.wav', duracion_s: 18, palabras: [], proveedor: 'elevenlabs', caracteres_pagados: p.hook.length, caracteres_cache: p.cuerpo.length }
    },
    temaDe: (/** @type {any} */ p) => {
      llamadas.temaDe.push(p)
      return { idioma: p.cuenta.idioma, paleta: { clave: p.paleta }, motivo: p.motivo }
    },
    renderizar: async (/** @type {any} */ p) => writeFileSync(p.salida, 'cuerpo'),
    variar: async (/** @type {any} */ p) => {
      llamadas.variar.push(p)
      const archivo = join(p.dir, `${p.destino}.mp4`)
      writeFileSync(archivo, `${p.destino}-${p.clip.id}`)
      return { archivo, duracion_s: 24 }
    },
    subir: async (/** @type {any} */ p) => {
      llamadas.subir.push(p)
      return `https://x.public.blob.vercel-storage.com/${p.ruta}`
    },
  }
  return { deps, llamadas }
}

test('diaObjetivo: a la tarde lo de mañana, a la madrugada lo de hoy', () => {
  assert.equal(diaObjetivo(TARDE), '2026-11-10')
  assert.equal(diaObjetivo(MADRUGADA), '2026-11-10')
})

test('debeProducir: los slots que da la rampa, cada uno por su lado, con reintentos hasta 3', () => {
  const cuenta = cuentaAr()
  // El 10/11 es el día 9 de la rampa (desde el 1/11): segundo escalón, 2 creativos.
  assert.deepEqual(debeProducir({ cuenta, estado: estadoCon('prueba-ar', []), ahora: TARDE }).slots, [{ slot: 0 }, { slot: 1 }])
  const sostenido = { ...estadoCon('prueba-ar', []), rampa: { escalon: 0, desde: '2026-11-09T00:00:00.000Z', bajadas: [] } }
  assert.deepEqual(debeProducir({ cuenta, estado: sostenido, ahora: TARDE }).slots, [{ slot: 0 }])
  const e = estadoCon('prueba-ar', [
    creativo('2026-11-10-a', [], { slot: 0 }),
    creativo('2026-11-10-b', [], { slot: 1, producido_at: null, error: 'boom', intentos: 1 }),
  ])
  const d = debeProducir({ cuenta, estado: e, ahora: TARDE })
  assert.deepEqual(d.slots, [{ slot: 1, reintentar: 'b' }])
  assert.match(d.motivo, /reintento 2 de 3/)
  e.creativos['2026-11-10-b'].intentos = MAX_INTENTOS
  assert.equal(debeProducir({ cuenta, estado: e, ahora: TARDE }).producir, false)
  const antes = { ...cuenta, rampa: { inicio: '2026-12-01', escalones: /** @type {any} */ (cuenta.rampa).escalones } }
  assert.match(debeProducir({ cuenta: antes, estado: estadoCon('prueba-ar', []), ahora: TARDE }).motivo, /2026-12-01/)
  assert.equal(debeProducir({ cuenta, estado: { ...estadoCon('prueba-ar', []), pausado: 'bloqueo', pausado_por: 'bloqueo' }, ahora: TARDE }).producir, false)
  assert.equal(debeProducir({ cuenta, estado: { ...estadoCon('prueba-ar', []), pausado: 'token', pausado_por: 'token' }, ahora: TARDE }).producir, true)
})

test('producir (APEX, 2 variantes): firmas distintas, el hook siguiente en la hermana, cuerpo locutado para cada hook, historia con su cierre, captions distintos y relojes', async () => {
  const { deps, llamadas } = dobles()
  /** @type {any[]} */
  const guardados = []
  const r = await producir({
    cuenta: cuentaWeb(), estado: estadoCon('prueba-web', []), raiz: RAIZ, ahora: TARDE, reloj: () => TARDE, deps, env: { BLOB_READ_WRITE_TOKEN: 'b' },
    guardar: (e) => { guardados.push(structuredClone(e)) }, trabajo: mkdtempSync(join(tmpdir(), 'fabrica-')),
  })
  assert.equal(r.ok, true, r.motivo)
  const id = r.resultados[0]?.creativo
  const c = r.estado.creativos[String(id)]
  assert.equal(c.fecha, '2026-11-10')
  assert.equal(c.producido_at, TARDE.toISOString())
  assert.equal(c.variantes.length, 2)
  const [v0, v1] = c.variantes
  assert.ok(distancia(v0.firma, v1.firma) >= 3)
  assert.deepEqual([v0.hook, v1.hook], [0, 1])
  assert.equal(llamadas.locutar.length, c.formato === 'chat' ? 0 : 2)
  assert.ok(v0.video_historia_url?.endsWith('-historia.mp4') || v0.video_historia_url?.includes('-0-historia'))
  assert.ok(llamadas.variar.some((x) => x.destino === 'historia' && x.clip.destino === 'historia'))
  assert.ok(llamadas.subir.every((x) => x.ruta.startsWith(`videos/prueba-web/2026-11-10/${id}-`)))
  const captions = c.variantes.flatMap((v) => [v.publicaciones.prueba?.caption, v.publicaciones.normal?.caption])
  assert.equal(new Set(captions).size, 4)
  assert.equal(v0.publicaciones.historia?.caption, '')
  for (const v of c.variantes) {
    assert.ok(v.publicaciones.prueba?.no_antes_de)
    assert.equal(v.publicaciones.normal?.no_antes_de, null)
    assert.ok(minutoAR(/** @type {string} */ (v.publicaciones.prueba?.no_antes_de)) >= 11 * 60 + 30)
  }
  assert.ok(guardados.length >= 2, 'se guarda al empezar (intento contado) y al terminar')
  assert.equal(guardados[0].creativos[String(id)].intentos, 1)
  assert.equal(c.intentos, 0)
})

test('producir: un guion que el formato no puede armar queda quemado; uno que falla por Blob no', async () => {
  const raiz = RAIZ
  const { deps } = dobles()
  const noArma = { ...deps, cargarFormato: async () => ({ validar: () => [], layouts: [], armar: async () => { throw new Error('no entra el texto') } }) }
  const q = await producir({ cuenta: cuentaAr(), estado: estadoCon('prueba-ar', []), raiz, ahora: MADRUGADA, deps: noArma, env: {}, seco: mkdtempSync(join(tmpdir(), 'fabrica-seco-')) })
  for (const x of q.resultados) assert.equal(q.estado.creativos[String(x.creativo)].falla, 'guion')
  const roto = { ...deps, temaDe: () => { throw new Error('sin tema') } }
  const r = await producir({ cuenta: cuentaAr(), estado: estadoCon('prueba-ar', []), raiz, ahora: MADRUGADA, deps: roto, env: { BLOB_READ_WRITE_TOKEN: 'b' }, trabajo: mkdtempSync(join(tmpdir(), 'fabrica-')) })
  assert.equal(r.ok, false)
  for (const x of r.resultados) assert.equal(r.estado.creativos[String(x.creativo)].falla, 'general')
  const sinBlob = await producir({ cuenta: cuentaAr(), estado: estadoCon('prueba-ar', []), raiz, ahora: MADRUGADA, deps, env: {}, trabajo: mkdtempSync(join(tmpdir(), 'fabrica-')) })
  assert.match(sinBlob.motivo, /BLOB_READ_WRITE_TOKEN/)
})

test('producir --seco: sin Blob, los videos quedan en la carpeta y el estado igual se arma', async () => {
  const { deps, llamadas } = dobles()
  const seco = mkdtempSync(join(tmpdir(), 'fabrica-seco-'))
  const r = await producir({ cuenta: cuentaAr(), estado: estadoCon('prueba-ar', []), raiz: RAIZ, ahora: MADRUGADA, deps, env: {}, seco })
  assert.equal(r.ok, true, r.motivo)
  assert.equal(llamadas.subir.length, 0)
  const c = Object.values(r.estado.creativos)[0]
  assert.match(String(c?.variantes[0].video_url), /^file:/)
  assert.equal(r.resultados.length, 2)
  const claves = Object.values(r.estado.creativos).map((x) => x.clave)
  assert.equal(new Set(claves).size, claves.length, 'un guion por día')
})

test('producir con --guion: ese guion, en el primer slot libre del día', async () => {
  const { deps } = dobles()
  const e = estadoCon('prueba-ar', [creativo('2026-11-10-x', [], { slot: 0 })])
  const r = await producir({ cuenta: cuentaAr(), estado: e, raiz: RAIZ, ahora: MADRUGADA, guionClave: '003-preaviso-plazo', deps, env: {}, seco: mkdtempSync(join(tmpdir(), 'fabrica-seco-')) })
  assert.equal(r.ok, true, r.motivo)
  assert.equal(r.estado.creativos['2026-11-10-003-preaviso-plazo'].slot, 1)
  const no = await producir({ cuenta: cuentaAr(), estado: e, raiz: RAIZ, ahora: MADRUGADA, guionClave: 'no-existe', deps, env: {}, seco: mkdtempSync(join(tmpdir(), 'fabrica-seco-')) })
  assert.match(no.motivo, /no existe/)
})

test('producir con conservar (modo sombra): los mp4 finales quedan copiados aunque se borre la carpeta de trabajo, y el render no ve secretos', async () => {
  const { deps, llamadas } = dobles()
  /** @type {any[]} */
  const renders = []
  const conservar = mkdtempSync(join(tmpdir(), 'fabrica-sombra-'))
  const env = { BLOB_READ_WRITE_TOKEN: 'b', FABRICA_GIT_TOKEN: 'ghs', IG_PRUEBA_WEB_TOKEN: 'i', PATH: '/usr/bin' }
  const r = await producir({
    cuenta: cuentaWeb(), estado: estadoCon('prueba-web', []), raiz: RAIZ, ahora: TARDE, reloj: () => TARDE, env, conservar, trabajo: mkdtempSync(join(tmpdir(), 'fabrica-')),
    deps: { ...deps, renderizar: async (/** @type {any} */ p) => { renders.push(p.env); writeFileSync(p.salida, 'cuerpo') } },
  })
  assert.equal(r.ok, true, r.motivo)
  const id = String(r.resultados[0]?.creativo)
  assert.deepEqual(readdirSync(join(conservar, id)).sort(), ['0-historia.mp4', '0-reel.mp4', '1-historia.mp4', '1-reel.mp4'])
  for (const e of [...renders, ...llamadas.variar.map((x) => x.env)]) {
    assert.equal(e.FABRICA_GIT_TOKEN, undefined)
    assert.equal(e.BLOB_READ_WRITE_TOKEN, undefined)
    assert.equal(e.IG_PRUEBA_WEB_TOKEN, undefined)
    assert.equal(e.PATH, '/usr/bin')
  }
})
