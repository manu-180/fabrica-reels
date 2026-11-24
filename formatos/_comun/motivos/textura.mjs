// @ts-check

/** No es un motivo: lo que comparten grilla, luz, pizarra y papel. */

/** @param {Record<string, string>} vars */
export const cssVars = (vars) => `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`

/**
 * Ruido fractal en escala de grises como data URI (el test de colores no mira adentro de un data:).
 * @param {number} semilla @param {number} frecuencia @param {number} [octavas]
 */
export const GRANO = (semilla, frecuencia, octavas = 3) =>
  `url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='g' x='0' y='0'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='${frecuencia}' numOctaves='${octavas}' seed='${semilla}' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23g)'/%3E%3C/svg%3E")`

/**
 * Fibras largas (papel, polvo de tiza): ruido estirado en x, con alfa propio, para multiplicar o sumar.
 * @param {number} semilla @param {number} fx @param {number} fy @param {number} alfa 0 a 1
 */
export const FIBRAS = (semilla, fx, fy, alfa) =>
  `url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Cfilter id='f' x='0' y='0'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='${fx} ${fy}' numOctaves='4' seed='${semilla}' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 ${alfa * 3} ${-alfa}'/%3E%3C/filter%3E%3Crect width='600' height='600' filter='url(%23f)'/%3E%3C/svg%3E")`
