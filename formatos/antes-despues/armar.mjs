// @ts-check
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NEUTROS, buscarFrase, contraste, copiarVoz, derivar, escribirDatos, gruposDeVoz, lienzo, normalizar, palabrasDe,
  palabrasDelHook, prepararSalida, rellenar, sfxHtml, texto, tintaSobre, validarBase, vozHtml,
} from '../_comun/index.mjs'

/*
  Cómo tiene que estar escrita la voz para que el formato calce (lo lee quien escribe guiones):
  - Los defectos se dicen en la primera mitad, con las mismas palabras de `antes.defectos`: cada
    marca aparece cuando la voz lo dice (si no lo dice, se reparten parejas).
  - La web nueva aparece al arrancar la oración que la presenta, entre el 30 % y el 78 % del cuerpo:
    la que contiene el `titular`, o si no la que empieza con mirá / así / ahora / imaginá / pero /
    con / esta / hoy, o si no la más cercana a la mitad.
  - Si la voz nombra el `boton` después del cambio, el cursor lo toca en ese momento.
*/

const AQUI = dirname(fileURLToPath(import.meta.url))
const PLANTILLA = join(AQUI, 'plantilla', 'index.html')
const PLANTILLA_APP = join(AQUI, 'plantilla', 'app.html')
const FOTOS = join(AQUI, 'fotos')
const PANTALLAS = join(AQUI, 'pantallas')

const CON_FOTO = readdirSync(FOTOS).filter((f) => f.endsWith('.jpg')).map((f) => f.replace(/\.jpg$/, '')).sort()
export const rubrosConFoto = () => [...CON_FOTO]

/**
 * Los colores de la web vieja (la parodia de una web de 2005: amarillo chillón, azul de sistema,
 * gris de botón de Windows). Son contenido, no marca: el test de neutralidad los deja pasar sólo en
 * este formato y verifica que ninguno sea un color de una cuenta.
 */
export const COLORES_FIJOS = ['#fff7b0', '#c7e2ff', '#1717a3', '#2f8bff', '#ffcc00', '#ffef00', '#e00000', '#000000', '#c0c0c0',
  '#6f6f6f', '#222', '#0000ee', '#d40000', '#111', '#d4d0c8', '#f0f0f0', '#eeeeee', '#999', '#666', '#ff00ff', '#888', '#ffff00', '#00a000',
  '#ffd400', '#444', '#f2f2f2', '#0a1a8c', '#2a6bd8', '#000', '#7a0000',
  // El caos del layout app: papel, birome azul y roja, el chat del grupo y el cuaderno de asistencia.
  '#f4efe2', '#1f3d9c', '#c0392b', '#2b2b2b', '#d9fdd3', '#efe7dc', '#0b5c4f', '#fbf7ea', '#9fc3e6', '#e05a4f', '#5f6b6d', '#e9e4d6', '#d6cfbd']

/*
  Las pantallas del layout app son capturas reales de la app (de sus videos de App Store, sin la barra
  de estado). Cada una con las palabras de una sección que la piden. Nada dibujado ni inventado: una
  pantalla nueva es una captura nueva en pantallas/ y su fila acá.
*/
export const PANTALLAS_APP = {
  inicio: /inicio|alumn|credito|creditos|pago|saldo/,
  calendario: /calendario|turno|reserv|horario|espera|anot|inscrib|semana/,
  confirmar: /confirm|sumar|lugar/,
  confirmada: /listo|confirmada|avis/,
  misclases: /misclases|clases|proxim/,
  cancelar: /cancel|recuper/,
  reembolso: /reembols|devuelve|vuelve/,
  historial: /historial|registro|movimiento/,
}

