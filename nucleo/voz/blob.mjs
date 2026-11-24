// @ts-check

/**
 * La caché de voz sobre Vercel Blob (`@vercel/blob`, lo instala el workflow). Las rutas son fijas
 * (sin sufijo al azar): la ruta ES la clave de la caché.
 * @param {{ token?: string, access?: 'public' | 'private', cargar?: () => Promise<any> }} [p]
 * @returns {Promise<import('./cache.mjs').BlobVoz>}
 */
export async function blobVercel({ token = process.env.BLOB_READ_WRITE_TOKEN, access = 'public', cargar = () => import('@vercel/blob') } = {}) {
  if (!token) throw new Error('falta BLOB_READ_WRITE_TOKEN para la caché de voz')
  const sdk = await cargar()
  return {
    async head(ruta) {
      try {
        const h = await sdk.head(ruta, { token })
        return { url: h.url }
      } catch (e) {
        if (e instanceof sdk.BlobNotFoundError) return null
        throw e
      }
    },
    async get(ruta) {
      const r = await sdk.get(ruta, { access, token })
      if (!r || r.statusCode !== 200 || !r.stream) return null
      return Buffer.from(await new Response(r.stream).arrayBuffer())
    },
    async put(ruta, cuerpo, { contentType }) {
      const r = await sdk.put(ruta, cuerpo, { access, token, contentType, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31_536_000 })
      return { url: r.url }
    },
  }
}
