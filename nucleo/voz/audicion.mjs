// @ts-check
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { leerSuscripcion } from './eleven.mjs'
import { blobEnMemoria, locutar } from './index.mjs'
import { planDeFrases } from './texto.mjs'

const USO = `node nucleo/voz/audicion.mjs --cuenta <cuentas/<id>/cuenta.json> --voces id1,id2 --hook "..." --cuerpo "..." --salida <dir> [--pagar]
Sin --pagar sólo dice cuántos caracteres costaría (no llama a ElevenLabs).`

/**
 * El mismo guion con cada voz candidata y los ajustes de la cuenta, para elegir oyendo.
 * @param {string[]} argv
 */
export async function audicion(argv, { env = process.env, fetch: f = fetch, log = console.log } = {}) {
  const { values: a } = parseArgs({ args: argv, options: { cuenta: { type: 'string' }, voces: { type: 'string' }, hook: { type: 'string' }, cuerpo: { type: 'string' }, salida: { type: 'string' }, pagar: { type: 'boolean' } } })
  if (!a.cuenta || !a.voces || !a.hook || !a.salida) throw new Error(USO)
  const cuenta = JSON.parse(readFileSync(a.cuenta, 'utf8'))
  const voces = a.voces.split(',').map((x) => x.trim()).filter(Boolean)
  const porVoz = planDeFrases({ hook: a.hook, cuerpo: a.cuerpo ?? null, pausas: cuenta.voz.pausas }).reduce((s, fr) => s + fr.texto.length, 0)
  const total = porVoz * voces.length
  const clave = env.ELEVENLABS_API_KEY?.trim()
  const sub = clave ? await leerSuscripcion({ clave, fetch: f }) : null
  log(`${voces.length} voces × ${porVoz} caracteres = ${total}; quedan en el ciclo: ${sub ? sub.quedan : 'no se pudo leer'}`)
  if (!a.pagar) return { total, quedan: sub?.quedan ?? null, salidas: [] }
  if (sub && total > sub.quedan) throw new Error(`no alcanza: hacen falta ${total} y quedan ${sub.quedan}`)
  mkdirSync(a.salida, { recursive: true })
  const salidas = []
  for (const voice_id of voces) {
    const dir = join(a.salida, voice_id)
    mkdirSync(dir, { recursive: true })
    const r = await locutar({ cuenta: { ...cuenta, voz: { ...cuenta.voz, voice_id } }, hook: a.hook, cuerpo: a.cuerpo ?? null, env, fetch: f, blob: blobEnMemoria(), dir, quedan: null, respaldo: false, log })
    log(`${voice_id}: ${r.wav} (${r.duracion_s} s, ${Math.round((r.palabras.length / r.duracion_s) * 60)} ppm)`)
    salidas.push({ voice_id, ...r })
  }
  return { total, quedan: sub?.quedan ?? null, salidas }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  audicion(process.argv.slice(2)).catch((e) => {
    console.error(String(e.message ?? e))
    process.exit(1)
  })
}