/** ¿El antes es el caos de papel y mensajes (app) o una web vieja? `antes.tipo` manda; si no está, lo dicen los defectos. @param {any} guion */
export function esApp(guion) {
  const tipo = guion?.contenido?.antes?.tipo
  if (tipo === 'papel') return true
  if (tipo === 'web') return false
  if (Array.isArray(guion?.contenido?.despues?.pantallas)) return true
  const d = guion?.contenido?.antes?.defectos
  if (!Array.isArray(d)) return false
  return d.filter((x) => /planilla|whatsapp|cuaderno|asistencia|recuper|cupo/.test(normalizar(String(x)).replace(/\s+/g, ''))).length >= 2
}

/*
  Dónde se señala cada defecto en la web vieja (px del video). Se elige por palabras del texto del
  defecto; lo que no matchea toma la primera zona libre en el orden de `RESERVA`.
*/
export const ZONAS = {
  texto: { x: 30, y: 318, w: 712, h: 420, claves: /letra|texto|leer|chic|peque|tipogra/ },
  celular: { x: 790, y: 292, w: 284, h: 548, claves: /celular|movil|responsive|pantalla|telefono|adapta/ },
  foto: { x: 800, y: 300, w: 276, h: 530, claves: /foto|imagen|pixel|borros/ },
  boton: { x: 28, y: 742, w: 470, h: 96, claves: /boton|contacto|turno|consulta|pedido|escrib|llam/ },
  colores: { x: 8, y: 8, w: 1064, h: 214, claves: /color|chill|diseno|viej|antigu|feo|logo/ },
  carga: { x: 28, y: 936, w: 196, h: 196, claves: /carga|lent|tarda|rot|error|no anda/ },
}
const RESERVA = ['texto', 'celular', 'foto', 'boton', 'colores', 'carga']
export const LAYOUTS = ['web', 'app']
export const layouts = [
  { id: 'web', apto: (/** @type {any} */ g) => !esApp(g) },
  { id: 'app', apto: (/** @type {any} */ g) => esApp(g) },
]

const COLA = 0.9

/** @param {unknown} v @returns {v is string} */
const lleno = (v) => typeof v === 'string' && v.trim().length > 0

/** @param {any} guion @returns {string[]} */
export function validar(guion) {
  const mal = validarBase(guion, 'antes-despues')
  const c = guion?.contenido
  if (!c || typeof c !== 'object') return mal
  const n = c.negocio
  if (!n || typeof n !== 'object') mal.push('contenido.negocio falta')
  else {
    const hay = rubrosConFoto()
    if (!hay.includes(n.rubro)) mal.push(`negocio.rubro tiene que ser uno con foto: ${hay.join(', ')}`)
    if (!lleno(n.nombre) || n.nombre.length > 28) mal.push('negocio.nombre: 1 a 28 caracteres')
    if (!lleno(n.lema) || n.lema.length > 60) mal.push('negocio.lema: 1 a 60 caracteres')
  }
  const d = c.antes?.defectos
  if (!Array.isArray(d) || d.length !== 3) mal.push('antes.defectos: exactamente 3')
  else d.forEach((/** @type {unknown} */ x, /** @type {number} */ i) => { if (!lleno(x) || x.length > 28) mal.push(`antes.defectos[${i}]: 1 a 28 caracteres`) })
  const s = c.despues
  if (!s || typeof s !== 'object') mal.push('contenido.despues falta')
  else {
    if (!lleno(s.titular) || s.titular.length > 40) mal.push('despues.titular: 1 a 40 caracteres')
    if (!lleno(s.boton) || s.boton.length > 22) mal.push('despues.boton: 1 a 22 caracteres')
    if (!Array.isArray(s.secciones) || s.secciones.length !== 3) mal.push('despues.secciones: exactamente 3')
    else s.secciones.forEach((/** @type {unknown} */ x, /** @type {number} */ i) => { if (!lleno(x) || x.length > 18) mal.push(`despues.secciones[${i}]: 1 a 18 caracteres`) })
    if (s.pantallas !== undefined) {
      if (!Array.isArray(s.pantallas) || s.pantallas.length < 1 || s.pantallas.length > 4) mal.push('despues.pantallas: opcional, 1 a 4')
      else s.pantallas.forEach((/** @type {unknown} */ x, /** @type {number} */ i) => { if (typeof x !== 'string' || !(x in PANTALLAS_APP)) mal.push(`despues.pantallas[${i}]: una de ${Object.keys(PANTALLAS_APP).join(', ')}`) })
    }
  }
  const tipo = c.antes?.tipo
  if (tipo !== undefined && tipo !== 'web' && tipo !== 'papel') mal.push('antes.tipo: opcional, "web" o "papel"')
  return mal
}

