import assert from 'node:assert/strict'
import { test } from 'node:test'
import { limpiarBlobs } from './limpiar.mjs'

test('limpiarBlobs borra sólo videos de más de 21 días, paginando, y nunca el caché de voz', async () => {
  const ahora = new Date('2026-11-23T12:00:00Z')
  const paginas = [
    { blobs: [{ url: 'u1', uploadedAt: '2026-10-20T00:00:00Z' }, { url: 'u2', uploadedAt: '2026-11-22T00:00:00Z' }], hasMore: true, cursor: 'c' },
    { blobs: [{ url: 'u3', uploadedAt: '2026-11-01T00:00:00Z' }], hasMore: false },
  ]
  /** @type {any[]} */
  const pedidos = []
  /** @type {string[]} */
  const borrados = []
  const n = await limpiarBlobs({ ahora, token: 't', listar: async (/** @type {any} */ o) => (pedidos.push(o), paginas.shift()), borrar: async (/** @type {string[]} */ urls) => borrados.push(...urls) })
  assert.equal(n, 2)
  assert.deepEqual(borrados, ['u1', 'u3'])
  assert.deepEqual(pedidos.map((p) => [p.prefix, p.cursor]), [['videos/', undefined], ['videos/', 'c']])
  await assert.rejects(() => limpiarBlobs({ ahora, token: 't', prefijo: 'voz/', listar: async () => ({ blobs: [] }), borrar: async () => {} }), /videos/)
})
