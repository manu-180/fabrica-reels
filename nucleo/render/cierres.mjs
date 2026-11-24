// @ts-check
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { entornoSinSecretos } from '../entorno.mjs'
import { leerConfigCierre, renderizarCierre } from './cierre.mjs'
import { sondear } from './medios.mjs'

/*
  Los clips de cierre de una cuenta (`cuentas/<id>/cta/clips.json`), uno por paleta × estilo × destino,
  desde su `cta/cierre.json`. Corre a mano, no en el pipeline: los clips quedan commiteados.
    node nucleo/render/cierres.mjs --cuenta <id> [--destino reel|historia] [--paleta p] [--estilo e]
  La voz del cierre se graba una sola vez (pasa por la caché de nucleo/voz) y queda en cta/:
    node nucleo/render/cierres.mjs --cuenta <id> --voz [--historia] [--proveedor gemini|elevenlabs]
*/

const AQUI = fileURLToPath(new URL('.', import.meta.url))
const RAIZ = resolve(AQUI, '..', '..')
const TOPE_BYTES = 2 * 1024 * 1024

/** Id y archivo de un clip. @param {'reel' | 'historia'} destino @param {string} paleta @param {string} estilo */
export const idClip = (destino, paleta, estilo) => (destino === 'reel' ? `${paleta}-${estilo}` : `historia-${paleta}-${estilo}`)

/**
 * Suma o reemplaza filas de clips.json por id, en un orden estable (destino, paleta, estilo).
 * @param {any[]} lista @param {any[]} nuevas @param {string[]} paletas
 */
export function fusionarClips(lista, nuevas, paletas) {
  const porId = new Map(lista.map((c) => [c.id, c]))
  for (const n of nuevas) porId.set(n.id, n)
  const orden = (/** @type {any} */ c) => [c.destino === 'reel' ? 0 : 1, paletas.indexOf(c.paleta), c.estilo]
  return [...porId.values()].sort((a, b) => {
    const [x, y] = [orden(a), orden(b)]
    return x[0] - y[0] || x[1] - y[1] || String(x[2]).localeCompare(String(y[2]))
  })
}

/** @param {string} n */
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function grabarVoz() {
  const id = /** @type {string} */ (arg('cuenta'))
  const dirCuenta = join(RAIZ, 'cuentas', id)
  const cuenta = JSON.parse(readFileSync(join(dirCuenta, 'cuenta.json'), 'utf8'))
  const historia = process.argv.includes('--historia')
  const texto = historia ? cuenta.cierre.texto_historia : cuenta.cierre.texto_voz
  if (!texto) throw new Error(`la cuenta no tiene ${historia ? 'texto_historia' : 'texto_voz'}`)
  const proveedor = arg('proveedor') ?? cuenta.voz.proveedor
  const voz = await import(pathToFileURL(join(RAIZ, 'nucleo', 'voz', 'index.mjs')).href)
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  const blob = token ? await voz.blobVercel({ token }) : voz.blobEnMemoria()
  const c = proveedor === 'gemini' ? { ...cuenta, voz: { ...cuenta.voz, proveedor: 'gemini' } } : cuenta
  const dirCta = join(dirCuenta, 'cta')
  mkdirSync(dirCta, { recursive: true })
  const r = await voz.locutar({ cuenta: c, hook: texto, cuerpo: null, blob, dir: dirCta, respaldo: false, log: (/** @type {string} */ m) => console.error(`[voz] ${m}`) })
  const nombre = historia ? 'voz-historia' : 'voz'
  copyFileSync(r.wav, join(dirCta, `${nombre}.wav`))
  if (resolve(r.wav) !== resolve(join(dirCta, `${nombre}.wav`))) rmSync(r.wav, { force: true })
  const voice = r.proveedor === 'gemini' ? `gemini:${cuenta.voz.respaldo?.voz}` : cuenta.voz.voice_id
  writeFileSync(join(dirCta, `${nombre}-palabras.json`), JSON.stringify({ texto, voz: voice, proveedor: r.proveedor, palabras: r.palabras }, null, 2) + '\n')
  console.error(`[voz] ${nombre}.wav: ${r.duracion_s} s, ${r.proveedor}, ${r.caracteres_pagados} pagados, ${r.caracteres_cache} de caché`)
}

async function renderizarTodos() {
  const id = /** @type {string} */ (arg('cuenta'))
  const dirCuenta = join(RAIZ, 'cuentas', id)
  const dirCta = join(dirCuenta, 'cta')
  const cuenta = JSON.parse(readFileSync(join(dirCuenta, 'cuenta.json'), 'utf8'))
  const config = leerConfigCierre(dirCta)
  if (!config) throw new Error(`no existe cuentas/${id}/cta/cierre.json`)
  const paletas = Object.keys(JSON.parse(readFileSync(join(dirCuenta, cuenta.marca.paletas), 'utf8')))
  const env = entornoSinSecretos(process.env, cuenta)
  const rutaLista = join(dirCta, 'clips.json')
  /** @type {any[]} */
  let lista = existsSync(rutaLista) ? JSON.parse(readFileSync(rutaLista, 'utf8')) : []
  const destinos = /** @type {('reel' | 'historia')[]} */ ((arg('destino') ? [arg('destino')] : ['reel', 'historia']).filter((d) => config[/** @type {'reel' | 'historia'} */ (d)]))
  for (const destino of destinos) {
    const d = /** @type {import('./cierre.mjs').Destino} */ (config[destino])
    for (const paleta of arg('paleta') ? [/** @type {string} */ (arg('paleta'))] : paletas) {
      for (const estilo of arg('estilo') ? [/** @type {string} */ (arg('estilo'))] : d.estilos) {
        const cid = idClip(destino, paleta, estilo)
        const t0 = Date.now()
        const salida = join(dirCta, 'clips', `${cid}.mp4`)
        const r = await renderizarCierre({ dirCuenta, cuenta, paleta, estilo, destino: d, pagina: null, salida, env, raiz: RAIZ, topeBytes: TOPE_BYTES, log: (m) => console.error(`[cierre] ${m}`) })
        const s = await sondear(salida, env)
        if (s.bytes >= TOPE_BYTES) console.error(`[cierre] ${cid} pesa ${Math.round(s.bytes / 1024)} KB (más de 2 MB)`)
        lista = fusionarClips(lista, [{ id: cid, paleta, estilo, destino, archivo: `clips/${cid}.mp4`, duracion_s: Math.round(r.duracion_s * 100) / 100 }], paletas)
        writeFileSync(rutaLista, JSON.stringify(lista, null, 2) + '\n')
        console.error(`[cierre] ${cid}: ${Math.round(s.bytes / 1024)} KB en ${Math.round((Date.now() - t0) / 1000)} s`)
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!arg('cuenta')) {
    console.error('uso: node nucleo/render/cierres.mjs --cuenta <id> [--destino reel|historia] [--paleta p] [--estilo e] | --cuenta <id> --voz [--historia] [--proveedor gemini|elevenlabs]')
    process.exit(2)
  }
  ;(process.argv.includes('--voz') ? grabarVoz() : renderizarTodos()).catch((e) => {
    console.error(`[cierres] ${e?.stack ?? e}`)
    process.exit(1)
  })
}
