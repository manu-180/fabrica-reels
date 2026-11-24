// @ts-check
import { DESTINOS } from './cuenta.mjs'
import { afuera, pendiente, todasLasPublicaciones, tocarPublicacion, varianteDe, yaSalio } from './estado.mjs'
import { puedePublicar } from './antispam.mjs'
import { MIN, azar, diaAR, entre, finDelDia, instanteAR, minutoAR, minutosDe } from './tiempo.mjs'

/**
 * La cola con relojes (docs/CONTRATO.md § 3). Cada publicación sabe cuándo puede salir
 * (`no_antes_de`) y hasta cuándo (`vence`); el tic toma la vencida más vieja que pasa el antispam.
 * @typedef {import('./cuenta.mjs').Cuenta} Cuenta
 * @typedef {import('./estado.mjs').EstadoV2} EstadoV2
 * @typedef {import('./estado.mjs').Creativo} Creativo
 * @typedef {import('./estado.mjs').Ref} Ref
 * @typedef {import('./estado.mjs').Destino} Destino
 * @typedef {import('./estado.mjs').Publicacion} Publicacion
 */

// Lo que tarda un mp4 en estar listo en Blob después de producir, y el margen para que el tic que lo
// toma no quede justo en el borde.
const LISTO_MIN = 10
const AZAR_ESPERA = /** @type {const} */ ([3, 25])
// Una historia a la madrugada no la ve nadie.
const ULTIMA_HISTORIA_MIN = 23 * 60

/** Destinos que publican en esta cuenta hoy: activos en cuenta.json y no apagados en el estado. @param {Cuenta} cuenta @param {EstadoV2 | null} estado */
export const destinosVivos = (cuenta, estado) => /** @type {Destino[]} */ (DESTINOS.filter((d) => cuenta.destinos[/** @type {Destino} */ (d)].activo && !estado?.destinos_apagados?.[/** @type {Destino} */ (d)]))

/** @param {Cuenta} cuenta */
const segmentos = (cuenta) => cuenta.franjas.map((f) => ({ desde: minutosDe(f.desde), hasta: minutosDe(f.hasta) }))

/** Los minutos del día que caen en alguna franja, en orden: la "línea" que se parte entre los slots. @param {{ desde: number, hasta: number }[]} segs */
function linea(segs) {
  /** @type {number[]} */
  const ms = []
  for (const s of segs) for (let m = s.desde; m <= s.hasta; m++) ms.push(m)
  return ms
}

/**
 * Un instante al azar entre esos minutos del día, que no termine en 0 ni 5 y con segundos. null si no
 * hay lugar. @param {string} dia @param {number[]} minutos @param {() => number} rnd @param {number} [minimo] ms
 */
function instanteEntre(dia, minutos, rnd, minimo = 0) {
  const ts = minutos.filter((m) => m % 5 !== 0).map((m) => instanteAR(dia, m).getTime()).filter((t) => t >= minimo)
  if (!ts.length) return null
  const t = /** @type {number} */ (ts[Math.floor(rnd() * ts.length)])
  return new Date(t + entre(rnd, 1, 59) * 1000).toISOString()
}

/**
 * Si el instante cae fuera de franja, el arranque de la franja siguiente + azar(3..25) min; null si no
 * queda franja ese día. @param {Cuenta} cuenta @param {string} dia @param {number} t ms @param {() => number} rnd
 */
export function moverAFranja(cuenta, dia, t, rnd) {
  if (diaAR(t) !== dia) return null
  const m = minutoAR(t)
  for (const s of segmentos(cuenta)) {
    if (m >= s.desde && m <= s.hasta) return t
    if (m < s.desde) {
      let destino = s.desde + entre(rnd, AZAR_ESPERA[0], AZAR_ESPERA[1])
      if (destino % 5 === 0) destino++
      if (destino > s.hasta) continue
      return instanteAR(dia, destino).getTime() + entre(rnd, 1, 59) * 1000
    }
  }
  return null
}

/** La cadena de una variante en orden, sólo los destinos que tiene. @param {any} variante @returns {Destino[]} */
const cadena = (variante) => /** @type {Destino[]} */ (DESTINOS.filter((d) => variante?.publicaciones?.[/** @type {Destino} */ (d)]))

