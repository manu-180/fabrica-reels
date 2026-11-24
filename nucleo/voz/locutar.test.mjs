// @ts-check
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { FRECUENCIA } from './audio.mjs'
import { SinPresupuesto, blobEnMemoria, costoVoz, locutar } from './index.mjs'

const DIR = mkdtempSync(join(tmpdir(), 'voz-test-'))
after(() => rmSync(DIR, { recursive: true, force: true }))

const CUENTA = {
  id: 'calcular-ar',
  voz: {
    proveedor: 'elevenlabs', modelo: 'eleven_multilingual_v2', voice_id: 'voz-prueba',
    ajustes: { stability: 0.45, similarity_boost: 0.8, style: 0.3 },
    pausas: { tras_hook: 0.85, entre: 0.8, antes_cta: 0.9, coma: 0.25 },
    respaldo: { proveedor: 'gemini', voz: 'Kore', estilo: 'rioplatense cálido' },
    presupuesto_mes: 30000,
  },
}
const HOOK = 'Nadie te cuenta esto del aguinaldo.'
const CUERPO = 'Se calcula con el mejor sueldo del semestre. Hacé la cuenta con tus números.'

/** El "audio" de los dobles es la duración en texto; decodificar lo vuelve un tono con 0,1 s de aire a cada lado. */
async function decodificar(/** @type {Buffer} */ audio) {
  const dur = Number(audio.toString('utf8').replace(/^\D+/, ''))
  const pcm = new Int16Array(Math.round((dur + 0.2) * FRECUENCIA))
  for (let k = Math.round(0.1 * FRECUENCIA); k < Math.round((0.1 + dur) * FRECUENCIA); k++) pcm[k] = k % 2 ? 9000 : -9000
  return pcm
}

/** Alineación por carácter repartida en la voz del doble. @param {string} texto @param {number} dur */
function alineacion(texto, dur) {
  const letras = [...texto]
  const paso = dur / letras.length
  return {
    characters: letras,
    character_start_times_seconds: letras.map((_, i) => 0.1 + i * paso),
    character_end_times_seconds: letras.map((_, i) => 0.1 + (i + 1) * paso),
  }
}

/** @param {{ quedan?: number, tts?: (texto: string) => Response | null }} [o] */
function redDoble({ quedan = 50_000, tts } = {}) {
  /** @type {{ url: string, cuerpo: any }[]} */
  const llamadas = []
  /** @type {typeof fetch} */
  const f = async (url, init) => {
    const u = String(url)
    const cuerpo = init?.body ? JSON.parse(String(init.body)) : null
    llamadas.push({ url: u, cuerpo })
    if (u.endsWith('/v1/user/subscription')) return Response.json({ tier: 'starter', character_count: 100_000 - quedan, character_limit: 100_000, next_character_count_reset_unix: 1795834800 })
    if (u.includes('/v1/text-to-speech/')) {
      const propia = tts?.(cuerpo.text)
      if (propia) return propia
      const dur = Math.round(cuerpo.text.length * 0.05 * 1000) / 1000
      return Response.json({ audio_base64: Buffer.from(`dur${dur}`).toString('base64'), alignment: alineacion(cuerpo.text, dur) })
    }
    if (u.includes('generativelanguage')) {
      const texto = cuerpo.contents[0].parts[0].text.split('\n').pop()
      const pcm = await decodificar(Buffer.from(`dur${texto.length * 0.05}`))
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from(pcm.buffer).toString('base64') } }] } }] })
    }
    return new Response('no', { status: 404 })
  }
  return { f, llamadas, tts: () => llamadas.filter((l) => l.url.includes('/v1/text-to-speech/')), subs: () => llamadas.filter((l) => l.url.endsWith('/subscription')) }
}

const ENV = { ELEVENLABS_API_KEY: 'k', GEMINI_API_KEY: 'g' }
/** Gemini devuelve PCM crudo de 24 kHz envuelto en WAV: el doble de decodificar no lo entiende, así que se reconoce por la cabecera. */
async function decodificarTodo(/** @type {Buffer} */ a) {
  if (a.toString('latin1', 0, 4) === 'RIFF') return decodificar(Buffer.from(`dur${(a.length - 44) / 2 / 24000}`))
  return decodificar(a)
}
const base = { cuenta: CUENTA, hook: HOOK, cuerpo: CUERPO, env: ENV, dir: DIR, decodificar: decodificarTodo, espera: async () => {}, reloj: () => new Date('2026-11-23T12:00:00Z') }

test('la segunda corrida del mismo guion no llama a ElevenLabs ni a la suscripción', async () => {
  const blob = blobEnMemoria()
  const red = redDoble()
  const total = [HOOK, 'Se calcula con el mejor sueldo del semestre.', 'Hacé la cuenta con tus números.'].reduce((a, t) => a + t.length, 0)
  const uno = await locutar({ ...base, blob, fetch: red.f })
  assert.equal(red.tts().length, 3)
  assert.equal(red.subs().length, 1)
  assert.equal(uno.proveedor, 'elevenlabs')
  assert.equal(uno.caracteres_pagados, total)
  assert.equal(uno.caracteres_cache, 0)
  assert.equal(uno.respaldo, null)

  const red2 = redDoble()
  const dos = await locutar({ ...base, blob, fetch: red2.f })
  assert.equal(red2.llamadas.length, 0)
  assert.equal(dos.caracteres_pagados, 0)
  assert.equal(dos.caracteres_cache, total)
  assert.deepEqual(dos.palabras, uno.palabras)
  assert.equal(dos.duracion_s, uno.duracion_s)
  assert.ok([...blob.archivos.keys()].every((k) => k.startsWith('voz/calcular-ar/')))
})

