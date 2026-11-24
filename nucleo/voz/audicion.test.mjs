// @ts-check
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { audicion } from './audicion.mjs'

const DIR = mkdtempSync(join(tmpdir(), 'audicion-'))
after(() => rmSync(DIR, { recursive: true, force: true }))

test('sin --pagar sólo estima y no sintetiza', async () => {
  const cuenta = join(DIR, 'cuenta.json')
  writeFileSync(cuenta, JSON.stringify({ id: 'x', voz: { pausas: { tras_hook: 0.85, entre: 0.8, antes_cta: 0.9, coma: 0.25 } } }))
  /** @type {string[]} */
  const urls = []
  /** @type {typeof fetch} */
  const f = async (u) => (urls.push(String(u)), Response.json({ character_count: 10, character_limit: 100 }))
  const r = await audicion(['--cuenta', cuenta, '--voces', 'a,b', '--hook', 'Un hook de prueba.', '--cuerpo', 'Un cuerpo de prueba corto.', '--salida', DIR], { env: { ELEVENLABS_API_KEY: 'k' }, fetch: f, log: () => {} })
  assert.equal(r.total, 2 * ('Un hook de prueba.'.length + 'Un cuerpo de prueba corto.'.length))
  assert.equal(r.quedan, 90)
  assert.deepEqual(urls.map((u) => u.replace(/^https:\/\/[^/]+/, '')), ['/v1/user/subscription'])
})