/**
 * Al producir: el reloj de cada publicación del día. Los slots son creativos × variantes en orden; las
 * franjas se ponen en fila como una sola línea de minutos y se parten en partes iguales. La primera
 * publicación viva de cada variante (la prueba, o la normal si la prueba está apagada) toma un minuto
 * de su parte; las siguientes quedan en null hasta que `alPublicar` les ponga el suyo.
 * @param {{ cuenta: Cuenta, creativos: Creativo[], dia: string, semilla: string, estado?: EstadoV2 | null, por?: { creativos: number, variantes: number }, ahora?: Date | null }} p
 * @returns {Creativo[]}
 */
export function agendar({ cuenta, creativos, dia, semilla, estado = null, por, ahora = null }) {
  const vivos = destinosVivos(cuenta, estado)
  const V = por?.variantes ?? Math.max(1, ...creativos.map((c) => c.variantes.length))
  const C = por?.creativos ?? Math.max(1, ...creativos.map((c) => c.slot + 1))
  const N = Math.max(1, C * V)
  const segs = segmentos(cuenta)
  const minutos = linea(segs)
  const fin = segs.at(-1)?.hasta ?? 0
  const espera = (vivos.includes('normal') ? cuenta.destinos.normal.espera_min : 0) + (vivos.includes('historia') ? cuenta.destinos.historia.espera_min : 0)
  const limite = Math.max(segs[0]?.desde ?? 0, fin - (vivos.length > 1 ? espera + 50 : 0))
  const posibles = minutos.filter((m) => m <= limite)
  const minimo = ahora ? ahora.getTime() + LISTO_MIN * MIN : 0
  const vence = finDelDia(dia)
  return creativos.map((c) => ({
    ...c,
    variantes: c.variantes.map((v) => {
      const i = Math.min(N - 1, c.slot * V + v.indice)
      const rnd = azar(`${semilla}|${c.id}|${v.indice}`)
      const parte = minutos.slice(Math.floor((i * minutos.length) / N), Math.floor(((i + 1) * minutos.length) / N)).filter((m) => m <= limite)
      const primero = cadena(v).find((d) => vivos.includes(d))
      const cuando = instanteEntre(dia, parte, rnd, minimo) ?? instanteEntre(dia, posibles.slice(-30), rnd, minimo)
      /** @type {any} */
      const publicaciones = {}
      for (const d of cadena(v)) {
        const p = /** @type {Publicacion} */ (v.publicaciones[d])
        if (d !== primero) publicaciones[d] = { ...p, no_antes_de: null, vence }
        else if (cuando) publicaciones[d] = { ...p, no_antes_de: cuando, vence }
        else publicaciones[d] = { ...p, no_antes_de: null, vence, descartada_at: (ahora ?? new Date()).toISOString(), motivo_descarte: 'sin franja' }
      }
      return { ...v, publicaciones }
    }),
  }))
}

/**
 * Cuándo puede salir: su `no_antes_de`, o el de la anterior si la anterior quedó afuera o su destino no
 * publica (sale en su lugar). null mientras la anterior está pendiente o sin reloj.
 * @param {EstadoV2} estado @param {Cuenta} cuenta @param {Ref} ref @returns {string | null}
 */
export function relojEfectivo(estado, cuenta, ref) {
  const v = varianteDe(estado, ref)
  if (!v) return null
  const vivos = destinosVivos(cuenta, estado)
  const orden = cadena(v)
  const i = orden.indexOf(ref.destino)
  const p = v.publicaciones[ref.destino]
  if (!p) return null
  if (p.no_antes_de) return p.no_antes_de
  for (let k = i - 1; k >= 0; k--) {
    const d = /** @type {Destino} */ (orden[k])
    const ant = /** @type {Publicacion} */ (v.publicaciones[d])
    const fuera = !vivos.includes(d) || afuera(ant)
    if (!fuera) return null
    if (ant.no_antes_de) return ant.no_antes_de
  }
  return null
}

/** @param {any} variante @param {Destino} destino */
const videoDe = (variante, destino) => (destino === 'historia' ? (variante.video_historia_url ?? variante.video_url) : variante.video_url)

/**
 * Las publicaciones pendientes con reloj, de la más vieja a la más nueva.
 * @param {{ estado: EstadoV2, cuenta: Cuenta, ahora: Date }} p @returns {{ ref: Ref, no_antes_de: string, vence: string }[]}
 */
