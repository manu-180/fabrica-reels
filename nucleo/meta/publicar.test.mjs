import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publicacionDe } from '../estado.mjs'
import { publicarCuenta, publicadasSinId } from './publicar.mjs'
import { ENV_AR, ENV_WEB, creativo, cuentaAr, cuentaWeb, errorMeta, estadoCon, graphFalso, sinEspera } from '../__fixtures__/ayuda.mjs'

const AHORA = new Date('2026-11-09T16:00:00Z')
const ID = '2026-11-09-a'
const ref = (/** @type {'prueba' | 'normal' | 'historia'} */ destino, variante = 0) => ({ creativo: ID, variante, destino })
const pub = (/** @type {any} */ e, /** @type {'prueba' | 'normal' | 'historia'} */ d, variante = 0) => /** @type {any} */ (publicacionDe(e, ref(d, variante)))

/**
 * @param {{ usado?: number, recientes?: any[] | ((p: Record<string, string>) => any), historias?: any[] | (() => any), crear?: (p: Record<string, string>) => any,
 *   estado?: (id: string) => any, publicar?: (p: Record<string, string>) => any, cuenta?: () => any, limite?: () => any, usuario?: string }} [o]
 */
function meta({ usado = 5, recientes = [], historias = [], crear, estado, publicar, cuenta, limite, usuario = 'prueba.ar' } = {}) {
  let n = 0
  return graphFalso([
    ['GET', /^\/178\/content_publishing_limit$/, () => (limite ? limite() : { data: [{ quota_usage: usado, config: { quota_total: 100, quota_duration: 86400 } }] })],
    ['GET', /^\/178\/media$/, (p) => (typeof recientes === 'function' ? recientes(p) : { data: recientes })],
    ['GET', /^\/178\/stories$/, () => (typeof historias === 'function' ? historias() : { data: historias })],
    ['POST', /^\/178\/media$/, (p) => (crear ? crear(p) : { id: `c-${p.media_type === 'STORIES' ? 'historia' : p.caption.split(' ').at(-1)}` })],
    ['POST', /^\/178\/media_publish$/, (p) => (publicar ? publicar(p) : { id: `m-${p.creation_id.slice(2)}-${++n}` })],
    ['GET', /^\/178$/, () => (cuenta ? cuenta() : { id: '178', username: usuario })],
    ['GET', /^\/(c-[\w-]+)$/, (_, m) => (estado ? estado(String(m[1])) : { status_code: 'FINISHED' })],
    ['GET', /^\/(m-[\w-]+)$/, (_, m) => ({ permalink: `https://www.instagram.com/reel/${m[1]}/` })],
  ])
}

const vencida = { no_antes_de: '2026-11-09T15:30:00.000Z' }
/** Una cuenta que deja publicar más de una por corrida, para los tests que lo necesitan. */
const cuentaLarga = () => ({ ...cuentaAr(), antispam: { ...cuentaAr().antispam, max_por_corrida: 3, gap_min: 0 } })
const correr = (/** @type {any} */ o) => publicarCuenta({ cuenta: cuentaAr(), ahora: AHORA, env: ENV_AR, espera: sinEspera, reloj: () => AHORA, ...o })

test('publica la vencida como reel de prueba MANUAL, una por corrida', async () => {
  const g = meta()
  const e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }, { prueba: { no_antes_de: '2026-11-09T15:40:00.000Z' } }])])
  const r = await correr({ estado: e, fetch: g.fetch })
  assert.deepEqual(r.publicadas, [`${ID}/0/prueba`])
  const [c] = g.llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/178/media')
  assert.equal(c?.params.media_type, 'REELS')
  assert.deepEqual(JSON.parse(c?.params.trial_params ?? '{}'), { graduation_strategy: 'MANUAL' })
  assert.equal(c?.params.share_to_feed, undefined)
  assert.equal(pub(r.estado, 'prueba').ig_media_id, 'm-prueba-1')
  assert.equal(pub(r.estado, 'prueba').permalink, 'https://www.instagram.com/reel/m-prueba-1/')
  assert.equal(pub(r.estado, 'prueba').publicado_at, AHORA.toISOString())
  assert.equal(pub(r.estado, 'prueba', 1).ig_media_id, null)
})

