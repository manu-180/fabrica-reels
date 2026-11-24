// @ts-check
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sintetizarGemini } from './gemini.mjs'

const audio = { candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from(new Int16Array(240).buffer).toString('base64') } }] }, finishReason: 'STOP' }] }
const sinAudio = { candidates: [{ content: { parts: [{ text: 'no' }] }, finishReason: 'OTHER' }] }
/** @param {any[]} respuestas */
const falso = (respuestas) => {
  const pedidos = []
  const f = /** @type {typeof fetch} */ (async (url) => {
    pedidos.push(String(url))
    return new Response(JSON.stringify(respuestas.shift()), { status: 200 })
  })
  return { f, pedidos }
}
const base = { texto: 'Hola', voz: 'Kore', estilo: 'cálido', clave: 'k', espera: async () => {} }

test('sintetizarGemini reintenta cuando responde 200 sin audio', async () => {
  const { f, pedidos } = falso([sinAudio, sinAudio, audio])
  const wav = await sintetizarGemini({ ...base, fetch: f })
  assert.ok(wav.length > 44)
  assert.equal(pedidos.length, 3)
})

test('sintetizarGemini sin audio en ningún intento falla con el motivo', async () => {
  const { f } = falso(Array(8).fill(sinAudio))
  await assert.rejects(sintetizarGemini({ ...base, fetch: f, modelos: ['m'] }), /no devolvió audio \(m, OTHER\)/)
})