/** @param {number} x */
const r3 = (x) => Math.round(x * 1000) / 1000

/**
 * El plan sobre los tiempos reales de la voz: cuándo se señala cada defecto, cuándo la web se
 * transforma (al arrancar la oración que presenta la nueva) y cuándo vuelve al celular.
 * @param {any} guion @param {number} hook @param {{ palabras: any[] }} voz
 */
export function planificar(guion, hook, voz) {
  const c = guion.contenido
  const palabras = palabrasDe(voz.palabras)
  if (!palabras.length) throw new Error('la voz no trae palabras con tiempos')
  const finVoz = /** @type {{ fin: number }} */ (palabras[palabras.length - 1]).fin
  const duracion = Math.ceil((finVoz + COLA) * 30) / 30
  const nHook = palabrasDelHook(palabras, guion.hooks[hook])
  const finHook = nHook ? /** @type {{ fin: number }} */ (palabras[nHook - 1]).fin : 0

  // Oraciones del cuerpo: el cambio cae al empezar una, nunca a mitad de frase.
  /** @type {{ i: number, inicio: number }[]} */
  const oraciones = []
  for (let i = nHook; i < palabras.length; i++) {
    const previa = palabras[i - 1]
    if (i === nHook || (previa && /[.!?…:]$/.test(previa.texto))) oraciones.push({ i, inicio: /** @type {{ inicio: number }} */ (palabras[i]).inicio })
  }
  const cuerpo = finVoz - finHook
  const enVentana = (/** @type {{ inicio: number }} */ o) => o.inicio >= finHook + 0.3 * cuerpo && o.inicio <= finHook + 0.78 * cuerpo
  const PIVOTE = /^(mira|asi|ahora|imagina|pero|con|esta|esto|hoy)$/
  const porTitular = buscarFrase(palabras, c.despues.titular, { desde_s: finHook })
  let cambio =
    (porTitular && [...oraciones].reverse().find((o) => o.inicio <= porTitular.inicio + 0.01 && enVentana(o))) ||
    [...oraciones].reverse().find((o) => enVentana(o) && PIVOTE.test(normalizar(/** @type {{ texto: string }} */ (palabras[o.i]).texto))) ||
    [...oraciones].filter(enVentana).sort((a, b) => Math.abs(a.inicio - (finHook + cuerpo / 2)) - Math.abs(b.inicio - (finHook + cuerpo / 2)))[0]
  const tCambio = r3(Math.max(finHook + 1.2, (cambio ? cambio.inicio : finHook + cuerpo * 0.5) - 0.45))

  // Cada defecto aparece cuando la voz lo dice; si no lo dice, se reparten parejos antes del cambio.
  const usadas = new Set()
  const defectos = c.antes.defectos.map((/** @type {string} */ t, /** @type {number} */ k) => {
    const n = normalizar(t)
    const zona = Object.keys(ZONAS).find((z) => !usadas.has(z) && ZONAS[/** @type {keyof typeof ZONAS} */ (z)].claves.test(n)) ?? RESERVA.find((z) => !usadas.has(z)) ?? 'texto'
    usadas.add(zona)
    const dicho = buscarFrase(palabras, t, { desde_s: finHook - 0.05, hasta_s: tCambio })
    return { texto: t.trim(), zona, dicho: dicho ? dicho.inicio : null, k, t: 0 }
  })
  const libre = { desde: Math.max(finHook + 0.1, 0.9), hasta: tCambio - 0.7 }
  const paso = (libre.hasta - libre.desde) / 3
  let anterior = -Infinity
  for (const d of defectos) {
    let t = d.dicho ?? libre.desde + paso * d.k
    t = Math.max(t - 0.1, anterior + 1.1, 0.6)
    d.t = r3(Math.min(t, tCambio - 0.9))
    anterior = d.t
  }

  // La nueva se arma en escalones; el botón y las secciones caen cuando la voz los nombra, si los nombra.
  const tBoton = buscarFrase(palabras, c.despues.boton, { desde_s: tCambio })
  const secciones = c.despues.secciones.map((/** @type {string} */ s) => {
    const f = buscarFrase(palabras, s, { desde_s: tCambio })
    return { texto: s.trim(), dicho: f ? r3(f.inicio) : null }
  })
  const tCelular = r3(Math.max(tCambio + 2.6, duracion - 1.35))
  // La vuelta al celular (0,75 s) termina con al menos 0,35 s quietos: si la voz es corta, la cola se estira.
  const total = Math.max(duracion, Math.ceil((tCelular + 1.1) * 30) / 30)

  // Si después del último defecto sobra tiempo, el gag de la web vieja: se toca su botón y tira error.
  // Es el primero de los dos clics del reel; el segundo (en la nueva) sólo va si no hubo error.
  const ultimo = defectos[defectos.length - 1]
  const error = ultimo && tCambio - 0.35 - (ultimo.t + 2.2) >= 1.8 ? { t: r3(ultimo.t + 2.2 + 0.6) } : null
  const clic = error ? null : tBoton && tBoton.inicio > tCambio + 2 && tBoton.inicio < tCelular - 0.9 ? r3(tBoton.inicio) : tCelular - tCambio > 4.6 ? r3(tCelular - 1.5) : null

  return { duracion: r3(total), finHook: r3(finHook), cambio: tCambio, defectos, secciones, error, clic, celular: tCelular, nHook }
}

