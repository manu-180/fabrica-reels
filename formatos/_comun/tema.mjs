// @ts-check
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { derivar, rgba } from './color.mjs'

/**
 * @typedef {{ archivo: string, familia: string, peso: number }} Fuente
 * @typedef {{ clave: string, fondo: string, superficie: string, tinta: string, tenue: string, acento: string }} Paleta
 * @typedef {{
 *   idioma: 'es-AR' | 'en-US',
 *   paleta: Paleta,
 *   fuentes: { titulo: Fuente, cuerpo: Fuente, mono: Fuente },
 *   tracking_titulo: number,
 *   motivo: 'cuaderno' | 'grilla' | 'luz' | 'pizarra' | 'papel',
 *   logo: string,
 *   radio: number,
 *   contraste: { tinta_sobre_acento: string },
 * }} Tema
 */

export const MOTIVOS = /** @type {const} */ (['cuaderno', 'grilla', 'luz', 'pizarra', 'papel'])
const HEX = /^#[0-9a-fA-F]{6}$/
const CAMPOS = /** @type {const} */ (['fondo', 'superficie', 'tinta', 'tenue', 'acento'])

/**
 * `bricolage-grotesque-latin-800-normal.woff2` → { familia: 'Bricolage Grotesque', peso: 800 }.
 * También `Geist-800.woff2`. El peso es el primer número de tres cifras del nombre.
 * @param {string} archivo
 */