export function cola({ estado, cuenta, ahora }) {
  const vivos = destinosVivos(cuenta, estado)
  /** @type {{ ref: Ref, no_antes_de: string, vence: string }[]} */
  const lista = []
  for (const { ref, pub, variante } of todasLasPublicaciones(estado)) {
    if (!vivos.includes(ref.destino) || !pendiente(pub) || !videoDe(variante, ref.destino)) continue
    if (ref.destino !== 'historia' && !pub.caption) continue
    if (Date.parse(pub.vence) < ahora.getTime()) continue
    const reloj = relojEfectivo(estado, cuenta, ref)
    if (reloj) lista.push({ ref, no_antes_de: reloj, vence: pub.vence })
  }
  return lista.sort((a, b) => a.no_antes_de.localeCompare(b.no_antes_de))
}

/**
 * La vencida más vieja que pasa el antispam. `ya` ignora el reloj (no el antispam ni el día).
 * @param {{ estado: EstadoV2, cuenta: Cuenta, ahora: Date, cuentaReal: import('./antispam.mjs').CuentaReal | null, ya?: boolean }} p
 * @returns {{ ref: Ref | null, motivo: string }}
 */
export function siguiente({ estado, cuenta, ahora, cuentaReal, ya = false }) {
  const hoy = diaAR(ahora)
  const vencidas = cola({ estado, cuenta, ahora }).filter((x) => (ya ? diaAR(x.vence) === hoy : Date.parse(x.no_antes_de) <= ahora.getTime()))
  if (!vencidas.length) return { ref: null, motivo: 'no hay nada vencido' }
  const a = puedePublicar({ cuenta, estado, cuentaReal, ahora })
  if (!a.ok) return { ref: null, motivo: a.motivo }
  return { ref: /** @type {{ ref: Ref }} */ (vencidas[0]).ref, motivo: 'vencida' }
}

/**
 * Salió `ref`: le pone el reloj a la siguiente viva de su cadena (espera del destino + azar 3 a 25 min),
 * corrido a la franja siguiente si cae afuera. Sin franja ese día, o una historia cuya normal salió
 * después de las 23, se descarta.
 * @param {{ estado: EstadoV2, cuenta: Cuenta, ref: Ref, publicado_at: string, semilla: string }} p @returns {EstadoV2}
 */
export function alPublicar({ estado, cuenta, ref, publicado_at, semilla }) {
  const v = varianteDe(estado, ref)
  const c = estado.creativos[ref.creativo]
  if (!v || !c) return estado
  const vivos = destinosVivos(cuenta, estado)
  const orden = cadena(v)
  const sigue = orden.slice(orden.indexOf(ref.destino) + 1).find((d) => vivos.includes(d) && pendiente(/** @type {Publicacion} */ (v.publicaciones[d])))
  if (!sigue) return estado
  const sref = { ...ref, destino: sigue }
  const rnd = azar(`${semilla}|${ref.creativo}|${ref.variante}|${sigue}`)
  const descartar = (/** @type {string} */ motivo) => tocarPublicacion(estado, sref, { descartada_at: publicado_at, motivo_descarte: motivo })
  if (sigue === 'historia' && minutoAR(publicado_at) >= ULTIMA_HISTORIA_MIN) return descartar('la anterior salió después de las 23: una historia a esa hora no la ve nadie')
  let t = Date.parse(publicado_at) + (cuenta.destinos[sigue].espera_min + entre(rnd, AZAR_ESPERA[0], AZAR_ESPERA[1])) * MIN
  if (minutoAR(t) % 5 === 0) t += MIN
  const dia = c.fecha
  const enFranja = moverAFranja(cuenta, dia, t, rnd)
  const pub = /** @type {Publicacion} */ (v.publicaciones[sigue])
  if (enFranja === null || enFranja > Date.parse(pub.vence)) return descartar('sin franja')
  return tocarPublicacion(estado, sref, { no_antes_de: new Date(enFranja).toISOString() })
}

/**
 * Lo que venció sin salir se descarta con motivo (no se acumula para mañana).
 * @param {{ estado: EstadoV2, ahora: Date }} p @returns {{ estado: EstadoV2, descartadas: number }}
 */
export function descartarViejas({ estado, ahora }) {
  let e = estado
  let descartadas = 0
  for (const { ref, pub, creativo } of todasLasPublicaciones(estado)) {
    if (yaSalio(pub) || pub.descartada_at || Date.parse(pub.vence) >= ahora.getTime()) continue
    e = tocarPublicacion(e, ref, { descartada_at: ahora.toISOString(), motivo_descarte: `no salió el ${creativo.fecha}` })
    descartadas++
  }
  return { estado: e, descartadas }
}
