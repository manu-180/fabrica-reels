// @ts-check
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blobVercel } from './blob.mjs'
import { presupuesto, priorizarPorPresupuesto } from './presupuesto.mjs'

const CUENTA = { id: 'assistify', voz: { presupuesto_mes: 18_000 } }
const ESTADO = {
  creativos: {
    a: { fecha: '2026-11-02', voz: { caracteres_pagados: 1200 } },
    b: { fecha: '2026-11-20', voz: { caracteres_pagados: 800 } },
    c: { fecha: '2026-10-30', voz: { caracteres_pagados: 9000 } },
    d: { fecha: '2026-11-21', voz: null },
  },
}

/** @param {object | null} sub @returns {typeof fetch} */
const red = (sub) => async () => (sub ? Response.json(sub) : new Response('no', { status: 401 }))

test('presupuesto: lo del ciclo y lo del mes de la cuenta (mes de Buenos Aires)', async () => {
  const r = await presupuesto({
    cuenta: CUENTA, estado: ESTADO, env: { ELEVENLABS_API_KEY: 'k' },
    fetch: red({ character_count: 83_367, character_limit: 84_239, next_character_count_reset_unix: 1795834800 }),
    // 1/12 a las 0:30 UTC todavía es 30/11 en Buenos Aires
    reloj: () => new Date('2026-12-01T00:30:00Z'),
  })
  assert.deepEqual(r, { quedan_ciclo: 872, quedan_mes_cuenta: 16_000, reinicia_at: '2026-11-28T03:00:00.000Z', disponible: 872 })
})

test('presupuesto sin poder leer la suscripción: null, no 0', async () => {
  const r = await presupuesto({ cuenta: CUENTA, estado: ESTADO, env: { ELEVENLABS_API_KEY: 'k' }, fetch: red(null), reloj: () => new Date('2026-11-23T12:00:00Z') })
  assert.equal(r.quedan_ciclo, null)
  assert.equal(r.disponible, null)
  assert.equal(r.quedan_mes_cuenta, 16_000)
})

test('priorizar: primero lo cacheado y chat, después lo más barato que entre', () => {
  const candidatos = [
    { clave: 'caro', formato: 'mito', faltan: 500 },
    { clave: 'chat', formato: 'chat', faltan: 300 },
    { clave: 'ronda', formato: 'explicador', faltan: 0 },
    { clave: 'medio', formato: 'mito', faltan: 250 },
    { clave: 'barato', formato: 'mito', faltan: 40 },
  ]
  const r = priorizarPorPresupuesto({ candidatos, disponible: 300 })
  assert.deepEqual(r.con_voz.map((c) => c.clave), ['chat', 'ronda', 'barato', 'medio'])
  assert.deepEqual(r.sin_presupuesto.map((c) => c.clave), ['caro'])
  assert.equal(r.usados, 290)
  assert.equal(priorizarPorPresupuesto({ candidatos, disponible: null }).sin_presupuesto.length, 0)
})

test('blobVercel: head devuelve null si no existe, put sin sufijo al azar', async () => {
  class BlobNotFoundError extends Error {}
  /** @type {any[]} */
  const puts = []
  const sdk = {
    BlobNotFoundError,
    head: async (/** @type {string} */ ruta) => {
      if (ruta === 'voz/x/hay.json') return { url: 'https://b/voz/x/hay.json' }
      throw new BlobNotFoundError('no')
    },
    get: async () => ({ statusCode: 200, stream: new Response('hola').body }),
    put: async (/** @type {string} */ ruta, /** @type {any} */ _c, /** @type {any} */ o) => (puts.push({ ruta, o }), { url: `https://b/${ruta}` }),
  }
  const b = await blobVercel({ token: 't', cargar: async () => sdk })
  assert.equal(await b.head('voz/x/no.json'), null)
  assert.deepEqual(await b.head('voz/x/hay.json'), { url: 'https://b/voz/x/hay.json' })
  assert.equal((await b.get('voz/x/hay.json'))?.toString(), 'hola')
  await b.put('voz/x/a.mp3', Buffer.from('a'), { contentType: 'audio/mpeg' })
  assert.equal(puts[0].o.addRandomSuffix, false)
  assert.equal(puts[0].o.allowOverwrite, true)
  await assert.rejects(blobVercel({ token: '' }), /BLOB_READ_WRITE_TOKEN/)
})
