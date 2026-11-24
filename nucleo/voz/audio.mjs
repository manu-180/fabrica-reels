// @ts-check
import { spawn } from 'node:child_process'

/** @typedef {{ texto: string, inicio: number, fin: number }} PalabraT */

export const FRECUENCIA = 48_000
// −40 dBFS en ventanas de 10 ms: el mismo umbral con que `silencedetect=noise=-40dB` mide las pausas.
const UMBRAL = 32768 * 10 ** (-40 / 20)

/** @param {number} x */
const r3 = (x) => Math.round(x * 1000) / 1000

/**
 * Dónde empieza y termina la voz en un tramo PCM mono de 16 bits y dónde cortar, con aire para el
 * ataque y la caída. La alineación de ElevenLabs suele terminar después de la voz real: sólo puede
 * estirar el corte 80 ms.
 * @param {Int16Array} pcm @param {{ inicio: number, fin: number } | null} habla
 */
export function bordesDeVoz(pcm, habla, frecuencia = FRECUENCIA) {
  const ventana = Math.round(frecuencia * 0.01)
  /** @type {number[]} */
  const fuertes = []
  for (let k = 0; k * ventana < pcm.length; k++) {
    let suma = 0
    const hasta = Math.min(pcm.length, (k + 1) * ventana)
    for (let j = k * ventana; j < hasta; j++) suma += (pcm[j] ?? 0) ** 2
    if (Math.sqrt(suma / Math.max(1, hasta - k * ventana)) > UMBRAL) fuertes.push(k)
  }
  const dur = pcm.length / frecuencia
  const vozIni = fuertes.length ? (fuertes[0] ?? 0) * 0.01 : 0
  const vozFin = fuertes.length ? ((fuertes[fuertes.length - 1] ?? 0) + 1) * 0.01 : dur
  let ini = vozIni
  let fin = vozFin
  if (habla) {
    ini = Math.min(ini, Math.max(habla.inicio, vozIni - 0.08))
    fin = Math.max(fin, Math.min(habla.fin, vozFin + 0.08))
  }
  return { inicio: Math.max(0, ini - 0.03), fin: Math.min(dur, fin + 0.1), vozIni, vozFin }
}

/**
 * Une los tramos y corre los tiempos de cada palabra según dónde quedó su tramo. `pausa` es el
 * silencio que se tiene que oír de voz a voz, así que al silencio insertado se le descuenta el aire
 * que ya traen los cortes. Fundidos cortos en los bordes para que no haya clicks.
 * @param {{ pcm: Int16Array, palabras: PalabraT[], pausa: number }[]} tramos
 * @returns {{ pcm: Int16Array, palabras: PalabraT[] }}
 */
export function unirTramos(tramos, frecuencia = FRECUENCIA) {
  const bordes = tramos.map((tr) => {
    const primera = tr.palabras[0]
    const ultima = tr.palabras[tr.palabras.length - 1]
    return bordesDeVoz(tr.pcm, primera && ultima ? { inicio: primera.inicio, fin: ultima.fin } : null, frecuencia)
  })
  /** @type {Int16Array[]} */
  const partes = []
  /** @type {PalabraT[]} */
  const palabras = []
  let t = 0
  tramos.forEach((tr, i) => {
    const b = /** @type {ReturnType<typeof bordesDeVoz>} */ (bordes[i])
    const sig = bordes[i + 1]
    const recorte = Int16Array.from(tr.pcm.subarray(Math.round(b.inicio * frecuencia), Math.round(b.fin * frecuencia)))
    const entra = Math.min(recorte.length, Math.round(frecuencia * 0.008))
    const sale = Math.min(recorte.length, Math.round(frecuencia * 0.04))
    for (let j = 0; j < entra; j++) recorte[j] = Math.round((recorte[j] ?? 0) * (j / entra))
    for (let j = 0; j < sale; j++) {
      const k = recorte.length - 1 - j
      recorte[k] = Math.round((recorte[k] ?? 0) * (j / sale))
    }
    const largo = recorte.length / frecuencia
    for (const p of tr.palabras) {
      const inicio = Math.min(largo, Math.max(0, p.inicio - b.inicio))
      palabras.push({ texto: p.texto, inicio: r3(t + inicio), fin: r3(t + Math.min(largo, Math.max(inicio, p.fin - b.inicio))) })
    }
    const aire = b.fin - b.vozFin + (sig ? sig.vozIni - sig.inicio : 0)
    const silencio = new Int16Array(Math.round(Math.max(0.04, tr.pausa - aire) * frecuencia))
    partes.push(recorte, silencio)
    t += (recorte.length + silencio.length) / frecuencia
  })
  const total = new Int16Array(partes.reduce((a, x) => a + x.length, 0))
  let k = 0
  for (const x of partes) {
    total.set(x, k)
    k += x.length
  }
  return { pcm: total, palabras }
}

