// @ts-check
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blobEnMemoria, claveVoz, crearCacheVoz } from './cache.mjs'

const BASE = {
  proveedor: 'elevenlabs', modelo: 'eleven_multilingual_v2', voice_id: 'abc',
  ajustes: { stability: 0.45, similarity_boost: 0.8, style: 0.3 },
  pausas: { tras_hook: 0.85, entre: 0.8, antes_cta: 0.9, coma: 0.25 },
  texto: 'Hola, ¿cómo va?', previo: '', siguiente: 'Todo bien.',
}

test('claveVoz no depende del orden de las claves ni de espacios', () => {
  const a = claveVoz(BASE)
  const b = claveVoz({ ...BASE, ajustes: { style: 0.3, similarity_boost: 0.8, stability: 0.45 }, texto: '  Hola,   ¿cómo va? ' })
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
})

test('claveVoz cambia con cada campo que cambia el audio', () => {
  const a = claveVoz(BASE)
  for (const cambio of [{ proveedor: 'gemini' }, { modelo: 'otro' }, { voice_id: 'xyz' }, { ajustes: { ...BASE.ajustes, style: 0.4 } },
    { texto: 'Hola, ¿cómo andás?' }, { previo: 'Antes.' }, { siguiente: 'Otra cosa.' }]) {
    assert.notEqual(claveVoz({ ...BASE, ...cambio }), a, JSON.stringify(cambio))
  }
})

test('crearCacheVoz guarda audio y json bajo voz/<cuenta>/ y los lee', async () => {
  const blob = blobEnMemoria()
  const cache = crearCacheVoz({ blob, cuenta: 'calcular-ar' })
  const h = claveVoz(BASE)
  assert.equal(await cache.existe(h), false)
  assert.equal(await cache.leer(h), null)
  const entrada = { texto: 'Hola', proveedor: 'elevenlabs', formato: /** @type {const} */ ('mp3'), duracion_s: 1, palabras: [], bordes: { inicio_s: 0, fin_s: 1 }, caracteres: 4, creado_at: '2026-11-23T00:00:00.000Z' }
  await cache.guardar(h, Buffer.from('mp3'), entrada)
  assert.deepEqual([...blob.archivos.keys()].sort(), [`voz/calcular-ar/${h}.json`, `voz/calcular-ar/${h}.mp3`])
  assert.equal(await cache.existe(h), true)
  const leido = await cache.leer(h)
  assert.deepEqual(leido?.entrada, entrada)
  assert.equal(leido?.audio.toString(), 'mp3')
})