/** El texto de relleno de la web vieja. @param {any} n @param {string} idioma */
function textoViejo(n, idioma) {
  const rubro = String(texto(idioma, `antes_despues.rubros.${n.rubro}`)).toLowerCase()
  return String(texto(idioma, 'antes_despues.parrafo')).replace('{nombre}', n.nombre).replace('{rubro}', rubro)
}

/**
 * @param {{ guion: any, hook: 0|1|2, voz: { wav: string, duracion_s: number, palabras: { texto: string, inicio_s: number, fin_s: number }[] } | null, salida: string,
 *   diseno?: { ronda?: number, layout?: string }, tema: import('../_comun/tema.mjs').Tema }} p
 * @returns {Promise<{ duracion_s: number }>}
 */
export async function armar({ guion, hook, voz, salida, diseno, tema }) {
  const problemas = validar(guion)
  if (problemas.length) throw new Error(`guion de antes-despues inválido:\n- ${problemas.join('\n- ')}`)
  if (![0, 1, 2].includes(hook)) throw new Error('hook tiene que ser 0, 1 o 2')
  if (!voz || !voz.wav || !Array.isArray(voz.palabras)) throw new Error('antes-despues necesita la voz con sus palabras')
  if (!tema) throw new Error('falta el tema')
  const pedido = diseno?.layout
  const layout = pedido && LAYOUTS.includes(pedido) ? pedido : esApp(guion) ? 'app' : 'web'
  return layout === 'app' ? armarApp({ guion, hook, voz, salida, tema }) : armarWeb({ guion, hook, voz, salida, tema })
}

/** El resaltador sobre un fondo claro (el libro de visitas, el papel): el acento si se lee, si no el neutro oscuro. @param {any} p */
function resalteSobreClaro(p) {
  const t = tintaSobre(p.acento)
  return contraste(p.acento, NEUTROS.blanco) >= 3 && contraste(p.acento, t) >= 4.5 ? { fondo: p.acento, tinta: t } : { fondo: NEUTROS.oscuro, tinta: NEUTROS.blanco }
}

