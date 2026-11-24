// @ts-check
import { dormir } from './eleven.mjs'
import { pcmAWav } from './audio.mjs'

export const BASE_GEMINI = 'https://generativelanguage.googleapis.com/v1beta'
// Google retira modelos sin aviso (gemini-2.5-flash dio 404 a keys nuevas desde 2026-10): ante un 404 se prueba el siguiente.
export const MODELOS_TTS = ['gemini-2.5-flash-preview-tts', 'gemini-3.8-flash-tts']

/**
 * Una frase con Gemini TTS, como WAV de 24 kHz. Sin alineación: los tiempos se reparten después.
 * @param {{ texto: string, voz: string, estilo: string, clave: string | undefined, fetch: typeof fetch, espera?: (ms: number) => Promise<unknown>, modelos?: string[] }} p
 */
export async function sintetizarGemini({ texto, voz, estilo, clave, fetch: f, espera = dormir, modelos = MODELOS_TTS }) {
  if (!clave) throw new Error('falta GEMINI_API_KEY para la voz de respaldo')
  const cuerpo = JSON.stringify({
    contents: [{ parts: [{ text: `${estilo}:\n${texto}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } } },
  })
  let ultimo = 'sin modelos'
  for (const modelo of modelos) {
    for (let intento = 0; intento < 4; intento++) {
      /** @type {Response | null} */
      let r = null
      try {
        r = await f(`${BASE_GEMINI}/models/${modelo}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave }, body: cuerpo, signal: AbortSignal.timeout(120_000),
        })
      } catch (e) {
        ultimo = `Gemini ${modelo}: sin respuesta (${String(/** @type {Error} */ (e).message).slice(0, 80)})`
      }
      if (r) {
        const t = await r.text()
        if (r.ok) {
          const b64 = JSON.parse(t)?.candidates?.[0]?.content?.parts?.find((/** @type {any} */ p) => p?.inlineData?.data)?.inlineData?.data
          if (!b64) throw new Error('Gemini TTS no devolvió audio')
          const crudo = Buffer.from(b64, 'base64')
          const copia = new Uint8Array(crudo.length - (crudo.length % 2))
          copia.set(crudo.subarray(0, copia.length))
          return pcmAWav(new Int16Array(copia.buffer), 24_000)
        }
        ultimo = `Gemini ${modelo}: HTTP ${r.status} ${t.slice(0, 160)}`
        if (r.status === 404) break
        if (r.status !== 429 && r.status < 500) throw new Error(ultimo)
      }
      await espera((r?.status === 429 ? 15_000 : 3000) * (intento + 1))
    }
  }
  throw new Error(ultimo)
}