test('el estado se guarda tras cada paso de Meta: el contenedor queda guardado antes de media_publish', async () => {
  /** @type {any[]} */
  const guardados = []
  let alPublicar = null
  const g = meta({ publicar: (p) => {
    alPublicar = structuredClone(guardados.at(-1))
    return { id: `m-${p.creation_id}` }
  } })
  const e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])])
  await correr({ estado: e, fetch: g.fetch, guardar: (/** @type {any} */ x) => guardados.push(structuredClone(x)) })
  assert.equal(pub(alPublicar, 'prueba').ig_container_id, 'c-prueba')
  assert.equal(pub(alPublicar, 'prueba').ig_media_id, null)
  assert.ok(pub(guardados.at(-1), 'prueba').ig_media_id)
})

test('no publica dos veces: si el caption ya está en la media reciente, lo toma de ahí', async () => {
  const g = meta({ recientes: [{ id: '999', caption: `caption ${ID} 0 prueba`, permalink: 'https://www.instagram.com/reel/X/', timestamp: '2026-11-09T13:01:00+0000' }] })
  const r = await correr({ estado: estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])]), fetch: g.fetch })
  assert.equal(pub(r.estado, 'prueba').ig_media_id, '999')
  assert.equal(g.llamadas.filter((l) => l.metodo === 'POST').length, 0)
})

test('FABRICA_PAUSADA, la pausa de la cuenta y el modo sombra frenan sin llamar a Meta', async () => {
  const e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])])
  for (const [env, cuenta, motivo] of /** @type {const} */ ([
    [{ ...ENV_AR, FABRICA_PAUSADA: '1' }, cuentaAr(), /FABRICA_PAUSADA/],
    [{ ...ENV_AR, FABRICA_PAUSADA_PRUEBA_AR: '1' }, cuentaAr(), /FABRICA_PAUSADA_PRUEBA_AR/],
    [ENV_AR, { ...cuentaAr(), modo: 'sombra' }, /sombra/],
    [{}, cuentaAr(), /IG_PRUEBA_AR_USER_ID/],
  ])) {
    const g = meta()
    const r = await correr({ estado: e, fetch: g.fetch, env, cuenta })
    assert.equal(g.llamadas.length, 0)
    assert.match(r.motivo, motivo)
  }
})

test('antispam: lo publicado por otro en la cuenta (D5) cuenta para el tope y el gap', async () => {
  const e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])])
  const ajena = [{ id: 'ajena', caption: 'un reel de demos', permalink: 'p', timestamp: '2026-11-09T15:40:00+0000', media_product_type: 'REELS' }]
  const r = await correr({ estado: e, fetch: meta({ recientes: ajena }).fetch })
  assert.deepEqual(r.publicadas, [])
  assert.match(r.motivo, /hace 20 min/)
  const muchas = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, caption: `ajena ${i}`, permalink: 'p', timestamp: `2026-11-09T0${Math.floor(i / 2)}:${i % 2 ? '30' : '00'}:00+0000`, media_product_type: 'REELS' }))
  const r2 = await correr({ estado: e, fetch: meta({ recientes: muchas }).fetch })
  assert.match(r2.motivo, /12 publicaciones en 24 h/)
  const r3 = await correr({ estado: e, fetch: meta({ usado: 86 }).fetch })
  assert.match(r3.motivo, /cupo/)
  const r4 = await correr({ estado: e, fetch: meta({ usuario: 'otra.cuenta' }).fetch })
  assert.match(r4.motivo, /otra\.cuenta/)
  assert.ok(pub(r4.estado, 'prueba').intentos_publicar === 0)
})

test('token vencido: se pausa con el motivo y el nombre del secreto, y no sigue', async () => {
  const g = meta({ crear: () => errorMeta(190, 'Error validating access token: Session has expired') })
  const r = await correr({ estado: estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])]), fetch: g.fetch })
  assert.match(String(r.estado.pausado), /IG_PRUEBA_AR_TOKEN/)
  assert.equal(r.estado.pausado_por, 'token')
  assert.equal(r.fallar, true)
  assert.equal(pub(r.estado, 'prueba').intentos_publicar, 0)
})