/**
 * El TTS a veces deja un hueco largo adentro de una frase: todo silencio de más de `max` s se acorta
 * a `max` sacándole el centro y se corren las palabras que vienen después. La cola final no se toca.
 * @param {{ pcm: Int16Array, palabras: PalabraT[] }} u @param {number} max
 */
export function acortarSilencios({ pcm, palabras }, max, frecuencia = FRECUENCIA) {
  const largo = Math.round(max * frecuencia)
  /** @type {{ desde: number, cuanto: number }[]} */
  const cortes = []
  let inicio = -1
  for (let k = 0; k < pcm.length; k++) {
    const callado = Math.abs(pcm[k] ?? 0) < UMBRAL
    if (callado && inicio < 0) inicio = k
    if (!callado && inicio >= 0) {
      if (inicio > 0 && k - inicio > largo) cortes.push({ desde: inicio + Math.round(largo / 2), cuanto: k - inicio - largo })
      inicio = -1
    }
  }
  if (!cortes.length) return { pcm, palabras }
  const salida = new Int16Array(pcm.length - cortes.reduce((x, c) => x + c.cuanto, 0))
  let leido = 0
  let escrito = 0
  for (const c of cortes) {
    salida.set(pcm.subarray(leido, c.desde), escrito)
    escrito += c.desde - leido
    leido = c.desde + c.cuanto
  }
  salida.set(pcm.subarray(leido), escrito)
  const corrido = (/** @type {number} */ t) => t - cortes.filter((c) => c.desde / frecuencia < t).reduce((x, c) => x + c.cuanto, 0) / frecuencia
  return { pcm: salida, palabras: palabras.map((w) => ({ texto: w.texto, inicio: r3(corrido(w.inicio)), fin: r3(corrido(w.fin)) })) }
}

/** PCM s16le mono → WAV. @param {Int16Array} pcm */
export function pcmAWav(pcm, frecuencia = FRECUENCIA) {
  const datos = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const cab = Buffer.alloc(44)
  cab.write('RIFF', 0)
  cab.writeUInt32LE(36 + datos.length, 4)
  cab.write('WAVE', 8)
  cab.write('fmt ', 12)
  cab.writeUInt32LE(16, 16)
  cab.writeUInt16LE(1, 20)
  cab.writeUInt16LE(1, 22)
  cab.writeUInt32LE(frecuencia, 24)
  cab.writeUInt32LE(frecuencia * 2, 28)
  cab.writeUInt16LE(2, 32)
  cab.writeUInt16LE(16, 34)
  cab.write('data', 36)
  cab.writeUInt32LE(datos.length, 40)
  return Buffer.concat([cab, datos])
}

/** Cualquier audio (mp3 de ElevenLabs, wav de Gemini) → PCM mono 16 bits a FRECUENCIA, con ffmpeg. @param {Buffer} audio @returns {Promise<Int16Array>} */
export function decodificarAudio(audio) {
  return new Promise((ok, mal) => {
    const p = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', String(FRECUENCIA), '-f', 's16le', 'pipe:1'])
    /** @type {Buffer[]} */
    const salida = []
    let error = ''
    p.stdout.on('data', (d) => salida.push(d))
    p.stderr.on('data', (d) => (error += d))
    p.on('error', mal)
    p.on('close', (codigo) => {
      if (codigo !== 0) return mal(new Error(`ffmpeg no pudo decodificar la voz (${codigo}): ${error.slice(-200)}`))
      const b = Buffer.concat(salida)
      const copia = new Uint8Array(b.length - (b.length % 2))
      copia.set(b.subarray(0, copia.length))
      ok(new Int16Array(copia.buffer))
    })
    p.stdin.on('error', () => {})
    p.stdin.end(audio)
  })
}
