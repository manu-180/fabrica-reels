import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publicacionDe } from '../estado.mjs'
import { contarClave, medir, preguntasDe } from './medir.mjs'
import { ENV_WEB, creativo, cuentaAr, cuentaWeb, errorMeta, estadoCon, graphFalso, sinEspera } from '../__fixtures__/ayuda.mjs'

const AHORA = new Date('2026-11-12T16:00:00Z')
const publicada = (/** @type {string} */ media, /** @type {string} */ cuando) => ({ ig_media_id: media, publicado_at: cuando, no_antes_de: cuando })
const m = (/** @type {any} */ e, /** @type {string} */ id, /** @type {number} */ v, /** @type {any} */ d) => /** @type {any} */ (publicacionDe(e, { creativo: id, variante: v, destino: d }))

/** @param {{ insights?: 'sin-permiso' | 'ok' }} [o] */
function metaMedir({ insights = 'sin-permiso' } = {}) {
  return graphFalso([
    ['GET', /^\/178$/, () => ({ id: '178', username: 'prueba.web' })],
    ['GET', /^\/h\d+\/insights$/, () => ({ data: [
      { name: 'reach', total_value: { value: 40 } }, { name: 'replies', total_value: { value: 3 } }, { name: 'shares', total_value: { value: 1 } },
      { name: 'navigation', total_value: { value: 50, breakdowns: [{ results: [{ dimension_values: ['TAP_FORWARD'], value: 30 }, { dimension_values: ['TAP_EXIT'], value: 8 }] }] } },
    ] })],
    ['GET', /^\/\d+\/insights$/, () => (insights === 'ok' ? { data: [{ name: 'reach', values: [{ value: 10 }] }] } : errorMeta(10, 'Application does not have permission for this action'))],
    ['GET', /^\/$/, (p) => {
      const ids = String(p.ids).split(',')
      if (String(p.fields).startsWith('comments')) {
        return Object.fromEntries(ids.map((id) => [id, { id, comments: { data: [{ text: 'WEB', username: 'ana' }, { text: 'web porfa', username: 'beto' }, { text: 'WEB', username: 'prueba.web' }, { text: '¿cuánto sale? escribime a ana@mail.com', username: 'caro' }] } }]))
      }
      const conInsights = String(p.fields).includes('insights')
      return Object.fromEntries(ids.map((id) => [id, {
        id, like_count: 2, comments_count: id === '111' ? 4 : 0, permalink: `https://www.instagram.com/reel/${id}/`,
        ...(conInsights ? { insights: { data: [
          { name: 'views', values: [{ value: 150 }] }, { name: 'reach', values: [{ value: 120 }] }, { name: 'shares', values: [{ value: 1 }] },
          { name: 'saved', values: [{ value: 0 }] }, { name: 'ig_reels_avg_watch_time', values: [{ value: 5230 }] },
        ] } } : {}),
      }]))
    }],
  ])
}

const medirWeb = (/** @type {any} */ o) => medir({ cuenta: cuentaWeb(), ahora: AHORA, env: ENV_WEB, espera: sinEspera, ...o })

test('medir: pocas llamadas, sin insights quedan null y WEB se cuenta sin la cuenta propia', async () => {
  const e = estadoCon('prueba-web', [
    creativo('2026-11-12-a', [{ prueba: publicada('111', '2026-11-12T13:00:00.000Z'), normal: publicada('222', '2026-11-12T14:00:00.000Z') }]),
    creativo('2026-10-20-b', [{ prueba: publicada('333', '2026-10-20T14:00:00.000Z') }]),
  ])
  const g = metaMedir()
  const r = await medirWeb({ estado: e, fetch: g.fetch })
  assert.equal(r.medidas, 2)
  assert.equal(r.estado.insights.disponible, false)
  assert.match(String(r.estado.insights.motivo), /instagram_manage_insights/)
  const p = m(r.estado, '2026-11-12-a', 0, 'prueba').metricas
  assert.equal(p.likes, 2)
  assert.equal(p.comentarios, 4)
  assert.equal(p.comentarios_web, 2)
  assert.equal(p.vistas, null)
  assert.equal(p.alcance, null)
  assert.equal(p.respuestas, null)
  assert.equal(m(r.estado, '2026-11-12-a', 0, 'normal').metricas.comentarios_web, 0)
  assert.equal(m(r.estado, '2026-10-20-b', 0, 'prueba').metricas, null)
  assert.ok(g.llamadas.length <= 4, `${g.llamadas.length} llamadas`)
})

