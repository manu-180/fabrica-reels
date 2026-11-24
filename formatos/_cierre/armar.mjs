// @ts-check
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audioHtml, copiarVoz, derivar, escaparHtml, escribirDatos, lienzo, mezclar, normalizar, palabrasDe, prepararSalida, rellenar, rutaLogo, sfxHtml } from '../_comun/index.mjs'

/*
  El cierre que se pega al final de un reel: un titular, una palabra o dominio destacado que se arma
  letra por letra, una ficha opcional ("Gratis") y un celular con una página real de la cuenta.
  Dos estilos: `tipografico` (el destacado enorme) y `buscador` (se tipea en una barra y el enter
  carga la página). No sabe de ninguna marca: todo entra por parámetro. Lo usa F4 para renderizar los
  clips de `cuentas/<id>/cta/` (ver README).
*/

const AQUI = dirname(fileURLToPath(import.meta.url))
export const ESTILOS = /** @type {const} */ (['tipografico', 'buscador'])
export const DURACION = 4.9
/** La voz entra 0,15 s después del corte: el primer cuadro ya está compuesto y en movimiento. */
export const VOZ_INICIO = 0.15

/**
 * @typedef {{ titular: string, destacado: string, corte?: number | null, pista?: string, ficha?: string | null }} TextosCierre
 *   destacado: lo que se arma letra por letra ("calcular.ar", "WEB"). corte: desde qué letra va en tinta
 *   (".ar"); null o ausente, todo en el acento. pista: el placeholder de la barra del buscador.
 * @typedef {{ portada?: string, resultado?: string, ancho?: number, marco?: { x: number, y: number, w: number, h: number } | null }} Captura
 *   Rutas absolutas a jpg/png. portada: lo que muestra el celular de entrada; resultado: lo que carga
 *   el enter del buscador (y lo que muestra el tipográfico). ancho: px de la captura (default 780).
 *   marco: la zona que se marca con el trazo del acento, en px de la captura.
 * @typedef {{ wav: string, palabras: { texto: string, inicio_s: number, fin_s: number }[] }} VozCierre
 */

/**
 * Los momentos del cierre: con voz, cuando la voz dice cada cosa; sin voz, un ritmo fijo.
 * @param {{ textos: TextosCierre, voz: VozCierre | null, duracion: number }} p
 */
export function tiemposCierre({ textos, voz, duracion }) {
  const r3 = (/** @type {number} */ x) => Math.round(x * 1000) / 1000
  const ANTES = 2 / 30
  const pal = voz ? palabrasDe(voz.palabras).map((w) => ({ ...w, inicio: w.inicio + VOZ_INICIO, fin: w.fin + VOZ_INICIO, n: normalizar(w.texto) })) : []
  const partes = String(textos.destacado).split(/[.\s]+/).map(normalizar).filter(Boolean)
  const k0 = pal.findIndex((w) => w.n === partes[0])
  const kFicha = textos.ficha ? pal.findIndex((w) => w.n === normalizar(String(textos.ficha))) : -1
  if (k0 >= 0) {
    const ultima = pal.findIndex((w, k) => k >= k0 && w.n === partes[partes.length - 1])
    const fin = (pal[ultima >= 0 ? ultima : pal.length - 1] ?? pal[k0]).fin
    const cola = partes.length > 1 && ultima > k0 ? pal[ultima - 1 >= k0 ? ultima - 1 : k0].inicio : fin - 0.3
    const envio = r3(fin + 0.12)
    return {
      destacado: r3(pal[k0].inicio - ANTES),
      cola: r3(Math.max(pal[k0].inicio, cola - ANTES)),
      golpe: r3(pal[ultima >= 0 ? ultima : k0].inicio),
      fin: r3(fin),
      envio,
      ficha: r3(kFicha >= 0 ? pal[kFicha].inicio - ANTES : Math.max(0.6, pal[k0].inicio - 0.9)),
      marca: r3(Math.min(duracion - 0.8, Math.max(envio + 0.3, (pal[k0 - 1]?.inicio ?? envio) - ANTES))),
    }
  }
  return { destacado: 1.3, cola: 2.1, golpe: 2.3, fin: 2.4, envio: 2.55, ficha: kFicha >= 0 ? r3(pal[kFicha].inicio - ANTES) : 0.9, marca: 2.9 }
}

