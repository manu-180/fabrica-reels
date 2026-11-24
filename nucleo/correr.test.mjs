import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AUTOR, crearGuardar, empujarEstado, fusionarArchivos, guionesDisponibles, matrizDe, planCuenta, rutaRelEstado } from './correr.mjs'
import { MAX_INTENTOS, estadoVacio, leerEstado, serializarEstado } from './estado.mjs'
import { RAIZ, creativo, cuentaAr, cuentaWeb, estadoCon } from './__fixtures__/ayuda.mjs'

const AHORA = new Date('2026-11-09T16:00:00Z')
const TARDE = new Date('2026-11-09T20:05:00Z')

test('planCuenta: varias cuentas, cada una con lo suyo, y la matriz sólo con las que tienen algo que hacer', () => {
  const ar = cuentaAr()
  const web = cuentaWeb()
  const conVencida = estadoCon('prueba-web', [creativo('2026-11-09-a', [{ prueba: { no_antes_de: '2026-11-09T15:30:00.000Z' } }])])
  const planes = [
    planCuenta({ cuenta: ar, estado: estadoCon('prueba-ar', []), ahora: TARDE, env: {}, disponibles: 4 }),
    planCuenta({ cuenta: web, estado: conVencida, ahora: AHORA, env: {}, disponibles: 2 }),
    planCuenta({ cuenta: { ...ar, id: 'apagada', activa: false }, estado: estadoVacio('apagada'), ahora: AHORA, env: {}, disponibles: 4 }),
  ]
  assert.deepEqual(planes.map((p) => [p.cuenta, p.producir, p.publicar, p.medir]), [['prueba-ar', true, false, false], ['prueba-web', true, true, false], ['apagada', false, false, false]])
  assert.deepEqual(matrizDe(planes), { include: [{ cuenta: 'prueba-ar', producir: true, publicar: false, medir: false }, { cuenta: 'prueba-web', producir: true, publicar: true, medir: false }] })
})

test('planCuenta: pausas, sombra, banco vacío y la pausa por token que se prueba en cada tic', () => {
  const web = cuentaWeb()
  const e = estadoCon('prueba-web', [creativo('2026-11-09-a', [{ prueba: { no_antes_de: '2026-11-09T22:00:00.000Z' } }])])
  assert.equal(planCuenta({ cuenta: web, estado: e, ahora: AHORA, env: { FABRICA_PAUSADA_PRUEBA_WEB: '1' }, disponibles: 2 }).producir, false)
  assert.equal(planCuenta({ cuenta: web, estado: e, ahora: AHORA, env: {}, disponibles: 2 }).publicar, false)
  const token = { ...e, pausado: 'token vencido', pausado_por: /** @type {const} */ ('token') }
  assert.equal(planCuenta({ cuenta: web, estado: token, ahora: AHORA, env: {}, disponibles: 2 }).publicar, true)
  const bloqueo = { ...e, pausado: 'bloqueo', pausado_por: /** @type {const} */ ('bloqueo') }
  assert.equal(planCuenta({ cuenta: web, estado: bloqueo, ahora: AHORA, env: {}, disponibles: 2 }).publicar, false)
  const vencida = { ...e, pausado: 'antispam', pausado_por: /** @type {const} */ ('antispam'), pausado_hasta: '2026-11-09T10:00:00.000Z' }
  assert.equal(planCuenta({ cuenta: web, estado: vencida, ahora: AHORA, env: {}, disponibles: 2 }).publicar, true)
  const sombra = planCuenta({ cuenta: { ...web, modo: 'sombra' }, estado: estadoCon('prueba-web', [creativo('2026-11-09-a', [{ prueba: { no_antes_de: '2026-11-09T15:00:00.000Z' } }])]), ahora: AHORA, env: {}, disponibles: 2 })
  assert.equal(sombra.publicar, false)
  assert.equal(sombra.producir, true)
  const vacio = planCuenta({ cuenta: web, estado: estadoVacio('prueba-web'), ahora: TARDE, env: {}, disponibles: 0 })
  assert.equal(vacio.producir, false)
  assert.ok(vacio.avisos.some((a) => /banco vacío/.test(a)))
  const reintento = estadoCon('prueba-web', [creativo('2026-11-10-a', [], { producido_at: null, error: 'boom', intentos: 1 })])
  assert.equal(planCuenta({ cuenta: web, estado: reintento, ahora: TARDE, env: {}, disponibles: 0 }).producir, true)
  const definitiva = estadoCon('prueba-web', [creativo('2026-11-10-a', [], { producido_at: null, error: 'boom', intentos: MAX_INTENTOS })])
  assert.equal(planCuenta({ cuenta: web, estado: definitiva, ahora: TARDE, env: {}, disponibles: 3 }).producir, false)
  const medida = estadoCon('prueba-web', [creativo('2026-11-05-a', [{ prueba: { ig_media_id: '1', publicado_at: '2026-11-05T15:00:00.000Z' } }])])
  assert.equal(planCuenta({ cuenta: web, estado: medida, ahora: AHORA, env: {}, disponibles: 2 }).medir, true)
})