test('medir: los comentarios con pregunta quedan sin datos de nadie (el estado es público)', async () => {
  const e = estadoCon('prueba-web', [creativo('2026-11-12-a', [{ prueba: publicada('111', '2026-11-12T13:00:00.000Z') }])])
  const r = await medirWeb({ estado: e, fetch: metaMedir().fetch })
  assert.deepEqual(m(r.estado, '2026-11-12-a', 0, 'prueba').metricas.preguntas, ['¿cuánto sale? escribime a [mail]'])
  assert.deepEqual(preguntasDe([{ text: '@juan mirá esto? llamame al 11 3427-2488', username: 'x' }], 'yo'), ['@… mirá esto? llamame al [número]'])
  assert.equal(contarClave([{ text: 'quiero mi Web', username: 'a' }, { text: 'website', username: 'b' }], 'yo', 'WEB'), 1)
})

test('medir: con insights llena todo, y la foto de 72 h se congela una sola vez', async () => {
  const e = estadoCon('prueba-web', [creativo('2026-11-09-a', [{ prueba: publicada('111', '2026-11-09T13:00:00.000Z') }]), creativo('2026-11-12-b', [{ prueba: publicada('112', '2026-11-12T13:00:00.000Z') }])])
  const r = await medirWeb({ estado: e, fetch: metaMedir({ insights: 'ok' }).fetch })
  assert.equal(r.estado.insights.disponible, true)
  const vieja = m(r.estado, '2026-11-09-a', 0, 'prueba')
  assert.deepEqual({ ...vieja.metricas, preguntas: null }, {
    medido_at: AHORA.toISOString(), vistas: 150, alcance: 120, likes: 2, comentarios: 4, compartidos: 1, guardados: 0, comentarios_web: 2, promedio_visto_s: 5.23,
    respuestas: null, avances: null, salidas: null, preguntas: null,
  })
  assert.deepEqual(vieja.metricas_72h, vieja.metricas)
  assert.equal(m(r.estado, '2026-11-12-b', 0, 'prueba').metricas_72h, null)
  const despues = await medirWeb({ estado: r.estado, fetch: metaMedir({ insights: 'ok' }).fetch, ahora: new Date('2026-11-13T16:00:00Z') })
  assert.equal(m(despues.estado, '2026-11-09-a', 0, 'prueba').metricas_72h.medido_at, AHORA.toISOString())
})

test('medir: las historias se miden antes de las 24 h con insights (foto a las 20 h); sin palabra clave no hay comentarios_web', async () => {
  const e = estadoCon('prueba-web', [creativo('2026-11-11-h', [{ historia: publicada('h1', '2026-11-11T19:00:00.000Z') }]), creativo('2026-11-10-h', [{ historia: publicada('h2', '2026-11-10T19:00:00.000Z') }])])
  const g = metaMedir({ insights: 'ok' })
  const r = await medirWeb({ estado: e, fetch: g.fetch })
  const h = m(r.estado, '2026-11-11-h', 0, 'historia')
  assert.equal(h.metricas.alcance, 40)
  assert.equal(h.metricas.respuestas, 3)
  assert.equal(h.metricas.avances, 30)
  assert.equal(h.metricas.salidas, 8)
  assert.deepEqual(h.metricas_72h, h.metricas)
  assert.equal(m(r.estado, '2026-11-10-h', 0, 'historia').metricas, null)
  const sinClave = estadoCon('prueba-ar', [creativo('2026-11-12-a', [{ prueba: publicada('111', '2026-11-12T13:00:00.000Z') }])])
  const r2 = await medir({ cuenta: cuentaAr(), estado: sinClave, ahora: AHORA, env: { IG_PRUEBA_AR_USER_ID: '178', IG_PRUEBA_AR_TOKEN: 't' }, fetch: metaMedir().fetch, espera: sinEspera })
  assert.equal(m(r2.estado, '2026-11-12-a', 0, 'prueba').metricas.comentarios_web, null)
})

test('medir: con un token de estadísticas aparte, mide con ese y no con el que publica', async () => {
  const e = estadoCon('prueba-web', [creativo('2026-11-12-a', [{ prueba: publicada('111', '2026-11-12T13:00:00.000Z') }])])
  const g = metaMedir({ insights: 'ok' })
  const r = await medirWeb({ estado: e, fetch: g.fetch, env: { ...ENV_WEB, IG_PRUEBA_WEB_INSIGHTS: 'EAAinsights' } })
  assert.equal(r.estado.insights.disponible, true)
  assert.ok(g.llamadas.every((l) => l.token === 'EAAinsights'))
})