/**
 * Arma el proyecto HyperFrames de un cierre (sin renderizar).
 * @param {{ tema: import('../_comun/tema.mjs').Tema, estilo: typeof ESTILOS[number], salida: string, textos: TextosCierre,
 *   captura?: Captura | null, voz?: VozCierre | null, duracion?: number }} p
 * @returns {Promise<{ duracion_s: number }>}
 */
export async function armarCierre({ tema, estilo, salida, textos, captura = null, voz = null, duracion = DURACION }) {
  if (!ESTILOS.includes(estilo)) throw new Error(`estilo desconocido: ${estilo}`)
  if (!textos?.titular || !textos?.destacado) throw new Error('el cierre necesita titular y destacado')
  const p = tema.paleta
  const d = derivar(p)
  const { dir } = prepararSalida(salida, tema)
  mkdirSync(join(dir, 'assets', 'captura'), { recursive: true })
  /** @param {string | undefined} ruta @param {string} nombre */
  const copiar = (ruta, nombre) => {
    if (!ruta) return null
    const destino = `assets/captura/${nombre}${extname(ruta).toLowerCase()}`
    copyFileSync(ruta, join(dir, destino))
    return destino
  }
  const portada = copiar(captura?.portada, 'portada')
  const resultado = copiar(captura?.resultado ?? captura?.portada, 'resultado')
  const img = (/** @type {string | null} */ src, /** @type {string} */ id) => (src ? `<img id="${id}" src="${src}" alt="">` : '')
  const t = tiemposCierre({ textos, voz, duracion })
  let audio = ''
  if (voz) {
    copiarVoz(voz.wav, dir)
    const fin = (palabrasDe(voz.palabras).at(-1)?.fin ?? duracion) + 0.25
    audio = audioHtml({ id: 'voz', src: 'assets/voz.wav', inicio: VOZ_INICIO, duracion: Math.min(fin, duracion - VOZ_INICIO), volumen: 1, pista: 10 })
  }
  const paso = (t.fin - 0.1 - t.destacado) / Math.max(1, Array.from(textos.destacado).length)
  /** @type {{ tipo: any, t: number, volumen: number }[]} */
  const sfx = estilo === 'tipografico'
    ? [{ tipo: 'impact-bass-1', t: t.golpe, volumen: 0.24 }]
    : [
        { tipo: 'click-soft', t: t.destacado, volumen: 0.28 },
        { tipo: 'click-soft', t: t.destacado + 4 * paso, volumen: 0.24 },
        { tipo: 'click-soft', t: t.envio - 0.07, volumen: 0.9 },
        { tipo: 'notification', t: t.envio + 0.44, volumen: 0.32 },
      ]
  audio = [audio, sfxHtml(sfx, duracion)].filter(Boolean).join('\n')
  escribirDatos(dir, tema, {
    estilo,
    duracion,
    tiempos: t,
    destacado: textos.destacado,
    corte: Number.isInteger(textos.corte) ? textos.corte : null,
    ficha: textos.ficha ?? null,
    captura: resultado ? { ancho: captura?.ancho ?? 780, marco: captura?.marco ?? null } : null,
    logo: rutaLogo(tema),
    vars: { lupa: mezclar(p.superficie, p.acento, d.oscura ? 0.16 : 0.1) },
  })
  // Cada clip lleva sólo el bloque de su estilo (el otro se saca del HTML, no sólo se oculta).
  const otro = estilo === 'buscador' ? 'tipografico' : 'buscador'
  const plantilla = readFileSync(join(AQUI, 'plantilla', 'index.html'), 'utf8').replace(new RegExp(`<div id="${otro}" class="capa">[\\s\\S]*?<!-- /${otro} -->\\r?\\n`), '')
  const capas = await lienzo(tema)
  const html = rellenar(plantilla, {
    css: capas.css,
    fondo: capas.fondo,
    hoja: capas.hoja,
    profundo: capas.profundo,
    luces: capas.luces,
    titular: escaparHtml(textos.titular),
    ficha: escaparHtml(textos.ficha ?? ''),
    pista: escaparHtml(textos.pista ?? ''),
    pantalla_tipografico: img(resultado, 't-pagina'),
    pantalla_buscador: img(portada, 'b-portada') + img(resultado, 'b-resultado'),
    audio,
    duracion: duracion.toFixed(3),
  })
  writeFileSync(join(dir, 'index.html'), html)
  return { duracion_s: duracion }
}