test('guionesDisponibles: los del banco de la cuenta que su formato acepta', async () => {
  const r = await guionesDisponibles({ cuenta: cuentaAr(), estado: estadoVacio('prueba-ar'), raiz: RAIZ, hoy: '2026-11-10' })
  assert.equal(r.total, 4)
  assert.equal(r.disponibles.length, 4)
})

test('fusionarArchivos: base, rama remota y lo propio; sin base (rama nueva) también; sin cambios, la rama tal cual', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fusion-'))
  const ruta = (/** @type {string} */ n) => join(dir, n)
  const base = estadoCon('prueba-ar', [creativo('2026-11-09-a', [{ prueba: {}, normal: {} }])])
  const remoto = structuredClone(base)
  remoto.creativos['2026-11-09-b'] = creativo('2026-11-09-b', [])
  const propio = structuredClone(base)
  propio.creativos['2026-11-09-a'].variantes[0].publicaciones.prueba.ig_media_id = '77'
  writeFileSync(ruta('base.json'), serializarEstado(base))
  writeFileSync(ruta('remoto.json'), serializarEstado(remoto))
  writeFileSync(ruta('propio.json'), serializarEstado(propio))
  fusionarArchivos({ base: ruta('base.json'), remoto: ruta('remoto.json'), propio: ruta('propio.json'), salida: ruta('salida.json') })
  const f = leerEstado(readFileSync(ruta('salida.json'), 'utf8'), 'prueba-ar')
  assert.ok(f.creativos['2026-11-09-b'])
  assert.equal(f.creativos['2026-11-09-a'].variantes[0].publicaciones.prueba?.ig_media_id, '77')
  fusionarArchivos({ base: ruta('no-existe.json'), remoto: ruta('tampoco.json'), propio: ruta('propio.json'), salida: ruta('nueva.json') })
  assert.equal(leerEstado(readFileSync(ruta('nueva.json'), 'utf8'), 'prueba-ar').creativos['2026-11-09-a'].variantes[0].publicaciones.prueba?.ig_media_id, '77')
  writeFileSync(ruta('igual.json'), serializarEstado({ ...remoto, actualizado: '2026-11-09T20:00:00.000Z' }))
  fusionarArchivos({ base: ruta('remoto.json'), remoto: ruta('remoto.json'), propio: ruta('igual.json'), salida: ruta('sin-cambios.json') })
  assert.equal(readFileSync(ruta('sin-cambios.json'), 'utf8'), readFileSync(ruta('remoto.json'), 'utf8'))
  writeFileSync(ruta('roto.json'), '{ no')
  assert.throws(() => fusionarArchivos({ base: ruta('base.json'), remoto: ruta('roto.json'), propio: ruta('propio.json'), salida: ruta('x.json') }))
})