test('pausado por token: si el token volvió a andar, se despausa solo y publica; un bloqueo no', async () => {
  const e = { ...estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])]), pausado: 'token vencido', pausado_por: /** @type {const} */ ('token') }
  const r = await correr({ estado: e, fetch: meta().fetch })
  assert.equal(r.estado.pausado, null)
  assert.equal(r.publicadas.length, 1)
  const r2 = await correr({ estado: { ...e, pausado_por: 'bloqueo', pausado: 'Instagram bloqueó la acción' }, fetch: meta().fetch })
  assert.deepEqual(r2.publicadas, [])
  assert.equal(r2.estado.pausado, 'Instagram bloqueó la acción')
})

test('9/2207078: baja un escalón de la rampa, no cuenta intento, y dos en una semana pausan 48 h', async () => {
  const g = () => meta({ publicar: () => errorMeta(9, 'User is performing too many actions', 2207078) })
  const e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])])
  const r = await correr({ estado: e, fetch: g().fetch })
  assert.equal(r.estado.rampa?.escalon, 0)
  assert.equal(r.estado.rampa?.bajadas.length, 1)
  assert.equal(r.estado.pausado, null)
  assert.equal(pub(r.estado, 'prueba').intentos_publicar, 0)
  assert.equal(pub(r.estado, 'prueba').clase_error, 'antispam')
  assert.match(r.motivo, /antispam/)
  const r2 = await correr({ estado: r.estado, fetch: g().fetch, ahora: new Date('2026-11-09T17:00:00Z'), reloj: () => new Date('2026-11-09T17:00:00Z') })
  assert.equal(r2.estado.pausado_por, 'antispam')
  assert.equal(r2.estado.pausado_hasta, '2026-11-11T17:00:00.000Z')
})

test('cupo de Meta agotado al publicar: espera al próximo tic sin intento ni pausa', async () => {
  const g = meta({ publicar: () => errorMeta(9, "You've reached the maximum number of posts allowed via API", 2207042) })
  const r = await correr({ estado: estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])]), fetch: g.fetch })
  assert.equal(r.estado.pausado, null)
  assert.equal(pub(r.estado, 'prueba').intentos_publicar, 0)
  assert.equal(pub(r.estado, 'prueba').clase_error, 'cupo')
  assert.equal(r.estado.rampa, null)
})

test('bloqueo o spam: se pausa todo y falla la corrida', async () => {
  const g = meta({ publicar: () => errorMeta(9, 'We restrict certain activity to protect our community', 2207051) })
  const r = await correr({ estado: estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])]), fetch: g.fetch })
  assert.equal(r.estado.pausado_por, 'bloqueo')
  assert.equal(r.fallar, true)
})

test('un video que Meta no procesa cuenta intento en esa publicación; a los 3 queda afuera', async () => {
  const g = meta({ estado: () => ({ status_code: 'ERROR', status: 'Error: 2207026 unsupported format' }) })
  let e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])])
  for (let k = 1; k <= 3; k++) {
    e = (await correr({ estado: e, fetch: g.fetch })).estado
    assert.equal(pub(e, 'prueba').intentos_publicar, k)
  }
  const r = await correr({ estado: e, fetch: g.fetch })
  assert.match(r.motivo, /nada vencido/)
})

test('Meta rechaza los reels de prueba en la cuenta: se apaga sólo ese destino y la normal sale en su lugar', async () => {
  const g = meta({ crear: (p) => (p.trial_params ? errorMeta(100, 'Invalid parameter: trial_params is not supported for this user') : { id: 'c-normal' }) })
  const e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida, normal: {}, historia: {} }])])
  const r = await correr({ estado: e, fetch: g.fetch, cuenta: cuentaLarga() })
  assert.equal(r.estado.pausado, null)
  assert.ok(r.estado.destinos_apagados.prueba)
  assert.equal(pub(r.estado, 'prueba').intentos_publicar, 0)
  assert.deepEqual(r.publicadas, [`${ID}/0/normal`])
  const normal = g.llamadas.find((l) => l.metodo === 'POST' && l.ruta === '/178/media' && !l.params.trial_params)
  assert.equal(normal?.params.share_to_feed, 'true')
  assert.ok(pub(r.estado, 'historia').no_antes_de, 'la historia queda con su reloj desde la normal')
})

