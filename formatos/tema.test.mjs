// @ts-check
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NEUTROS, contraste, derivar } from './_comun/color.mjs'
import { carasDe, leerNombreFuente, temaCss, temaDe } from './_comun/tema.mjs'
import { textos } from './_comun/textos.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..')
const FORMATOS = ['chat', 'mito', 'explicador', 'antes-despues', 'lista-de-errores', 'pregunta', 'comparador', 'cuenta-regresiva']
const TMP = mkdtempSync(join(tmpdir(), 'formatos-'))
after(() => rmSync(TMP, { recursive: true, force: true }))

/** Una cuenta inventada con colores y fuentes que ninguna marca usa. @param {string} id @param {'es-AR' | 'en-US'} idioma @param {Record<string, any>} paleta */
function cuentaFalsa(id, idioma, paleta) {
  const dir = join(TMP, id)
  mkdirSync(join(dir, 'marca', 'fuentes'), { recursive: true })
  const geist = join(RAIZ, 'cuentas', 'calcular-ar', 'marca', 'fuentes')
  copyFileSync(join(geist, 'geist-sans-latin-800-normal.woff2'), join(dir, 'marca', 'fuentes', 'zzimposible-titulo-800.woff2'))
  copyFileSync(join(geist, 'geist-sans-latin-400-normal.woff2'), join(dir, 'marca', 'fuentes', 'zzimposible-cuerpo-400.woff2'))
  copyFileSync(join(geist, 'geist-sans-latin-600-normal.woff2'), join(dir, 'marca', 'fuentes', 'zzimposible-cuerpo-600.woff2'))
  copyFileSync(join(geist, 'geist-mono-latin-500-normal.woff2'), join(dir, 'marca', 'fuentes', 'zzimposible-mono-500.woff2'))
  writeFileSync(join(dir, 'marca', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
  writeFileSync(join(dir, 'marca', 'paletas.json'), JSON.stringify({ unica: paleta }))
  const cuenta = {
    id, idioma,
    marca: {
      paletas: 'marca/paletas.json',
      fuentes: { titulo: 'marca/fuentes/zzimposible-titulo-800.woff2', cuerpo: 'marca/fuentes/zzimposible-cuerpo-400.woff2', mono: 'marca/fuentes/zzimposible-mono-500.woff2' },
      tracking_titulo: -0.03, motivos: ['cuaderno'], logo: 'marca/logo.svg', radio: 20, formatos: FORMATOS,
    },
  }
  return { cuenta, dir }
}

const A = cuentaFalsa('falsa-a', 'es-AR', { fondo: '#1D2B13', superficie: '#2A3B1E', tinta: '#F1E7D3', tenue: '#A39B8A', acento: '#E07A3F' })
const B = cuentaFalsa('falsa-b', 'en-US', { fondo: '#EDE4F7', superficie: '#FBF8FE', tinta: '#2B1638', tenue: '#7A6888', acento: '#2C6E9B' })
const FAMILIAS = ['Zzimposible Titulo', 'Zzimposible Cuerpo', 'Zzimposible Mono']

/** Un wav mudo de `s` segundos, sin ffmpeg. @param {string} ruta @param {number} s */
function wavMudo(ruta, s) {
  const n = Math.round(48000 * s) * 2
  const b = Buffer.alloc(44 + n)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n, 40)
  writeFileSync(ruta, b)
}

/** Tiempos sintéticos de hook + cuerpo, como los da `locutar`. @param {any} guion @param {number} hook */
function vozFalsa(guion, hook) {
  if (!guion.voz) return null
  let t = 0.05
  const palabras = []
  for (const [k, frase] of [guion.hooks[hook], guion.voz].entries()) {
    for (const w of String(frase).trim().split(/\s+/)) {
      const d = 0.16 + 0.03 * w.length
      palabras.push({ texto: w, inicio_s: Math.round(t * 1000) / 1000, fin_s: Math.round((t + d) * 1000) / 1000 })
      t += d + 0.06 + (/[.,;:?!]$/.test(w) ? 0.28 : 0)
    }
    if (k === 0) t += 0.6
  }
  const wav = join(TMP, `voz-${guion.clave}.wav`)
  if (!existsSync(wav)) wavMudo(wav, t + 0.5)
  return { wav, duracion_s: t + 0.5, palabras }
}

/** Los guiones de prueba de cada formato. @param {string} f */
const ejemplos = (f) => readdirSync(join(AQUI, f)).filter((x) => /^ejemplo.*\.json$/.test(x)).map((x) => JSON.parse(readFileSync(join(AQUI, f, x), 'utf8')))

/** Todo lo que el navegador lee de un proyecto armado: el index y los scripts propios. @param {string} dir */
function leerProyecto(dir) {
  const partes = [readFileSync(join(dir, 'index.html'), 'utf8'), readFileSync(join(dir, 'assets', 'datos.js'), 'utf8')]
  for (const x of readdirSync(join(dir, 'assets', 'comun'))) partes.push(readFileSync(join(dir, 'assets', 'comun', x), 'utf8'))
  return partes.join('\n')
}
const sinData = (/** @type {string} */ s) => s.replace(/url\("data:[^"]*"\)/g, '')
/** @param {string} s */
const hexes = (s) => new Set([...sinData(s).matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map((m) => m[0].toLowerCase()))

/** Arma todos los layouts de todos los ejemplos con un tema. @param {{ cuenta: any, dir: string }} c @param {string} etiqueta */
async function armarTodo(c, etiqueta) {
  const tema = temaDe({ cuenta: c.cuenta, dirCuenta: c.dir, paleta: 'unica', motivo: 'cuaderno' })
  /** @type {{ formato: string, layout: string, salida: string }[]} */
  const hechos = []
  for (const f of FORMATOS) {
    const m = await import(pathToFileURL(join(AQUI, f, 'armar.mjs')).href)
    for (const guion of ejemplos(f)) {
      for (const l of m.layouts) {
        if (!l.apto(guion)) continue
        const salida = join(TMP, etiqueta, `${f}-${guion.clave}-${l.id}`)
        await m.armar({ guion, hook: 0, voz: vozFalsa(guion, 0), salida, diseno: { ronda: 0, layout: l.id, paleta: 'unica', firma: null }, tema })
        hechos.push({ formato: f, layout: l.id, salida })
      }
    }
  }
  return { tema, hechos }
}

describe('tema', () => {
  test('leerNombreFuente entiende los nombres de fontsource y los cortos', () => {
    assert.deepEqual(leerNombreFuente('bricolage-grotesque-latin-800-normal.woff2'), { familia: 'Bricolage Grotesque', peso: 800 })
    assert.deepEqual(leerNombreFuente('Geist-400.woff2'), { familia: 'Geist', peso: 400 })
    assert.deepEqual(leerNombreFuente('GeistMono-500.woff2'), { familia: 'Geist Mono', peso: 500 })
    assert.throws(() => leerNombreFuente('sinpeso.woff2'))
  })

  test('temaDe arma el tema de cada cuenta real con todas sus paletas', () => {
    const ids = readdirSync(join(RAIZ, 'cuentas')).filter((x) => existsSync(join(RAIZ, 'cuentas', x, 'cuenta.json')))
    assert.ok(ids.length >= 1)
    for (const id of ids) {
      const dirCuenta = join(RAIZ, 'cuentas', id)
      const cuenta = JSON.parse(readFileSync(join(dirCuenta, 'cuenta.json'), 'utf8'))
      const paletas = JSON.parse(readFileSync(join(dirCuenta, cuenta.marca.paletas), 'utf8'))
      for (const clave of Object.keys(paletas)) {
        const tema = temaDe({ cuenta, dirCuenta, paleta: clave, motivo: cuenta.marca.motivos[0] })
        assert.equal(tema.paleta.clave, clave)
        assert.equal(tema.idioma, cuenta.idioma)
        for (const rol of /** @type {const} */ (['titulo', 'cuerpo', 'mono'])) assert.ok(existsSync(tema.fuentes[rol].archivo), `${id} ${rol}`)
        assert.ok(contraste(tema.contraste.tinta_sobre_acento, tema.paleta.acento) >= 3, `${id}/${clave}: tinta sobre acento`)
        const css = temaCss(tema)
        for (const v of ['--fondo', '--superficie', '--tinta', '--tenue', '--acento', '--f-titulo', '--f-cuerpo', '--f-mono', '--radio', '--tracking-titulo']) assert.match(css, new RegExp(`${v}:`), `${id}: ${v}`)
        assert.ok(carasDe(tema).length >= 3, `${id}: caras`)
      }
    }
  })

  test('temaDe rechaza rutas fuera de la cuenta, paletas y motivos desconocidos', () => {
    assert.throws(() => temaDe({ cuenta: A.cuenta, dirCuenta: A.dir, paleta: 'otra', motivo: 'cuaderno' }), /paleta desconocida/)
    assert.throws(() => temaDe({ cuenta: A.cuenta, dirCuenta: A.dir, paleta: 'unica', motivo: 'neon' }), /motivo desconocido/)
    const mala = { ...A.cuenta, marca: { ...A.cuenta.marca, logo: '../afuera.svg' } }
    assert.throws(() => temaDe({ cuenta: mala, dirCuenta: A.dir, paleta: 'unica', motivo: 'cuaderno' }), /ruta de marca/)
  })

  test('el resaltador del subtítulo siempre se lee (4,5:1 entre su fondo y su tinta)', () => {
    for (const p of [A, B]) {
      const t = temaDe({ cuenta: p.cuenta, dirCuenta: p.dir, paleta: 'unica', motivo: 'cuaderno' })
      const r = derivar(t.paleta).resalte
      assert.ok(contraste(r.fondo, r.tinta) >= 4.5)
    }
  })
})

describe('neutralidad de las plantillas', async () => {
  const a = await armarTodo(A, 'a')
  const b = await armarTodo(B, 'b')

  test('cada formato arma todos sus layouts con los dos temas', () => {
    for (const f of FORMATOS) assert.ok(a.hechos.some((h) => h.formato === f), f)
    assert.equal(a.hechos.length, b.hechos.length)
    assert.ok(a.hechos.length >= 8)
  })

  test('ningún color escrito en una plantilla: lo que no cambia con el tema es un neutro o contenido fijo declarado', async () => {
    const permitidos = new Set(Object.values(NEUTROS).map((x) => x.toLowerCase()))
    for (const [k, ha] of a.hechos.entries()) {
      const hb = /** @type {{ formato: string, salida: string }} */ (b.hechos[k])
      const m = await import(pathToFileURL(join(AQUI, ha.formato, 'armar.mjs')).href)
      const fijos = new Set((m.COLORES_FIJOS ?? []).map((/** @type {string} */ x) => x.toLowerCase()))
      const enA = hexes(leerProyecto(ha.salida))
      const enB = hexes(leerProyecto(hb.salida))
      const fijosEnAmbos = [...enA].filter((x) => enB.has(x) && !permitidos.has(x) && !fijos.has(x))
      assert.deepEqual(fijosEnAmbos, [], `${relative(TMP, ha.salida)}: colores que no salen del tema`)
    }
  })

  test('los colores fijos de contenido no son el color de ninguna cuenta', async () => {
    const deMarca = new Set()
    for (const id of readdirSync(join(RAIZ, 'cuentas'))) {
      const ruta = join(RAIZ, 'cuentas', id, 'marca', 'paletas.json')
      if (!existsSync(ruta)) continue
      for (const p of Object.values(JSON.parse(readFileSync(ruta, 'utf8')))) for (const c of Object.values(/** @type {any} */ (p))) deMarca.add(String(c).toLowerCase())
    }
    for (const f of FORMATOS) {
      const m = await import(pathToFileURL(join(AQUI, f, 'armar.mjs')).href)
      for (const c of m.COLORES_FIJOS ?? []) assert.ok(!deMarca.has(c.toLowerCase()), `${f}: ${c} es de una marca`)
    }
  })

  test('ninguna fuente escrita: toda font-family es una variable del tema, una familia del tema o genérica', () => {
    for (const h of [...a.hechos, ...b.hechos]) {
      const s = leerProyecto(h.salida)
      for (const m of s.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
        const v = String(m[1]).trim()
        const ok = /^var\(--f-(titulo|cuerpo|mono)\)/.test(v) || /^(inherit|sans-serif|monospace)$/.test(v) || FAMILIAS.some((f) => v.includes(f))
        assert.ok(ok, `${relative(TMP, h.salida)}: font-family ${v}`)
      }
      for (const m of s.matchAll(/fonts\.load\(\s*['"]([^'"]+)['"]/g)) assert.ok(FAMILIAS.some((f) => String(m[1]).includes(f)), `${relative(TMP, h.salida)}: carga ${m[1]}`)
    }
  })

  test('el idioma manda los rótulos: en inglés no queda castellano de las plantillas', () => {
    const es = textos('es-AR')
    const propios = [es.chat.en_linea, es.chat.mensaje, es.mito.se_cree, es.mito.es, es.antes_despues.bienvenida, es.antes_despues.error_ok, es.explicador.celular]
    for (const h of b.hechos) {
      const s = leerProyecto(h.salida)
      for (const t of propios) assert.ok(!s.includes(`"${t}"`) && !s.includes(`>${t}<`), `${relative(TMP, h.salida)}: "${t}"`)
    }
    const chat = b.hechos.find((h) => h.formato === 'chat')
    assert.ok(chat && readFileSync(join(chat.salida, 'index.html'), 'utf8').includes('>Message<'))
  })
})

describe('fuentes de las plantillas', () => {
  /** @returns {string[]} */
  const archivos = (/** @type {string} */ dir) => readdirSync(dir).flatMap((x) => {
    const r = join(dir, x)
    if (statSync(r).isDirectory()) return ['fotos', 'sfx', 'vendor'].includes(x) ? [] : archivos(r)
    return /\.(html|js|mjs)$/.test(x) && !x.endsWith('.test.mjs') ? [r] : []
  })
  const fuentes = archivos(AQUI)

  test('ninguna marca, dominio ni fuente de marca escritos en el código de los formatos', () => {
    const prohibidas = /calcular|apex|assistify|insights|bricolage|\bgeist\b|oxanium|\binter\b|hac[eé] la cuenta|coment[aá] web/i
    for (const f of fuentes) {
      const s = readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
      const m = s.match(prohibidas)
      assert.equal(m, null, `${relative(AQUI, f)}: "${m?.[0]}"`)
    }
  })

  test('las plantillas no tienen texto visible propio: todo pasa por {{t:...}} o los datos', () => {
    for (const f of fuentes.filter((x) => x.endsWith('.html'))) {
      const s = readFileSync(f, 'utf8')
      const cuerpo = s.slice(s.indexOf('<body'))
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\{\{[^}]+\}\}/g, ' ')
      const resto = cuerpo.replace(/[\s|×“”·…]+/g, '')
      assert.equal(resto, '', `${relative(AQUI, f)}: texto en duro "${resto.slice(0, 40)}"`)
      for (const m of s.matchAll(/(?:textContent|innerText)\s*=\s*(["'])((?:(?!\1).)*)\1/g)) {
        assert.ok(!/\p{L}{2,}/u.test(String(m[2])), `${relative(AQUI, f)}: textContent en duro "${m[2]}"`)
      }
    }
  })

  test('los diccionarios de los dos idiomas tienen las mismas claves', () => {
    /** @param {any} o @param {string} p @returns {string[]} */
    const claves = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? claves(v, `${p}${k}.`) : [`${p}${k}`]))
    assert.deepEqual(claves(textos('es-AR')).sort(), claves(textos('en-US')).sort())
  })
})
