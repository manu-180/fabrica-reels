// @ts-check
export { NEUTROS, contraste, derivar, luminancia, mezclar, resalteDe, rgb, rgba, separarDe, tintaSobre, tono } from './color.mjs'
export { MOTIVOS, carasDe, cargasDeFuentes, copiarTema, leerNombreFuente, rutaLogo, temaCss, temaDe } from './tema.mjs'
export { IDIOMAS, texto, textos } from './textos.mjs'
export { CADENA_VOZ, LUFS_VOZ, RUTAS, SFX, copiarVoz, escribirDatos, prepararSalida } from './assets.mjs'
export { FPS, audioHtml, escaparHtml, lienzo, rellenar, sfxHtml, vozHtml } from './html.mjs'
export { agrupar, gruposDeVoz, textoSubtitulo } from './subtitulos.mjs'
export { buscarFrase, contarPalabras, normalizar, palabrasDe, palabrasDelHook, tokens } from './tiempos.mjs'
export { ARCHIVO_CLAVE, esTexto, validarBase } from './validar.mjs'
export { motivoDe } from './motivos/index.mjs'

/**
 * El layout que pide el diseño, si el formato lo tiene; si no (o sin diseño), el de la ronda.
 * @param {readonly string[]} ids @param {{ layout?: string, ronda?: number } | undefined} diseno
 */
export function layoutDe(ids, diseno) {
  if (diseno?.layout && ids.includes(diseno.layout)) return diseno.layout
  return /** @type {string} */ (ids[Math.max(0, Math.floor(Number(diseno?.ronda) || 0)) % ids.length])
}