test('el mismo video sale como prueba y como normal con captions distintos y la normal espera su reloj', async () => {
  const g = meta()
  const e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida, normal: {}, historia: {} }])])
  const r = await correr({ estado: e, fetch: g.fetch, reloj: () => new Date('2026-11-09T15:50:00Z') })
  assert.deepEqual(r.publicadas, [`${ID}/0/prueba`])
  const reloj = Date.parse(pub(r.estado, 'normal').no_antes_de)
  assert.ok(reloj >= Date.parse('2026-11-09T16:53:00Z') && reloj <= Date.parse('2026-11-09T17:16:00Z'), pub(r.estado, 'normal').no_antes_de)
  const g2 = meta({ recientes: [{ id: 'm-prueba-1', caption: `caption ${ID} 0 prueba`, permalink: 'p', timestamp: '2026-11-09T15:50:00+0000' }] })
  assert.deepEqual((await correr({ estado: r.estado, fetch: g2.fetch, ahora: new Date('2026-11-09T16:40:00Z') })).publicadas, [])
  const tarde = new Date(reloj + 60_000)
  const r3 = await correr({ estado: r.estado, fetch: g2.fetch, ahora: tarde, reloj: () => tarde })
  assert.deepEqual(r3.publicadas, [`${ID}/0/normal`])
  const [normal] = g2.llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/178/media')
  assert.equal(normal?.params.share_to_feed, 'true')
  assert.equal(normal?.params.caption, `caption ${ID} 0 normal`)
})

test('historia: el mp4 de historia como STORIES, sin caption; el contenedor se pide con creando_at ya guardado', async () => {
  /** @type {any[]} */
  const guardados = []
  const g = meta({ usuario: 'prueba.web' })
  const c = creativo(ID, [{ historia: vencida }])
  c.variantes[0].video_historia_url = 'https://x.public.blob.vercel-storage.com/videos/h.mp4'
  const r = await publicarCuenta({ cuenta: cuentaWeb(), estado: estadoCon('prueba-web', [c]), ahora: AHORA, env: ENV_WEB, fetch: g.fetch, espera: sinEspera, reloj: () => AHORA, guardar: (/** @type {any} */ x) => guardados.push(structuredClone(x)) })
  assert.deepEqual(r.publicadas, [`${ID}/0/historia`])
  const [creado] = g.llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/178/media')
  assert.deepEqual(creado?.params, { media_type: 'STORIES', video_url: 'https://x.public.blob.vercel-storage.com/videos/h.mp4' })
  const antesDePedir = guardados.find((x) => pub(x, 'historia').creando_at && !pub(x, 'historia').ig_container_id)
  assert.ok(antesDePedir, 'creando_at guardado antes del POST')
})

test('historia con el contenedor perdido: si la historia está en /stories se toma; si no, ese día no se reintenta', async () => {
  const e = estadoCon('prueba-ar', [creativo(ID, [{ historia: { ...vencida, creando_at: '2026-11-09T15:20:00.000Z' } }])])
  const g = meta({ historias: [{ id: 's-1', timestamp: '2026-11-09T15:21:30+0000' }] })
  const r = await correr({ estado: e, fetch: g.fetch })
  assert.equal(pub(r.estado, 'historia').ig_media_id, 's-1')
  assert.equal(g.llamadas.filter((l) => l.metodo === 'POST').length, 0)
  const g2 = meta({ historias: [{ id: 's-vieja', timestamp: '2026-11-09T10:00:00+0000' }] })
  const r2 = await correr({ estado: e, fetch: g2.fetch })
  assert.equal(g2.llamadas.filter((l) => l.metodo === 'POST').length, 0)
  assert.ok(pub(r2.estado, 'historia').descartada_at)
  assert.match(String(pub(r2.estado, 'historia').motivo_descarte), /se perdió/)
})

test('historia con su contenedor EXPIRED: antes de pedir otro se busca en /stories (segunda red)', async () => {
  const e = estadoCon('prueba-ar', [creativo(ID, [{ historia: { ...vencida, creando_at: '2026-11-09T15:20:00.000Z', ig_container_id: 'c-viejo' } }])])
  const g = meta({ estado: () => ({ status_code: 'EXPIRED' }), historias: [{ id: 's-9', timestamp: '2026-11-09T15:25:00+0000' }] })
  const despues = new Date('2026-11-09T16:20:00Z')
  const r = await correr({ estado: e, fetch: g.fetch, ahora: despues, reloj: () => despues })
  assert.equal(pub(r.estado, 'historia').ig_media_id, 's-9')
  assert.equal(g.llamadas.filter((l) => l.metodo === 'POST').length, 0)
})