/** Un origen pelado con la rama `estado` y dos clones: el de esta corrida y el de otra cuenta que pushea en el medio. */
function repos() {
  const raiz = mkdtempSync(join(tmpdir(), 'estado-git-'))
  const git = (/** @type {string} */ dir, /** @type {string[]} */ args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const origen = join(raiz, 'origen.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'estado', origen])
  const otro = join(raiz, 'otro')
  execFileSync('git', ['clone', '-q', origen, otro], { stdio: 'ignore' })
  git(otro, ['checkout', '-q', '-b', 'estado'])
  mkdirSync(join(otro, 'cuentas', 'prueba-web'), { recursive: true })
  writeFileSync(join(otro, 'cuentas', 'prueba-web', 'estado.json'), serializarEstado(estadoVacio('prueba-web')))
  git(otro, ['add', '.'])
  git(otro, ['commit', '-q', '-m', 'inicio'])
  git(otro, ['push', '-q', 'origin', 'estado'])
  const mio = join(raiz, 'mio')
  execFileSync('git', ['clone', '-q', '-b', 'estado', origen, mio], { stdio: 'ignore' })
  return { origen, otro, mio, git }
}

test('empujarEstado: commit con el autor de siempre sobre la punta remota, fusionando lo que pushearon en el medio, sin force push', async () => {
  const { otro, mio, git } = repos()
  const base = estadoVacio('prueba-ar')
  const propio = estadoCon('prueba-ar', [creativo('2026-11-09-a', [{ prueba: { ig_container_id: 'c-1' } }])])
  const r = await empujarEstado({ dir: mio, cuentaId: 'prueba-ar', base, propio, mensaje: 'estado prueba-ar: contenedor', espera: async () => {} })
  assert.equal(r.empujado, true)
  git(otro, ['pull', '-q', 'origin', 'estado'])
  assert.equal(leerEstado(readFileSync(join(otro, rutaRelEstado('prueba-ar')), 'utf8'), 'prueba-ar').creativos['2026-11-09-a'].variantes[0].publicaciones.prueba?.ig_container_id, 'c-1')
  assert.equal(git(otro, ['log', '-1', '--format=%an <%ae>']).trim(), `${AUTOR.nombre} <${AUTOR.mail}>`)

  // Otra corrida de la misma cuenta pushea métricas mientras esta publica.
  const remoto = structuredClone(r.estado)
  remoto.creativos['2026-11-09-a'].variantes[0].publicaciones.prueba.metricas = /** @type {any} */ ({ likes: 3 })
  writeFileSync(join(otro, rutaRelEstado('prueba-ar')), serializarEstado(remoto))
  git(otro, ['commit', '-qam', 'metricas'])
  git(otro, ['push', '-q', 'origin', 'estado'])
  const propio2 = structuredClone(r.estado)
  Object.assign(propio2.creativos['2026-11-09-a'].variantes[0].publicaciones.prueba, { ig_media_id: 'm-1', publicado_at: '2026-11-09T16:00:00.000Z' })
  const r2 = await empujarEstado({ dir: mio, cuentaId: 'prueba-ar', base: r.estado, propio: propio2, mensaje: 'estado prueba-ar: publicada', espera: async () => {} })
  assert.equal(r2.empujado, true)
  const p = r2.estado.creativos['2026-11-09-a'].variantes[0].publicaciones.prueba
  assert.equal(p?.ig_media_id, 'm-1')
  assert.deepEqual(p?.metricas, { likes: 3 })
  git(otro, ['pull', '-q', 'origin', 'estado'])
  assert.ok(readFileSync(join(otro, 'cuentas', 'prueba-web', 'estado.json'), 'utf8').includes('prueba-web'), 'el estado de la otra cuenta queda intacto')

  const r3 = await empujarEstado({ dir: mio, cuentaId: 'prueba-ar', base: r2.estado, propio: { ...r2.estado, actualizado: '2026-11-09T23:00:00.000Z' }, mensaje: 'nada', espera: async () => {} })
  assert.equal(r3.empujado, false, 'sin cambios no hay commit')
})

test('crearGuardar: sin FABRICA_PUSH escribe el archivo; con FABRICA_PUSH=1 pushea cada guardado', async () => {
  const { mio, otro, git } = repos()
  const sinPush = crearGuardar({ dir: mio, cuentaId: 'prueba-ar', base: estadoVacio('prueba-ar'), env: {} })
  await sinPush(estadoCon('prueba-ar', [creativo('2026-11-09-a', [])]))
  assert.ok(readFileSync(join(mio, rutaRelEstado('prueba-ar')), 'utf8').includes('2026-11-09-a'))
  const conPush = crearGuardar({ dir: mio, cuentaId: 'prueba-ar', base: estadoVacio('prueba-ar'), env: { FABRICA_PUSH: '1' }, espera: async () => {} })
  await conPush(estadoCon('prueba-ar', [creativo('2026-11-09-b', [])]))
  await conPush(estadoCon('prueba-ar', [creativo('2026-11-09-b', [{ prueba: { ig_container_id: 'c' } }])]))
  git(otro, ['pull', '-q', 'origin', 'estado'])
  assert.equal(git(otro, ['rev-list', '--count', 'HEAD']).trim(), '3')
  assert.ok(readFileSync(join(otro, rutaRelEstado('prueba-ar')), 'utf8').includes('"ig_container_id": "c"'))
})