export function leerNombreFuente(archivo) {
  const base = basename(archivo).replace(/\.(woff2?|ttf|otf)$/i, '')
  const m = base.match(/^(.*?)[-_](?:latin[-_])?([1-9]00)(?:[-_].*)?$/i)
  if (!m) throw new Error(`no entiendo el peso de la fuente ${basename(archivo)}: se llama <familia>-<peso>.woff2`)
  const familia = String(m[1])
    .split(/[-_]+|(?<=[a-z])(?=[A-Z])/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
  return { familia, peso: Number(m[2]) }
}

/** @param {string} dir @param {string} rel */
function dentro(dir, rel) {
  if (typeof rel !== 'string' || !rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(`ruta de marca inválida: ${rel}`)
  return resolve(dir, rel)
}

/**
 * El tema de una ronda: la paleta elegida, las fuentes y el logo de la cuenta, y el motivo de fondo.
 * @param {{ cuenta: any, dirCuenta: string, paleta: string, motivo: string }} p
 * @returns {Tema}
 */
export function temaDe({ cuenta, dirCuenta, paleta, motivo }) {
  const m = cuenta?.marca
  if (!m) throw new Error('la cuenta no tiene marca')
  const paletas = JSON.parse(readFileSync(dentro(dirCuenta, m.paletas), 'utf8'))
  const base = paletas[paleta]
  if (!base) throw new Error(`paleta desconocida: ${paleta} (hay ${Object.keys(paletas).join(', ')})`)
  for (const c of CAMPOS) if (!HEX.test(String(base[c]))) throw new Error(`paleta ${paleta}.${c}: un hex de 6 cifras`)
  if (!MOTIVOS.includes(/** @type {any} */ (motivo))) throw new Error(`motivo desconocido: ${motivo}`)
  /** @param {'titulo' | 'cuerpo' | 'mono'} rol @returns {Fuente} */
  const fuente = (rol) => {
    const archivo = dentro(dirCuenta, m.fuentes?.[rol])
    if (!existsSync(archivo)) throw new Error(`no existe la fuente ${rol}: ${archivo}`)
    return { archivo, ...leerNombreFuente(archivo) }
  }
  const logo = dentro(dirCuenta, m.logo)
  if (!existsSync(logo)) throw new Error(`no existe el logo: ${logo}`)
  const pal = /** @type {Paleta} */ ({ clave: paleta, ...Object.fromEntries(CAMPOS.map((c) => [c, String(base[c]).toUpperCase()])) })
  return {
    idioma: cuenta.idioma,
    paleta: pal,
    fuentes: { titulo: fuente('titulo'), cuerpo: fuente('cuerpo'), mono: fuente('mono') },
    tracking_titulo: Number(m.tracking_titulo ?? -0.03),
    motivo: /** @type {Tema['motivo']} */ (motivo),
    logo,
    radio: Number(m.radio ?? 28),
    contraste: { tinta_sobre_acento: derivar(pal).sobreAcento },
  }
}

/**
 * Todas las caras de las familias del tema: las tres de la cuenta y sus hermanas de la misma
 * carpeta (`geist-sans-latin-500-normal.woff2` junto a la de 400). Así una plantilla puede pedir 600
 * y la cuenta decide si existe, sin cambiar la forma de `Fuente`.
 * @param {Tema} tema
 * @returns {{ archivo: string, familia: string, peso: number, nombre: string }[]}
 */
export function carasDe(tema) {
  /** @type {Map<string, { archivo: string, familia: string, peso: number, nombre: string }>} */
  const caras = new Map()
  for (const f of Object.values(tema.fuentes)) {
    const dir = dirname(f.archivo)
    const hermanas = existsSync(dir) ? readdirSync(dir).filter((x) => /\.(woff2?|ttf|otf)$/i.test(x)) : []
    for (const h of [basename(f.archivo), ...hermanas]) {
      let d
      try { d = leerNombreFuente(h) } catch { continue }
      if (d.familia !== f.familia) continue
      const clave = `${d.familia}|${d.peso}`
      if (!caras.has(clave)) caras.set(clave, { archivo: join(dir, h), familia: d.familia, peso: d.peso, nombre: h })
    }
  }
  return [...caras.values()].sort((a, b) => a.familia.localeCompare(b.familia) || a.peso - b.peso)
}

/** Ruta del logo dentro del proyecto. @param {Tema} tema */
export const rutaLogo = (tema) => `assets/marca/logo${extname(tema.logo).toLowerCase()}`

/** @param {string} s */
const cssTexto = (s) => `"${String(s).replace(/["\\]/g, '')}"`

/**
 * Las variables CSS del tema y sus `@font-face` (van inline en el `<style>`: el lint de HyperFrames
 * busca el @font-face en el mismo archivo). Además de las del contrato, deja las derivadas que usan
 * las plantillas: `--sobre-acento`, `--acento-texto`, `--resalte`, `--resalte-tinta`, `--linea`,
 * `--linea-fuerte`, `--sombra-1`, `--sombra-2`, `--luz`, `--vineta`, `--grano`, y los pesos
 * `--p-titulo`, `--p-cuerpo`, `--p-mono`.
 * @param {Tema} tema
 */
export function temaCss(tema) {
  const p = tema.paleta
  const d = derivar(p)
  const o = d.oscura
  const sans = (/** @type {Fuente} */ f) => `${cssTexto(f.familia)}, sans-serif`
  const vars = {
    '--fondo': p.fondo,
    '--superficie': p.superficie,
    '--tinta': p.tinta,
    '--tenue': p.tenue,
    '--acento': p.acento,
    '--sobre-acento': d.sobreAcento,
    '--acento-texto': d.acentoTexto,
    '--resalte': d.resalte.fondo,
    '--resalte-tinta': d.resalte.tinta,
    '--linea': rgba(p.tinta, o ? 0.07 : 0.08),
    '--linea-fuerte': rgba(p.tinta, o ? 0.16 : 0.18),
    '--sombra-1': o ? 'rgba(0,0,0,0.42)' : 'rgba(20,16,12,0.10)',
    '--sombra-2': o ? 'rgba(0,0,0,0.28)' : 'rgba(20,16,12,0.07)',
    '--luz': o ? 'rgba(255,255,255,0.075)' : 'rgba(255,255,255,0.62)',
    '--vineta': o ? 'rgba(0,0,0,0.55)' : 'rgba(60,44,28,0.16)',
    '--grano': o ? '0.5' : '0.42',
    '--f-titulo': sans(tema.fuentes.titulo),
    '--f-cuerpo': sans(tema.fuentes.cuerpo),
    '--f-mono': `${cssTexto(tema.fuentes.mono.familia)}, monospace`,
    '--p-titulo': String(tema.fuentes.titulo.peso),
    '--p-cuerpo': String(tema.fuentes.cuerpo.peso),
    '--p-mono': String(tema.fuentes.mono.peso),
    '--radio': `${tema.radio}px`,
    '--tracking-titulo': `${tema.tracking_titulo}em`,
  }
  const caras = carasDe(tema).map((c) => `@font-face { font-family: ${cssTexto(c.familia)}; src: url("assets/fuentes/${c.nombre}"); font-weight: ${c.peso}; font-display: block; }`)
  // Sin negrita sintética: si la cuenta no tiene la cara pedida, se usa la más cercana que sí tiene.
  return [`:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`, 'html { font-synthesis: none; }', ...caras].join('\n')
}

/**
 * Lo que el navegador tiene que cargar antes de medir texto, en la sintaxis de `document.fonts.load`.
 * @param {Tema} tema
 */
export function cargasDeFuentes(tema) {
  return carasDe(tema).map((c) => `${c.peso} 64px ${cssTexto(c.familia)}`)
}

/**
 * Copia fuentes (con sus hermanas) y logo a `salida/assets/`. Devuelve las rutas del proyecto.
 * @param {Tema} tema @param {string} salida
 */
export function copiarTema(tema, salida) {
  mkdirSync(join(salida, 'assets', 'fuentes'), { recursive: true })
  mkdirSync(join(salida, 'assets', 'marca'), { recursive: true })
  const fuentes = carasDe(tema).map((c) => {
    copyFileSync(c.archivo, join(salida, 'assets', 'fuentes', c.nombre))
    return `assets/fuentes/${c.nombre}`
  })
  const logo = rutaLogo(tema)
  copyFileSync(tema.logo, join(salida, logo))
  return { fuentes, logo }
}
