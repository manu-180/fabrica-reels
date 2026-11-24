// @ts-check
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acortarSilencios, bordesDeVoz, pcmAWav, unirTramos } from './audio.mjs'
import { palabrasDeCaracteres, palabrasRepartidas } from './tiempos.mjs'

const F = 1000

/** Silencio, tono y silencio, en segundos. @param {number} antes @param {number} voz @param {number} despues */
function tramo(antes, voz, despues) {
  const pcm = new Int16Array(Math.round((antes + voz + despues) * F))
  for (let k = Math.round(antes * F); k < Math.round((antes + voz) * F); k++) pcm[k] = k % 2 ? 8000 : -8000
  return pcm
}

test('bordesDeVoz encuentra la voz y deja aire', () => {
  const b = bordesDeVoz(tramo(0.3, 1, 0.5), null, F)
  assert.ok(Math.abs(b.vozIni - 0.3) < 0.011)
  assert.ok(Math.abs(b.vozFin - 1.3) < 0.011)
  assert.ok(Math.abs(b.inicio - 0.27) < 0.011)
  assert.ok(Math.abs(b.fin - 1.4) < 0.011)
})

test('unirTramos: de voz a voz se oye la pausa pedida y las palabras se corren', () => {
  const u = unirTramos([
    { pcm: tramo(0.2, 1, 0.3), palabras: [{ texto: 'uno', inicio: 0.2, fin: 1.2 }], pausa: 0.8 },
    { pcm: tramo(0.2, 0.5, 0.3), palabras: [{ texto: 'dos', inicio: 0.2, fin: 0.7 }], pausa: 0.5 },
  ], F)
  const [uno, dos] = u.palabras
  assert.ok(uno && dos)
  assert.ok(Math.abs(dos.inicio - uno.fin - 0.8) < 0.03, `pausa ${dos.inicio - uno.fin}`)
  const b = bordesDeVoz(u.pcm, null, F)
  assert.ok(Math.abs(b.vozIni - uno.inicio) < 0.02)
})

test('acortarSilencios deja los huecos internos en el máximo y corre las palabras', () => {
  const pcm = new Int16Array([...tramo(0, 0.5, 2), ...tramo(0, 0.5, 0.2)])
  const r = acortarSilencios({ pcm, palabras: [{ texto: 'a', inicio: 0, fin: 0.5 }, { texto: 'b', inicio: 2.5, fin: 3 }] }, 0.9, F)
  assert.ok(Math.abs(r.pcm.length / F - 2.1) < 0.02)
  assert.ok(Math.abs((r.palabras[1]?.inicio ?? 0) - 1.4) < 0.02)
})

test('pcmAWav arma una cabecera RIFF válida', () => {
  const w = pcmAWav(new Int16Array(10), 48000)
  assert.equal(w.toString('latin1', 0, 4), 'RIFF')
  assert.equal(w.readUInt32LE(24), 48000)
  assert.equal(w.readUInt32LE(40), 20)
})

test('palabrasDeCaracteres junta letras hasta el espacio', () => {
  const a = { characters: [...'Hola, vos.'], character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] }
  assert.deepEqual(palabrasDeCaracteres(a), [{ texto: 'Hola,', inicio: 0, fin: 0.5 }, { texto: 'vos.', inicio: 0.6, fin: 1 }])
})

test('palabrasRepartidas cubre la voz en orden', () => {
  const p = palabrasRepartidas('Hacé la cuenta gratis.', { vozIni: 0.2, vozFin: 1.8 })
  assert.equal(p.length, 4)
  assert.equal(p[0]?.inicio, 0.2)
  for (let i = 1; i < p.length; i++) assert.ok((p[i]?.inicio ?? 0) >= (p[i - 1]?.fin ?? 0))
  assert.ok((p.at(-1)?.fin ?? 0) <= 1.8)
})
