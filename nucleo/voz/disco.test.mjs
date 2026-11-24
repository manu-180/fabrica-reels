import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { blobEnDisco } from './disco.mjs'

test('blobEnDisco: guarda y lee con las rutas del Blob, persiste entre instancias y no sale de su carpeta', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voz-local-'))
  const a = blobEnDisco(dir)
  assert.equal(await a.head('voz/prueba-ar/abc.mp3'), null)
  await a.put('voz/prueba-ar/abc.mp3', Buffer.from('audio'), { contentType: 'audio/mpeg' })
  await a.put('voz/prueba-ar/abc.json', '{"x":1}', { contentType: 'application/json' })
  const b = blobEnDisco(dir)
  assert.ok(await b.head('voz/prueba-ar/abc.mp3'))
  assert.equal(String(await b.get('voz/prueba-ar/abc.json')), '{"x":1}')
  await assert.rejects(() => b.get('../afuera.mp3'), /fuera/)
})