test('historia que Meta no permite: se apaga el destino historia, no pausa y lo demás sigue', async () => {
  const g = meta({ crear: (p) => (p.media_type === 'STORIES' ? errorMeta(10, 'Application does not have permission for this action') : { id: 'c-prueba' }) })
  const e = estadoCon('prueba-ar', [creativo(ID, [{ historia: { no_antes_de: '2026-11-09T15:20:00.000Z' } }, { prueba: vencida }])])
  const r = await correr({ estado: e, fetch: g.fetch, cuenta: cuentaLarga() })
  assert.equal(r.estado.pausado, null)
  assert.equal(r.fallar, false)
  assert.ok(r.estado.destinos_apagados.historia)
  assert.ok(pub(r.estado, 'historia').descartada_at)
  assert.deepEqual(r.publicadas, [`${ID}/1/prueba`])
})

for (const [nombre, falla] of [
  ['un 500 transitorio', { __status: 500, error: { code: 1, message: 'An unknown error occurred', is_transient: true } }],
  ['el 100/GraphMethodException', { error: { code: 100, message: 'Unsupported get request (GraphMethodException)' } }],
]) {
  test(`contenedor guardado que no se puede leer (${nombre}): no se crea otro hasta saber qué pasó`, async () => {
    const g = meta({ estado: (id) => (id === 'c-viejo' ? falla : { status_code: 'FINISHED' }) })
    const r = await correr({ estado: estadoCon('prueba-ar', [creativo(ID, [{ prueba: { ...vencida, ig_container_id: 'c-viejo' } }])]), fetch: g.fetch })
    assert.deepEqual(r.publicadas, [])
    assert.equal(g.llamadas.filter((l) => l.metodo === 'POST').length, 0)
    assert.equal(pub(r.estado, 'prueba').intentos_publicar, 0)
    assert.equal(pub(r.estado, 'prueba').ig_container_id, 'c-viejo')
    assert.match(String(pub(r.estado, 'prueba').error_publicar), /contenedor/)
  })
}

test('contenedor guardado ya PUBLISHED: no se vuelve a publicar y la media se toma por caption cuando aparece', async () => {
  /** @type {any[]} */
  let lista = []
  const g = meta({ estado: () => ({ status_code: 'PUBLISHED' }), recientes: () => ({ data: lista }) })
  const e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: { ...vencida, ig_container_id: 'c-viejo' } }])])
  const r = await correr({ estado: e, fetch: g.fetch })
  assert.equal(g.llamadas.filter((l) => l.metodo === 'POST').length, 0)
  assert.ok(pub(r.estado, 'prueba').publicado_at)
  assert.equal(pub(r.estado, 'prueba').ig_media_id, null)
  assert.deepEqual(publicadasSinId(r.estado, AHORA), [ref('prueba')])
  lista = [{ id: '555', caption: `caption ${ID} 0 prueba`, permalink: 'https://www.instagram.com/reel/Y/', timestamp: '2026-11-09T15:31:00+0000' }]
  const r2 = await correr({ estado: r.estado, fetch: g.fetch, ahora: new Date('2026-11-09T18:00:00Z') })
  assert.equal(pub(r2.estado, 'prueba').ig_media_id, '555')
  assert.equal(g.llamadas.filter((l) => l.metodo === 'POST').length, 0)
})

test('contenedor guardado EXPIRED o ERROR: ahí sí va uno nuevo', async () => {
  for (const status of ['EXPIRED', 'ERROR']) {
    const g = meta({ estado: (id) => (id === 'c-viejo' ? { status_code: status } : { status_code: 'FINISHED' }) })
    const r = await correr({ estado: estadoCon('prueba-ar', [creativo(ID, [{ prueba: { ...vencida, ig_container_id: 'c-viejo' } }])]), fetch: g.fetch })
    assert.equal(r.publicadas.length, 1, status)
    assert.equal(pub(r.estado, 'prueba').ig_container_id, 'c-prueba')
  }
})

