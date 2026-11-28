import assert from 'node:assert/strict'
import { test } from 'node:test'
import { elegir, espejar, leerEstado, motivoApagado } from './espejo.mjs'

const AHORA = new Date('2026-11-27T18:00:00Z')
const config = { por_dia: 2, gap_h: 3, desde: '10:00', hasta: '23:30', ventana_dias: 14, margen_min: 30 }
const cuenta = { id: 'apex-stack', modo: 'sombra', usuario: 'apex.stack' }
const reel = (id, horas, feed = true) => ({ id, at: new Date(AHORA.getTime() - horas * 3_600_000).toISOString(), feed, url: `https://cdn/${id}.mp4` })
const intento = (horas, extra = {}) => ({ creando_at: new Date(AHORA.getTime() - horas * 3_600_000).toISOString(), ig_container_id: 'c', publicado_at: new Date(AHORA.getTime() - horas * 3_600_000).toISOString(), historia_id: 'h', de_feed: true, descartada_at: null, error: null, ...extra })
const estado = (historias = {}) => ({ version: 1, historias })

test('primero el reel de la grilla del último día, después uno de prueba, después lo atrasado', () => {
  const reels = [reel('prueba', 2, false), reel('viejo', 100), reel('hoy', 5)]
  assert.equal(elegir({ reels, estado: estado(), config, ahora: AHORA }).reel?.id, 'hoy')
  assert.equal(elegir({ reels, estado: estado({ hoy: intento(30) }), config, ahora: AHORA }).reel?.id, 'prueba')
  assert.equal(elegir({ reels, estado: estado({ hoy: intento(30), prueba: intento(30) }), config, ahora: AHORA }).reel?.id, 'viejo')
})

test('una sola prueba por día y respeta tope, separación, horario y margen', () => {
  const reels = [reel('p2', 2, false)]
  assert.equal(elegir({ reels, estado: estado({ p1: intento(4, { de_feed: false }) }), config, ahora: AHORA }).reel, null)
  assert.equal(elegir({ reels, estado: estado({ a: intento(4), b: intento(5) }), config, ahora: AHORA }).reel, null)
  assert.equal(elegir({ reels, estado: estado({ a: intento(1) }), config, ahora: AHORA }).reel, null)
  assert.equal(elegir({ reels, estado: estado(), config, ahora: new Date('2026-11-27T11:00:00Z') }).reel, null)
  assert.equal(elegir({ reels: [reel('recien', 0.1)], estado: estado(), config, ahora: AHORA }).reel, null)
})

test('se apaga solo cuando la fábrica publica la cuenta', () => {
  assert.equal(motivoApagado(cuenta, {}), null)
  assert.equal(motivoApagado(cuenta, { FABRICA_ACTIVA_APEX_STACK: '1' }), null)
  assert.match(String(motivoApagado({ ...cuenta, modo: 'real' }, { FABRICA_ACTIVA_APEX_STACK: '1' })), /ya publica/)
  assert.ok(motivoApagado(cuenta, { FABRICA_PAUSADA_APEX_STACK: '1' }))
})

test('un estado ilegible frena en vez de arrancar de cero', () => {
  assert.deepEqual(leerEstado(''), estado())
  assert.throws(() => leerEstado('{"version":2}'))
})

function meta({ publicar = () => ({ id: 'historia-1' }), status = 'FINISHED' } = {}) {
  const llamadas = []
  const f = async (url, init = {}) => {
    const u = new URL(url)
    const metodo = init.method ?? 'GET'
    llamadas.push({ metodo, host: u.host, ruta: u.pathname, params: init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {} })
    const json = (x, s = 200) => new Response(JSON.stringify(x), { status: s })
    if (u.host === 'cdn') return new Response(new Uint8Array([1, 2, 3]))
    if (u.host === 'rupload') return json({ success: true })
    if (u.pathname.endsWith('/178/media') && metodo === 'GET') return json({ data: [{ id: 'r1', timestamp: reel('r1', 5).at, media_product_type: 'REELS', media_url: 'https://cdn/r1.mp4', is_shared_to_feed: true }] })
    if (u.pathname.endsWith('/178/media')) return json({ id: 'cont', uri: 'https://rupload/cont' })
    if (u.pathname.endsWith('/media_publish')) {
      const r = publicar()
      return r.error ? json(r, 400) : json(r)
    }
    if (u.pathname.endsWith('/178')) return json({ username: 'apex.stack' })
    return json({ status_code: status })
  }
  return { f, llamadas }
}

const correr = (g, e, guardados = []) => espejar({ cuenta, config, estado: e, igUser: '178', token: 'EAA', ahora: AHORA, env: {}, fetch: g.f, espera: async () => {}, guardar: (x) => guardados.push(structuredClone(x)) })

test('sube el archivo, publica la historia y guarda el contenedor antes de publicar', async () => {
  const g = meta()
  const guardados = []
  const r = await correr(g, estado(), guardados)
  assert.equal(r.publicada, 'historia-1')
  assert.equal(r.estado.historias.r1.historia_id, 'historia-1')
  assert.equal(guardados[0].historias.r1.ig_container_id, null)
  assert.equal(guardados[1].historias.r1.ig_container_id, 'cont')
  assert.equal(g.llamadas.find((l) => l.metodo === 'POST' && l.ruta.endsWith('/178/media')).params.media_type, 'STORIES')
})

test('si publicar falla a mitad no se vuelve a subir el mismo reel', async () => {
  const r = await correr(meta({ publicar: () => ({ error: { code: 1, message: 'x' } }) }), estado())
  assert.equal(r.fallar, true)
  const g = meta()
  const r2 = await correr(g, r.estado)
  assert.equal(r2.publicada, null)
  assert.ok(r2.estado.historias.r1.descartada_at)
  assert.ok(!g.llamadas.some((l) => l.ruta.endsWith('/media_publish')))
})

test('un intento a mitad que Meta da por PUBLISHED se marca publicado', async () => {
  const r = await correr(meta({ status: 'PUBLISHED' }), estado({ r1: intento(1, { publicado_at: null, historia_id: null }) }))
  assert.ok(r.estado.historias.r1.publicado_at)
  assert.equal(r.publicada, null)
})
