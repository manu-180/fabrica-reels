// @ts-check
import { azar } from './tiempo.mjs'

/**
 * La firma de diseño de cada variante (diseño § 5.3): determinista por cuenta|guion|ronda|variante.
 * @typedef {import('./estado.mjs').Firma} Firma
 * @typedef {import('./estado.mjs').EstadoV2} EstadoV2
 * @typedef {{ id: string, paleta: string, estilo: string, destino: 'reel' | 'historia' }} ClipCierre
 * @typedef {{ paletas: string[], musicas: string[], clips: ClipCierre[] }} Opciones
 * @typedef {{ tema: string | null, fecha: string, slot: number, firmas: Firma[] }} Previo
 */

export const EJES = {
  color: ['neutro', 'calido', 'frio', 'contraste', 'mate'],
  textura: ['nada', 'grano', 'vineta'],
}
export const COMPARADOS = /** @type {const} */ (['formato', 'layout', 'motivo', 'paleta', 'hook', 'musica', 'cierre', 'color', 'textura'])
const RECIENTES = 3
const DISTANCIA_RECIENTES = 2
const DISTANCIA_HERMANAS = 3
const MUESTRAS = 400

/** En cuántos ejes difieren dos firmas. @param {Firma} a @param {Firma} b */
export const distancia = (a, b) => COMPARADOS.filter((k) => a[k] !== b[k]).length

/**
 * Lo que ya salió en la cuenta, un elemento por creativo producido (de más viejo a más nuevo), sin
 * `excluir` (el creativo que se está armando).
 * @param {EstadoV2} estado @param {string | null} [excluir] @returns {Previo[]}
 */
export function historialDeFirmas(estado, excluir = null) {
  return Object.values(estado.creativos)
    .filter((c) => c.producido_at && c.id !== excluir)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.slot ?? 0) - (b.slot ?? 0))
    .map((c) => ({ tema: c.tema ?? c.categoria ?? null, fecha: c.fecha, slot: c.slot ?? 0, firmas: (c.variantes ?? []).map((v) => v.firma).filter(Boolean) }))
}

/** El hook de la variante `indice` en la ronda: `(ronda·V + indice) % 3`. @param {number} ronda @param {number} indice @param {number} variantes */
export const hookDe = (ronda, indice, variantes) => (ronda * variantes + indice) % 3

/**
 * @param {{ cuenta: import('./cuenta.mjs').Cuenta, guion: any, ronda: number, indice: number, historial: Previo[], formato: { layouts?: { id: string, apto: (g: any) => boolean }[] },
 *   opciones: Opciones, hermanas?: Firma[], variantes?: number, tema?: string | null }} p
 * @returns {Firma}
 */
export function firmaPara({ cuenta, guion, ronda, indice, historial, formato, opciones, hermanas = [], variantes = cuenta.variantes_por_creativo, tema = guion?.tema ?? guion?.categoria ?? null }) {
  if (!opciones.musicas.length) throw new Error('no hay música')
  if (!opciones.paletas.length) throw new Error('la cuenta no tiene paletas')
  const reel = opciones.clips.filter((c) => c.destino === 'reel')
  if (!reel.length) throw new Error('no hay clips de cierre para reel')
  const aptos = (formato.layouts ?? []).filter((l) => {
    try {
      return l.apto(guion)
    } catch {
      return false
    }
  })
  const layouts = aptos.length ? aptos.map((l) => l.id) : ['base']
  const motivos = cuenta.marca.motivos
  const hook = hookDe(ronda, indice, variantes)
  const delTema = historial.filter((h) => tema && h.tema === tema).flatMap((h) => h.firmas)
  /** @param {string[]} usados @param {number} opciones */
  const recientes = (usados, opciones) => new Set(usados.slice(-Math.max(0, Math.min(opciones - 1, 4))))
  const layoutsUsados = recientes(delTema.map((f) => f.layout), layouts.length)
  const paletasUsadas = recientes(delTema.map((f) => f.paleta), opciones.paletas.length)
  const previas = historial.slice(-RECIENTES).flatMap((h) => h.firmas)
  const rnd = azar(`firma:${cuenta.id}|${guion.clave}|${ronda}|${indice}`)
  /** @template T @param {T[]} l @returns {T} */
  const uno = (l) => /** @type {T} */ (l[Math.floor(rnd() * l.length)])
  const propia = ronda === 0 && indice === 0 && opciones.paletas.includes(guion.paleta) ? guion.paleta : null

  /** @param {boolean} conPropia @returns {Firma} */
  const candidata = (conPropia) => {
    const paleta = conPropia && propia ? propia : uno(opciones.paletas)
    const deLaPaleta = reel.filter((c) => c.paleta === paleta)
    return {
      formato: guion.formato, layout: uno(layouts), motivo: uno(motivos), paleta, hook,
      musica: uno([...opciones.musicas].sort()), cierre: uno((deLaPaleta.length ? deLaPaleta : reel).map((c) => c.id).sort()),
      color: uno(EJES.color), textura: uno(EJES.textura), ffmpeg: { zoom: 1, encuadre: 'centro', velocidad: 1 },
    }
  }
  /** @param {Firma} f */
  const costo = (f) =>
    hermanas.filter((h) => distancia(f, h) < DISTANCIA_HERMANAS).length * 100 +
    (layoutsUsados.has(f.layout) ? 10 : 0) +
    (paletasUsadas.has(f.paleta) ? 10 : 0) +
    previas.filter((h) => distancia(f, h) < DISTANCIA_RECIENTES).length

  /** @type {Firma | null} */
  let mejor = null
  let menor = Infinity
  for (let k = 0; k < MUESTRAS; k++) {
    const f = candidata(k < MUESTRAS / 2)
    const c = costo(f)
    if (c < menor) {
      mejor = f
      menor = c
    }
    if (c === 0) break
  }
  return /** @type {Firma} */ (mejor)
}

const NOMBRE_COLOR = /** @type {Record<string, string>} */ ({ calido: 'cálido', frio: 'frío', contraste: 'contraste', mate: 'mate' })
const NOMBRE_TEXTURA = /** @type {Record<string, string>} */ ({ grano: 'grano', vineta: 'viñeta' })
/** @param {string} id */
const nombreMusica = (id) => id.replace(/^acustica/, 'acústica').replace(/^tech-house/, 'tech house').replace(/-(\d+)$/, ' $1')

/** Para Kairo, en criollo, 60 caracteres o menos: lo más visible primero. @param {Firma} f */
export function resumenFirma(f) {
  const opcionales = [f.layout !== 'base' ? f.layout : null, f.paleta, f.motivo, NOMBRE_COLOR[f.color] ?? null, nombreMusica(f.musica), NOMBRE_TEXTURA[f.textura] ?? null, `cierre ${f.cierre.replace(new RegExp(`^${f.paleta}-`), '')}`]
  let texto = `gancho ${f.hook + 1}`
  for (const o of opcionales) if (o && texto.length + 3 + o.length <= 60) texto += ` · ${o}`
  return texto
}
