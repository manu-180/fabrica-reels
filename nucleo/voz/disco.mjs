// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/**
 * La caché de voz en una carpeta local, con las mismas rutas que en el Blob: para correr
 * `producir --seco` sin Blob y sin volver a pagar lo que ya se grabó en esa máquina.
 * @param {string} dir @returns {import('./cache.mjs').BlobVoz}
 */
export function blobEnDisco(dir) {
  const raiz = resolve(dir)
  /** @param {string} ruta */
  const archivo = (ruta) => {
    const r = resolve(join(raiz, ruta))
    if (r !== raiz && !r.startsWith(raiz + sep)) throw new Error(`ruta fuera de la caché de voz: ${ruta}`)
    return r
  }
  return {
    async head(ruta) {
      const a = archivo(ruta)
      return existsSync(a) ? { url: `file://${a}` } : null
    },
    async get(ruta) {
      const a = archivo(ruta)
      return existsSync(a) ? readFileSync(a) : null
    },
    async put(ruta, cuerpo) {
      const a = archivo(ruta)
      mkdirSync(dirname(a), { recursive: true })
      writeFileSync(a, Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo))
      return { url: `file://${a}` }
    },
  }
}
