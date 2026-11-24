// @ts-check
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIA } from './tiempo.mjs'

// Meta copia el video al crear el contenedor y lo de un día que no salió se descarta, así que pasadas 3
// semanas ningún mp4 se vuelve a pedir. La firma queda en el estado por si hay que regenerarlo.
// El caché de voz (voz/) no se toca: es lo que evita volver a pagar ElevenLabs.
export const DIAS_GUARDAR = 21
export const PREFIJO = 'videos/'

/**
 * @param {{ ahora?: Date, token: string, listar: Function, borrar: Function, prefijo?: string, dias?: number, log?: (m: string) => void }} p
 * @returns {Promise<number>} cuántos borró
 */
export async function limpiarBlobs({ ahora = new Date(), token, listar, borrar, prefijo = PREFIJO, dias = DIAS_GUARDAR, log = () => {} }) {
  if (!prefijo.startsWith(PREFIJO)) throw new Error(`limpiar sólo borra videos (${PREFIJO}...), no ${prefijo}`)
  const limite = ahora.getTime() - dias * DIA
  /** @type {string[]} */
  const viejos = []
  /** @type {string | undefined} */
  let cursor
  do {
    const r = await listar({ prefix: prefijo, cursor, limit: 1000, token })
    for (const b of r.blobs) if (new Date(b.uploadedAt).getTime() < limite) viejos.push(b.url)
    cursor = r.hasMore ? r.cursor : undefined
  } while (cursor)
  for (let i = 0; i < viejos.length; i += 100) await borrar(viejos.slice(i, i + 100), { token })
  log(`[fabrica] videos borrados de Blob: ${viejos.length}`)
  return viejos.length
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (!token) {
    console.log('::warning::Sin BLOB_READ_WRITE_TOKEN no se limpian los videos viejos.')
    process.exit(0)
  }
  const { list, del } = await import('@vercel/blob')
  await limpiarBlobs({ token, listar: list, borrar: del, log: console.log })
}