/** @param {{ guion: any, hook: 0|1|2, voz: any, salida: string, tema: import('../_comun/tema.mjs').Tema }} a */
async function armarWeb({ guion, hook, voz, salida, tema }) {
  const c = guion.contenido
  const plan = planificar(guion, hook, voz)
  const p = { ...tema.paleta, ...derivar(tema.paleta) }
  const { grupos } = gruposDeVoz(voz.palabras, { hook: guion.hooks[hook], hasta: plan.duracion - 0.3 })
  // Sobre la web vieja el subtítulo cae en el libro de visitas blanco, en tinta oscura; sobre la nueva y el
  // celular, en el tono de la paleta. Nunca encima de una foto pixelada (se veía como un bloque sucio).
  const resalte = contraste(p.acento, tintaSobre(p.acento)) >= 4.5 ? { fondo: p.acento, tinta: tintaSobre(p.acento) } : p.resalte
  const tramo = (/** @type {{ inicio: number }} */ g) => (g.inicio < plan.cambio ? 'viejo' : g.inicio < plan.celular ? 'nuevo' : 'celular')
  const gruposWeb = grupos.map((g) => ({ ...g, arriba: tramo(g) === 'celular' ? 1330 : 1290, tramo: tramo(g) }))

  const { dir } = prepararSalida(salida, tema)
  copiarVoz(voz.wav, dir)
  mkdirSync(join(dir, 'assets', 'fotos'), { recursive: true })
  copyFileSync(join(FOTOS, `${c.negocio.rubro}.jpg`), join(dir, 'assets', 'fotos', 'negocio.jpg'))
  // La foto de la web vieja: la misma, a 40 px de ancho y con compresión fuerte; el navegador la agranda sin suavizar.
  const px = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', join(FOTOS, `${c.negocio.rubro}.jpg`), '-vf', 'scale=40:-2:flags=area', '-q:v', '24', join(dir, 'assets', 'fotos', 'pixelada.jpg')], { encoding: 'utf8' })
  if (px.status !== 0) throw new Error(`ffmpeg no pudo pixelar la foto: ${px.stderr}`)

  const T = texto(tema.idioma, 'antes_despues')
  escribirDatos(dir, tema, {
    t: { menu: T.menu, error_ok: T.error_ok },
    ...plan,
    grupos: gruposWeb,
    resalte,
    resalteClaro: resalteSobreClaro(p),
    tono: p.tono,
    negocio: { ...c.negocio, rubroTexto: T.rubros[c.negocio.rubro] ?? c.negocio.rubro, parrafo: textoViejo(c.negocio, tema.idioma) },
    despues: c.despues,
    zonas: ZONAS,
    oscura: p.oscura,
  })

  /** @type {{ tipo: any, t: number, volumen: number }[]} */
  const sfx = plan.defectos.map((d) => ({ tipo: 'pop', t: d.t + 0.42, volumen: 0.6 }))
  sfx.push({ tipo: 'whoosh-cinematic', t: plan.cambio + 0.35, volumen: 0.32 })
  if (plan.error) sfx.push({ tipo: 'click-soft', t: plan.error.t, volumen: 0.9 })
  else if (plan.clic !== null) sfx.push({ tipo: 'click-soft', t: plan.clic, volumen: 0.9 })
  else sfx.push({ tipo: 'whoosh-short', t: plan.celular + 0.2, volumen: 0.4 })
  const capas = await lienzo(tema)
  const html = rellenar(readFileSync(PLANTILLA, 'utf8'), {
    css: capas.css,
    fondo: capas.fondo,
    hoja: capas.hoja,
    profundo: capas.profundo,
    luces: capas.luces,
    audio: vozHtml(plan.duracion) + '\n' + sfxHtml(sfx, plan.duracion),
    duracion: plan.duracion.toFixed(3),
  }, tema.idioma)
  writeFileSync(join(dir, 'index.html'), html)
  return { duracion_s: plan.duracion }
}

