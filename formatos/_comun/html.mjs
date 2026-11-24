// @ts-check
import { SFX, RUTAS } from './assets.mjs'
import { motivoDe } from './motivos/index.mjs'
import { temaCss } from './tema.mjs'
import { texto } from './textos.mjs'

export const FPS = 30
const r3 = (/** @type {number} */ x) => (Math.round(x * 1000) / 1000).toFixed(3)

/** @param {string} s */
export const escaparHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Lo que comparten todas las plantillas sobre el lienzo: cámara, riel, subtítulos y la tipografía de rótulos. */
const CSS_LIENZO = `
#camara { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; z-index: 2; transform-origin: 540px 960px; }
#riel { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; }
#luces { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; z-index: 40; pointer-events: none; }
#subs { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; z-index: 50; pointer-events: none; }
.mono { font-family: var(--f-mono); font-weight: var(--p-mono); letter-spacing: 0.04em; }
.rotulo { display: inline-flex; align-items: center; gap: 14px; font-family: var(--f-mono); font-weight: var(--p-mono); font-size: 44px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--tenue); }
.rotulo i { display: block; flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--acento); }
.w { display: inline-block; overflow: visible; vertical-align: top; padding: 0.04em 0.02em 0.12em; margin: -0.04em -0.02em -0.12em; }
.wi { display: inline-block; }
.num { color: var(--acento-texto, var(--acento)); }
`

/**
 * El lienzo de una plantilla: CSS del tema (variables y @font-face) + el del motivo + lo común, y las
 * cuatro capas del motivo (`fondo`, `hoja`, `profundo`, `luces`).
 * @param {import('./tema.mjs').Tema} tema
 */
export async function lienzo(tema) {
  const m = await motivoDe(tema.motivo)
  const c = m.capas(tema)
  return { css: [temaCss(tema), c.css, CSS_LIENZO].join('\n'), fondo: c.fondo, hoja: c.hoja, profundo: c.profundo, luces: c.luces, motivo: m.nombre }
}

/**
 * @param {{ id: string, src: string, inicio: number, duracion: number, volumen?: number, pista?: number, desde?: number }} a
 */
export function audioHtml({ id, src, inicio, duracion, volumen = 1, pista = 10, desde = 0 }) {
  const recorte = desde > 0 ? ` data-media-start="${r3(desde)}"` : ''
  return `<audio id="${id}" class="clip" src="${src}" data-start="${r3(inicio)}" data-duration="${r3(duracion)}"${recorte} data-volume="${volumen}" data-track-index="${pista}"></audio>`
}

/** La locución entera desde el cuadro 0. @param {number} duracion */
export function vozHtml(duracion) {
  return audioHtml({ id: 'voz', src: RUTAS.voz, inicio: 0, duracion, volumen: 1, pista: 10 })
}

/**
 * Tags de sfx: cada uno pega (su pico) un cuadro después de `t`, el instante de la acción.
 * @param {{ tipo: keyof typeof SFX, t: number, volumen?: number }[]} lista
 * @param {number} tope  duración del video: nada suena después
 */
export function sfxHtml(lista, tope = Infinity) {
  return lista
    .map((s, k) => {
      /** @type {{ archivo: string, duracion: number, pico: number, desde?: number, largo?: number }} */
      const def = SFX[s.tipo]
      if (!def) throw new Error(`sfx desconocido: ${s.tipo}`)
      const desde = def.desde ?? 0
      const inicio = Math.max(0, s.t + 1 / FPS - (def.pico - desde))
      const duracion = Math.min(def.largo ?? def.duracion - desde, def.duracion - desde, tope - inicio)
      if (duracion <= 0.05) return ''
      return audioHtml({ id: `sfx-${k}`, src: def.archivo, inicio, duracion, volumen: s.volumen ?? 0.5, pista: 11 + (k % 4), desde })
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Reemplaza `{{clave}}` por su valor (sin escapar: ya viene armado) y `{{t:ruta}}` por el rótulo del
 * idioma (escapado). Una plantilla no tiene texto visible propio: todo pasa por `{{t:...}}`.
 * @param {string} plantilla @param {Record<string, string | number>} vars @param {string} [idioma]
 */
export function rellenar(plantilla, vars, idioma) {
  return plantilla.replace(/\{\{(t:)?([\w.]+)\}\}/g, (m, t, k) => {
    if (t) {
      if (!idioma) throw new Error(`la plantilla pide {{t:${k}}} y no hay idioma`)
      return escaparHtml(String(texto(idioma, k)))
    }
    if (!(k in vars)) throw new Error(`falta {{${k}}} en la plantilla`)
    return String(vars[k])
  })
}