test('el pedido a ElevenLabs lleva voz, modelo, ajustes y el contexto de las frases vecinas', async () => {
  const red = redDoble()
  await locutar({ ...base, blob: blobEnMemoria(), fetch: red.f })
  const [hook, primera] = red.tts()
  assert.ok(hook && primera)
  assert.match(hook.url, /\/v1\/text-to-speech\/voz-prueba\/with-timestamps/)
  assert.equal(hook.cuerpo.model_id, 'eleven_multilingual_v2')
  assert.deepEqual(hook.cuerpo.voice_settings, CUENTA.voz.ajustes)
  assert.equal(hook.cuerpo.next_text, 'Se calcula con el mejor sueldo del semestre. Hacé la cuenta con tus números.')
  assert.equal(primera.cuerpo.previous_text, undefined)
})

test('otra variante con el mismo cuerpo paga sólo su hook', async () => {
  const blob = blobEnMemoria()
  await locutar({ ...base, blob, fetch: redDoble().f })
  const red = redDoble()
  const otro = 'Esto del aguinaldo casi nadie lo sabe.'
  const r = await locutar({ ...base, hook: otro, blob, fetch: red.f })
  assert.deepEqual(red.tts().map((l) => l.cuerpo.text), [otro])
  assert.equal(r.caracteres_pagados, otro.length)
})

test('entre el hook y el cuerpo se oyen 0,85 s y las palabras incluyen el hook primero', async () => {
  const r = await locutar({ ...base, blob: blobEnMemoria(), fetch: redDoble().f })
  assert.equal(r.palabras[0]?.texto, 'Nadie')
  const fin = r.palabras.find((p) => p.texto === 'aguinaldo.')
  const sig = r.palabras.find((p) => p.texto === 'Se')
  assert.ok(fin && sig)
  assert.ok(Math.abs(sig.inicio_s - fin.fin_s - 0.85) < 0.04, `pausa ${sig.inicio_s - fin.fin_s}`)
  const wav = readFileSync(r.wav)
  assert.equal(wav.toString('latin1', 0, 4), 'RIFF')
  assert.ok(Math.abs((wav.length - 44) / 2 / FRECUENCIA - r.duracion_s) < 0.002)
})

test('si lo que falta no entra en lo que queda, sale con Gemini y queda anotado', async () => {
  const red = redDoble({ quedan: 20 })
  const logs = /** @type {string[]} */ ([])
  const r = await locutar({ ...base, blob: blobEnMemoria(), fetch: red.f, log: (m) => logs.push(m) })
  assert.equal(red.tts().length, 0)
  assert.equal(r.proveedor, 'gemini')
  assert.match(String(r.respaldo), /no alcanza: faltan \d+ caracteres y quedan 20/)
  assert.equal(r.caracteres_pagados, 0)
  assert.ok(r.caracteres_respaldo > 0)
  assert.equal(r.tiempos, 'repartidos')
  assert.equal(logs.length, 1)
})

test('quedan pasado por parámetro evita leer la suscripción', async () => {
  const red = redDoble()
  await locutar({ ...base, blob: blobEnMemoria(), fetch: red.f, quedan: 10_000 })
  assert.equal(red.subs().length, 0)
})

test('sin respaldo permitido y sin presupuesto: SinPresupuesto, sin gastar nada', async () => {
  const red = redDoble({ quedan: 5 })
  await assert.rejects(locutar({ ...base, blob: blobEnMemoria(), fetch: red.f, respaldo: false }), SinPresupuesto)
  assert.equal(red.tts().length, 0)
})

test('ElevenLabs sin crédito a mitad de camino: lo pagado queda en caché y toda la voz sale con Gemini', async () => {
  const blob = blobEnMemoria()
  let n = 0
  const red = redDoble({ tts: () => (++n === 2 ? Response.json({ detail: { status: 'quota_exceeded' } }, { status: 401 }) : null) })
  const r = await locutar({ ...base, blob, fetch: red.f })
  assert.equal(r.proveedor, 'gemini')
  assert.match(String(r.respaldo), /ElevenLabs HTTP 401 quota_exceeded/)
  assert.equal(r.caracteres_pagados, HOOK.length)
  const costo = await costoVoz({ cuenta: CUENTA, hook: HOOK, cuerpo: CUERPO, blob })
  assert.equal(costo.cacheados, HOOK.length)
})

test('un error de ElevenLabs que no es de crédito no cae al respaldo', async () => {
  const red = redDoble({ tts: () => new Response('mal', { status: 400 }) })
  await assert.rejects(locutar({ ...base, blob: blobEnMemoria(), fetch: red.f }), /ElevenLabs HTTP 400/)
})

test('costoVoz cuenta sólo lo que falta en la caché, sin red', async () => {
  const blob = blobEnMemoria()
  const antes = await costoVoz({ cuenta: CUENTA, hook: HOOK, cuerpo: CUERPO, blob })
  assert.equal(antes.faltan, antes.total)
  await locutar({ ...base, blob, fetch: redDoble().f })
  const despues = await costoVoz({ cuenta: CUENTA, hook: HOOK, cuerpo: CUERPO, blob })
  assert.equal(despues.faltan, 0)
  assert.equal(despues.cacheados, antes.total)
})
