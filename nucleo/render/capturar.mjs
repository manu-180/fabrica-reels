// @ts-check
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* Capturas reales del sitio de una cuenta para el celular del cierre: cada página a 390x844 en 2x, con
   los campos cargados (cta/sitio/sitio.json), los montos en pesos difuminados y la zona del resultado
   medida. Sale de calcular (marketing/reels/scripts/prueba/assets/sitio/capturar.mjs).
     node nucleo/render/capturar.mjs --cuenta <id> [clave...]     (CHROME=<ruta> si no es el del sistema)
   Corre en la máquina de quien la usa, no en el pipeline: las capturas quedan commiteadas. */

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CANDIDATOS = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const CHROME = /** @type {string} */ (CANDIDATOS.find((c) => existsSync(String(c))) ?? 'chrome')
const PUERTO = 9333

const dormir = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms))

// Lo que corre adentro de la página: carga los campos como los carga una persona (React escucha
// el evento input del setter nativo), difumina todo monto en pesos y mide la zona del resultado.
const PREPARAR = String(function preparar(/** @type {any} */ e) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  for (const [sel, v] of Object.entries(e.campos || {})) {
    const el = document.querySelector(sel)
    if (!el) continue
    set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  for (const t of e.clics || []) {
    const b = [...document.querySelectorAll('button,label,[role=radio]')].find((x) => x.innerText && x.innerText.includes(t))
    if (b) b.click()
  }
  return true
})
const MEDIR = String(function medir(/** @type {any} */ e) {
  if (document.activeElement) document.activeElement.blur()
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el)
    if ((s.position === 'fixed' || s.position === 'sticky') && el.getBoundingClientRect().top > 300) el.style.visibility = 'hidden'
  }
  // Sólo el monto se difumina (no el párrafo entero): se envuelve cada coincidencia en su propio span.
  const plata = /\$\s?[1-9]|(?<!Ley\s\d*|N° \d*|[\d.])\d{1,3}(\.\d{3})+/
  const montos = /(?<!Ley\s\d*|N° \d*|[\d.])(?:[−-]?\+?\$\s?)?\d{1,3}(?:\.\d{3})+(?:,\d+)?|\$\s?[1-9][\d.,]*/g
  const nodos = []
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) if (plata.test(w.currentNode.textContent)) nodos.push(w.currentNode)
  for (const n of nodos) {
    const frag = document.createDocumentFragment()
    let ultimo = 0
    const t = n.textContent
    for (const m of t.matchAll(montos)) {
      frag.appendChild(document.createTextNode(t.slice(ultimo, m.index)))
      const s = document.createElement('span')
      s.textContent = m[0]
      s.style.filter = 'blur(7px)'
      s.style.display = 'inline-block'
      frag.appendChild(s)
      ultimo = m.index + m[0].length
    }
    frag.appendChild(document.createTextNode(t.slice(ultimo)))
    n.parentNode.replaceChild(frag, n)
  }
  for (const i of document.querySelectorAll('input')) if (plata.test(i.value) || plata.test(i.placeholder) || /^\d{5,}$/.test(i.value)) i.style.filter = 'blur(10px)'
  const area = (x) => { const r = x.getBoundingClientRect(); return r.width * r.height }
  const busca = (t) => [...document.querySelectorAll('body *')].filter((x) => x.innerText && x.innerText.trim().startsWith(t) && area(x) > 0).sort((p, q) => area(p) - area(q))[0]
  const ancla = e.ancla ? busca(e.ancla) : null
  window.scrollTo(0, ancla ? ancla.getBoundingClientRect().top + window.scrollY - (e.arriba || 80) : 0)
  if (!e.marca) return null
  const a = busca(e.marca)
  const b = e.marcaHasta ? busca(e.marcaHasta) : a
  if (!a || !b) return null
  const r1 = a.getBoundingClientRect()
  const r2 = b.getBoundingClientRect()
  const x = Math.min(r1.left, r2.left), y = Math.min(r1.top, r2.top)
  const d = 2
  return { x: Math.round(x * d), y: Math.round(y * d), w: Math.round((Math.max(r1.right, r2.right) - x) * d), h: Math.round((Math.max(r1.bottom, r2.bottom) - y) * d) }
})

async function cdp() {
  const lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json`)).json()
  const pag = lista.find((/** @type {any} */ p) => p.type === 'page')
  const ws = new WebSocket(pag.webSocketDebuggerUrl)
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }))
  let id = 0
  /** @type {Map<number, (v: any) => void>} */
  const pendientes = new Map()
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(String(m.data))
    if (d.id && pendientes.has(d.id)) { pendientes.get(d.id)?.(d); pendientes.delete(d.id) }
  })
  const enviar = (/** @type {string} */ method, params = {}) => new Promise((ok) => { id++; pendientes.set(id, ok); ws.send(JSON.stringify({ id, method, params })) })
  return { enviar, cerrar: () => ws.close() }
}

async function main() {
  const a = process.argv.slice(2)
  const i = a.indexOf('--cuenta')
  if (i < 0 || !a[i + 1]) throw new Error('uso: node nucleo/render/capturar.mjs --cuenta <id> [clave...]')
  const AQUI = join(RAIZ, 'cuentas', String(a[i + 1]), 'cta', 'sitio')
  const MAPA = join(AQUI, 'sitio.json')
  mkdirSync(AQUI, { recursive: true })
  const mapa = JSON.parse(readFileSync(MAPA, 'utf8'))
  if (!/^https:\/\/[a-z0-9.-]+$/.test(String(mapa.base))) throw new Error('sitio.json: base tiene que ser https://dominio, sin barra final')
  const pedidas = a.filter((_, k) => k !== i && k !== i + 1)
  const claves = pedidas.length ? pedidas : Object.keys(mapa.capturas)
  const perfil = mkdtempSync(join(tmpdir(), 'captura-'))
  const chrome = spawn(CHROME, ['--headless', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfil}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
  try {
    for (let k = 0; k < 40; k++) { try { await fetch(`http://127.0.0.1:${PUERTO}/json/version`); break } catch { await dormir(250) } }
    const { enviar, cerrar } = await cdp()
    await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    for (const clave of claves) {
      const e = mapa.capturas[clave]
      await enviar('Page.navigate', { url: `${mapa.base}${e.ruta}` })
      await dormir(4000)
      await enviar('Runtime.evaluate', { expression: `(${PREPARAR})(${JSON.stringify(e)})` })
      await dormir(1200)
      const r = /** @type {any} */ (await enviar('Runtime.evaluate', { expression: `(${MEDIR})(${JSON.stringify(e)})`, returnByValue: true }))
      await dormir(500)
      const foto = /** @type {any} */ (await enviar('Page.captureScreenshot', { format: 'jpeg', quality: 90 }))
      writeFileSync(join(AQUI, `${clave}.jpg`), Buffer.from(foto.result.data, 'base64'))
      e.resultado = r.result?.result?.value ?? null
      console.log(`${clave}: ${e.ruta} ${JSON.stringify(e.resultado)}`)
    }
    cerrar()
    writeFileSync(MAPA, JSON.stringify(mapa, null, 2) + '\n')
  } finally {
    chrome.kill()
    await dormir(500)
    rmSync(perfil, { recursive: true, force: true })
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