/**
 * Las pantallas reales que se muestran después del cambio, una por sección (o las que pide el guion), sin repetir.
 * @param {any} despues
 */
export function pantallasDe(despues) {
  if (Array.isArray(despues.pantallas)) return [...new Set(/** @type {string[]} */ (despues.pantallas))]
  /** @type {string[]} */
  const usadas = []
  const orden = Object.keys(PANTALLAS_APP)
  for (const s of despues.secciones) {
    const n = normalizar(String(s))
    const id = orden.find((k) => !usadas.includes(k) && PANTALLAS_APP[/** @type {keyof typeof PANTALLAS_APP} */ (k)].test(n)) ?? orden.find((k) => !usadas.includes(k))
    if (id) usadas.push(id)
  }
  return usadas
}

/** @param {{ guion: any, hook: 0|1|2, voz: any, salida: string, tema: import('../_comun/tema.mjs').Tema }} a */
async function armarApp({ guion, hook, voz, salida, tema }) {
  const c = guion.contenido
  const plan = planificar(guion, hook, voz)
  const p = { ...tema.paleta, ...derivar(tema.paleta) }
  const { grupos } = gruposDeVoz(voz.palabras, { hook: guion.hooks[hook], hasta: plan.duracion - 0.3 })
  const ids = pantallasDe(c.despues)
  // Cada pantalla entra cuando la voz nombra su sección; si no la nombra, se reparten parejas.
  const desde = plan.cambio + 1.5
  const hasta = plan.duracion - 1.4
  let previo = -Infinity
  const pantallas = ids.map((id, k) => {
    const s = plan.secciones[k]
    const parejo = desde + ((hasta - desde) * k) / Math.max(1, ids.length)
    const t = k === 0 ? plan.cambio + 0.5 : s && s.dicho !== null && s.dicho > desde && s.dicho < hasta ? s.dicho - 0.15 : parejo
    previo = Math.min(hasta, Math.max(previo + 1.3, t))
    return { id, src: `assets/pantallas/${id}.jpg`, t: r3(previo), seccion: s ? s.texto : null }
  })
  const { dir } = prepararSalida(salida, tema)
  copiarVoz(voz.wav, dir)
  mkdirSync(join(dir, 'assets', 'pantallas'), { recursive: true })
  for (const id of ids) copyFileSync(join(PANTALLAS, `${id}.jpg`), join(dir, 'assets', 'pantallas', `${id}.jpg`))
  escribirDatos(dir, tema, {
    t: texto(tema.idioma, 'antes_despues.app'),
    duracion: plan.duracion, cambio: plan.cambio, defectos: plan.defectos,
    grupos: grupos.map((g) => ({ ...g, arriba: 1290 })),
    tono: p.tono, resalte: p.resalte, tinta: p.tinta,
    negocio: { nombre: c.negocio.nombre, lema: c.negocio.lema },
    despues: { titular: c.despues.titular },
    pantallas,
  })
  /** @type {{ tipo: any, t: number, volumen: number }[]} */
  const sfx = plan.defectos.map((d) => ({ tipo: 'pop', t: d.t + 0.35, volumen: 0.5 }))
  sfx.push({ tipo: 'whoosh-cinematic', t: plan.cambio + 0.3, volumen: 0.32 })
  if (pantallas[1]) sfx.push({ tipo: 'click-soft', t: pantallas[1].t, volumen: 0.7 })
  const capas = await lienzo(tema)
  const html = rellenar(readFileSync(PLANTILLA_APP, 'utf8'), {
    css: capas.css, fondo: capas.fondo, hoja: capas.hoja, profundo: capas.profundo, luces: capas.luces,
    audio: vozHtml(plan.duracion) + '\n' + sfxHtml(sfx.slice(0, 5), plan.duracion),
    duracion: plan.duracion.toFixed(3),
  }, tema.idioma)
  writeFileSync(join(dir, 'index.html'), html)
  return { duracion_s: plan.duracion }
}