test('"media not ready" al publicar: se reintenta sin contar intento y el contenedor se reusa', async () => {
  const g = meta({ publicar: () => errorMeta(9007, 'Media ID is not available', 2207027) })
  const e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])])
  const r = await correr({ estado: e, fetch: g.fetch })
  assert.equal(pub(r.estado, 'prueba').intentos_publicar, 0)
  assert.equal(pub(r.estado, 'prueba').ig_container_id, 'c-prueba')
  const g2 = meta()
  const r2 = await correr({ estado: r.estado, fetch: g2.fetch })
  assert.equal(r2.publicadas.length, 1)
  assert.equal(g2.llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/178/media').length, 0)
})

test('errores de Meta fuera de una publicación: token, permiso o bloqueo pausan; otro cuenta fallas seguidas', async () => {
  for (const [error, por] of /** @type {const} */ ([
    [{ code: 10, message: 'Application does not have permission for this action' }, 'permiso'],
    [{ code: 190, message: 'Error validating access token' }, 'token'],
    [{ code: 9, error_subcode: 2207051, message: 'We restrict certain activity' }, 'bloqueo'],
  ])) {
    const r = await correr({ estado: estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])]), fetch: meta({ limite: () => ({ error }) }).fetch })
    assert.equal(r.estado.pausado_por, por)
    assert.equal(r.fallar, true, por)
  }
  let e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])])
  for (const [vuelta, falla] of [[1, false], [2, false], [3, true]]) {
    const r = await correr({ estado: e, fetch: meta({ limite: () => errorMeta(100, "Object with ID '178' does not exist") }).fetch })
    assert.equal(r.estado.fallas_seguidas, vuelta)
    assert.equal(r.fallar, falla)
    e = r.estado
  }
  const sano = await correr({ estado: e, fetch: meta().fetch })
  assert.equal(sano.publicadas.length, 1)
  assert.equal(sano.estado.fallas_seguidas, 0)
})

test('ya: publica la próxima de hoy aunque no haya vencido; lo vencido de otro día se descarta antes', async () => {
  const e = estadoCon('prueba-ar', [creativo(ID, [{ prueba: { no_antes_de: '2026-11-09T22:00:00.000Z' } }]), creativo('2026-11-08-b', [{ prueba: { no_antes_de: '2026-11-08T22:00:00.000Z' } }])])
  const r = await correr({ estado: e, fetch: meta().fetch, ya: true })
  assert.deepEqual(r.publicadas, [`${ID}/0/prueba`])
  assert.ok(publicacionDe(r.estado, { creativo: '2026-11-08-b', variante: 0, destino: 'prueba' })?.descartada_at)
})

test('la deduplicación mira las últimas 48 h de media, paginando hasta 150', async () => {
  /** @param {number} desde @param {number} n @param {number} cada */
  const medias = (desde, n, cada) => Array.from({ length: n }, (_, i) => ({ id: `x${desde + i}`, caption: `otro ${desde + i}`, permalink: 'p', timestamp: new Date(AHORA.getTime() - (desde + i + 3) * cada * 60_000).toISOString().replace(/\.\d+Z$/, '+0000') }))
  const paginas = /** @type {Record<string, any>} */ ({
    '': { data: medias(0, 50, 20), paging: { cursors: { after: 'p2' }, next: 'https://graph/p2' } },
    p2: { data: [...medias(50, 49, 20), { id: '777', caption: `caption ${ID} 0 prueba`, permalink: 'https://www.instagram.com/reel/Z/', timestamp: '2026-11-08T20:00:00+0000' }], paging: { cursors: { after: 'p3' }, next: 'https://graph/p3' } },
    p3: { data: medias(100, 50, 20), paging: { cursors: { after: 'p4' }, next: 'https://graph/p4' } },
    p4: { data: medias(150, 50, 20) },
  })
  const g = meta({ recientes: (p) => paginas[p.after ?? ''] })
  const r = await correr({ estado: estadoCon('prueba-ar', [creativo(ID, [{ prueba: vencida }])]), fetch: g.fetch, cuenta: { ...cuentaAr(), antispam: { ...cuentaAr().antispam, max_dia: 50, gap_min: 0 } } })
  assert.equal(pub(r.estado, 'prueba').ig_media_id, '777')
  assert.equal(g.llamadas.filter((l) => l.metodo === 'POST').length, 0)
  assert.deepEqual(g.llamadas.filter((l) => l.ruta === '/178/media' && l.metodo === 'GET').map((l) => l.params.after ?? ''), ['', 'p2', 'p3'])
})
