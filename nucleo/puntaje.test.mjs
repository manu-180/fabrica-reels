import assert from 'node:assert/strict'
import { test } from 'node:test'
import { puntuar } from './puntaje.mjs'
import { creativo, cuentaWeb, estadoCon } from './__fixtures__/ayuda.mjs'

const AHORA = new Date('2026-11-20T12:00:00Z')
/** @param {Partial<import('./estado.mjs').Metricas>} m */
const metricas = (m) => ({ medido_at: 'x', vistas: null, alcance: null, likes: null, comentarios: null, compartidos: null, guardados: null, comentarios_web: null, promedio_visto_s: null, respuestas: null, avances: null, salidas: null, preguntas: null, ...m })
/** @param {string} id @param {string} tema @param {Partial<import('./estado.mjs').Metricas>} m */
const medido = (id, tema, m) => creativo(id, [{ prueba: { ig_media_id: id, publicado_at: `${id.slice(0, 10)}T15:00:00.000Z`, metricas_72h: metricas(m) } }], { tema })

test('puntuar sin insights: percentil de likes + 3 comentarios + 10 WEB dentro de destino y día, y temas bayesianos', () => {
  const e = estadoCon('prueba-web', [medido('2026-11-10-a', 'sobrino', { likes: 10, comentarios_web: 2 }), medido('2026-11-10-b', 'celular', { likes: 1 }), medido('2026-11-11-c', 'celular', { likes: 50 })])
  const r = puntuar({ estado: e, cuenta: cuentaWeb(), ahora: AHORA })
  assert.equal(r.con_insights, false)
  assert.equal(r.publicaciones['2026-11-10-a/0/prueba'], 1)
  assert.equal(r.publicaciones['2026-11-10-b/0/prueba'], 0)
  assert.equal(r.publicaciones['2026-11-11-c/0/prueba'], 0.5)
  assert.deepEqual(r.temas.sobrino, { puntaje: 0.25, n: 1 })
  assert.deepEqual(r.temas.celular, { puntaje: 0.1, n: 2 })
})

test('puntuar con insights: z dentro del destino con retención, compartidos, guardados, comentarios, likes y WEB', () => {
  const e = { ...estadoCon('prueba-web', [
    medido('2026-11-10-a', 'sobrino', { alcance: 100, promedio_visto_s: 15, compartidos: 5, guardados: 3, comentarios: 2, likes: 10, comentarios_web: 2 }),
    medido('2026-11-11-b', 'celular', { alcance: 100, promedio_visto_s: 5, compartidos: 0, guardados: 0, comentarios: 0, likes: 2, comentarios_web: 0 }),
  ]), insights: { disponible: true, motivo: null } }
  const r = puntuar({ estado: e, cuenta: cuentaWeb(), ahora: AHORA })
  assert.equal(r.con_insights, true)
  assert.ok(/** @type {number} */ (r.publicaciones['2026-11-10-a/0/prueba']) > 0)
  assert.ok(/** @type {number} */ (r.publicaciones['2026-11-11-b/0/prueba']) < 0)
  assert.equal(r.creativos['2026-11-10-a'], r.publicaciones['2026-11-10-a/0/prueba'])
})

test('puntuar: sin datos, null', () => {
  const r = puntuar({ estado: estadoCon('prueba-web', [creativo('2026-11-10-a', [{ prueba: {} }])]), cuenta: cuentaWeb(), ahora: AHORA })
  assert.equal(r.publicaciones['2026-11-10-a/0/prueba'], null)
  assert.equal(r.creativos['2026-11-10-a'], null)
  assert.deepEqual(r.temas, {})
})
