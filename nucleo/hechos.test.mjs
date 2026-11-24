import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { cuentaAr } from './__fixtures__/ayuda.mjs'
import { cifraEn, datosPersonales, fechaRespaldada, leerFuente, referenciasRotas, repiteA, revisarHechosPropuestos, revisarIdeas, revisarTanda, validarHecho, validarIdea } from './hechos.mjs'
import '../agentes/tanda.test.mjs'

const FORMATOS = join(dirname(fileURLToPath(import.meta.url)), '..', 'formatos')
const TODOS = ['chat', 'mito', 'explicador', 'lista-de-errores', 'pregunta', 'comparador', 'cuenta-regresiva']
const cuenta = () => {
  const c = cuentaAr()
  return { ...c, marca: { ...c.marca, formatos: TODOS }, reglas_texto: { ...c.reglas_texto, fuentes_dominios: null } }
}

/** @param {Partial<import('./banco.mjs').Hecho>} h @returns {import('./banco.mjs').Hecho} */
const hecho = (h) => ({ id: 'h', tipo: 'dato', texto: 'x', cifras: [], fuente: 'repo:manu-180/calcular:src/a.ts:3', envejece: null, ...h })
const HECHOS = new Map([
  ['preaviso-15', hecho({ id: 'preaviso-15', texto: 'El preaviso es de 15 días', cifras: ['15'] })],
  ['aguinaldo-18-dic', hecho({ id: 'aguinaldo-18-dic', texto: 'La segunda cuota del aguinaldo se paga hasta el 18 de diciembre', cifras: ['18'], tipo: 'norma' })],
])
/** @param {any} [i] */
const idea = (i = {}) => ({ id: 'preaviso-quince', tema: 'preaviso', idea: 'Cuántos días de preaviso te tienen que dar', angulo: 'dato', formato_sugerido: 'explicador', hechos: ['preaviso-15'], ventana: null, origen: 'hechos', ...i })

const ARCHIVO = ['export const PREAVISO = {', '  meses: 1,', '  dias: 15,', '}', ''].join('\n')
/** @type {import('./hechos.mjs').LeerFuente} */
const leer = (repo, archivo) => (repo === 'manu-180/calcular' && archivo === 'src/a.ts' ? ARCHIVO : null)

test('leerFuente reconoce repo, url y manuel; lo demás no', () => {
  assert.deepEqual(leerFuente('repo:manu-180/calcular:src/app/(ar)/x/page.tsx:100'), { tipo: 'repo', repo: 'manu-180/calcular', archivo: 'src/app/(ar)/x/page.tsx', linea: 100 })
  assert.equal(leerFuente('manuel:2026-11-23')?.tipo, 'manuel')
  assert.equal(leerFuente('https://web.dev/articles/vitals')?.tipo, 'url')
  assert.equal(leerFuente('lo dijo alguien'), null)
  assert.equal(leerFuente('repo:calcular:src/a.ts'), null)
})

test('validarHecho abre el repo: la línea tiene que existir y la cifra estar cerca', () => {
  assert.deepEqual(validarHecho(hecho({ cifras: ['15'] }), { leer }), { problemas: [], sin_verificar: false })
  assert.match(validarHecho(hecho({ cifras: ['45'] }), { leer }).problemas.join(), /cifra 45 no está/)
  assert.match(validarHecho(hecho({ fuente: 'repo:manu-180/calcular:src/a.ts:99' }), { leer }).problemas.join(), /tiene 5 líneas, no 99/)
  assert.equal(validarHecho(hecho({ cifras: ['15'] })).sin_verificar, true)
  assert.match(validarHecho(hecho({ texto: 'escribí a juan@gmail.com' })).problemas.join(), /mail/)
  assert.match(validarHecho(hecho({ fuente: 'me lo contaron' })).problemas.join(), /fuente/)
})

test('cifraEn no confunde una cifra con parte de un número más largo', () => {
  assert.equal(cifraEn('15', 'dias: 15,'), true)
  assert.equal(cifraEn('15', 'dias: 150'), false)
  assert.equal(cifraEn('27.329', 'Ley 27329'), true)
})

test('una idea con una cifra inventada se descarta', () => {
  const r = revisarIdeas({ nuevas: [idea({ idea: 'Te tienen que dar 45 días de preaviso' })], existentes: [], cuenta: cuenta(), hechos: HECHOS })
  assert.equal(r.aceptadas.length, 0)
  assert.match(r.descartadas[0]?.motivo ?? '', /cifras que no están en sus hechos: 45/)
  assert.equal(revisarIdeas({ nuevas: [idea({ idea: 'Te tienen que dar 15 días de preaviso' })], existentes: [], cuenta: cuenta(), hechos: HECHOS }).aceptadas.length, 1)
})

test('una idea sin hechos, con un hecho que no existe o con un dato personal se descarta', () => {
  const p = (/** @type {any} */ i) => validarIdea(idea(i), { cuenta: cuenta(), hechos: HECHOS }).join('; ')
  assert.match(p({ hechos: [] }), /al menos uno/)
  assert.match(p({ hechos: ['inventado'] }), /"inventado" no existe/)
  assert.match(p({ idea: 'Lo que nos preguntó @maria.lopez' }), /@usuario/)
  assert.match(p({ idea: 'Llamá al 11 3427-2488' }), /teléfono/)
  assert.match(p({ formato_sugerido: 'antes-despues' }), /formato_sugerido/)
  assert.match(p({ origen: 'temporada' }), /lleva ventana/)
  assert.match(p({ formato_sugerido: 'cuenta-regresiva' }), /necesita una fecha/)
  assert.equal(p({}), '')
})

test('las ideas de calcular llevan origen_repo y la línea tiene que existir', () => {
  const leerRepo = (/** @type {string} */ a) => (a === 'src/a.ts' ? ARCHIVO : null)
  const v = (/** @type {any} */ i) => validarIdea(idea(i), { cuenta: cuenta(), hechos: HECHOS, exigirOrigenRepo: true, leerRepo }).join('; ')
  assert.match(v({}), /origen_repo: "archivo:línea"/)
  assert.match(v({ origen_repo: 'src/b.ts:3' }), /no existe src\/b.ts/)
  assert.match(v({ origen_repo: 'src/a.ts:40' }), /no tiene la línea 40/)
  assert.equal(v({ origen_repo: 'src/a.ts:3' }), '')
})

test('repiteA: mismo id, mismo texto casi igual o mismo tema, ángulo y hechos', () => {
  const vieja = idea()
  assert.equal(repiteA(idea(), [vieja]), 'preaviso-quince')
  assert.equal(repiteA(idea({ id: 'otra', idea: 'Cuántos días de preaviso te tienen que dar a vos' }), [vieja]), 'preaviso-quince')
  assert.equal(repiteA(idea({ id: 'otra', idea: 'Algo distinto del todo', angulo: 'dato' }), [vieja]), 'preaviso-quince')
  assert.equal(repiteA(idea({ id: 'otra', idea: 'Si renunciás, el preaviso lo das vos', angulo: 'mito' }), [vieja]), null)
  const r = revisarIdeas({ nuevas: [idea({ id: 'a1', angulo: 'mito', idea: 'Si renunciás el preaviso lo das vos' }), idea({ id: 'a2', angulo: 'mito', idea: 'Si renunciás el preaviso lo das vos también' })], existentes: [vieja], cuenta: cuenta(), hechos: HECHOS })
  assert.deepEqual(r.aceptadas.map((x) => x.id), ['a1'])
  assert.match(r.descartadas[0]?.motivo ?? '', /repite la idea a1/)
})

test('hechos propuestos: entran solos sólo los de un repo verificado y nunca uno de la oferta', () => {
  const r = revisarHechosPropuestos({
    existentes: HECHOS,
    leer,
    propuestos: [
      hecho({ id: 'nuevo-ok', cifras: ['15'] }),
      hecho({ id: 'nuevo-lejos', cifras: ['99'] }),
      hecho({ id: 'nuevo-oferta', tipo: 'oferta', cifras: ['15'] }),
      hecho({ id: 'nuevo-manuel', fuente: 'manuel:2026-11-24' }),
      hecho({ id: 'preaviso-15', cifras: ['15'] }),
    ],
  })
  assert.deepEqual(r.aceptados.map((h) => h.id), ['nuevo-ok'])
  const motivo = Object.fromEntries(r.pendientes.map((p) => [p.id, p.motivo]))
  assert.match(motivo['nuevo-lejos'], /cifra 99/)
  assert.match(motivo['nuevo-oferta'], /Manuel/)
  assert.match(motivo['nuevo-manuel'], /sin verificar/)
  assert.match(motivo['preaviso-15'], /ya existe/)
})

test('referenciasRotas encuentra ideas y guiones que citan un hecho inexistente', () => {
  const r = referenciasRotas({ ideas: [idea({ hechos: ['preaviso-15', 'nada'] })], guiones: [{ archivo: '100-x.json', guion: { hechos: ['otro'] } }], hechos: HECHOS })
  assert.deepEqual(r, ['idea preaviso-quince: el hecho "nada" no existe', '100-x.json: el hecho "otro" no existe'])
})

test('datosPersonales no toma una fecha por un teléfono', () => {
  assert.deepEqual(datosPersonales('vence el 2026-12-18'), [])
  assert.deepEqual(datosPersonales('wa.me o https://x.com/y'), ['trae una URL'])
})

test('fechaRespaldada busca el día de la cuenta regresiva en los hechos', () => {
  const h = /** @type {any} */ ([HECHOS.get('aguinaldo-18-dic')])
  assert.equal(fechaRespaldada('2026-12-18', h), true)
  assert.equal(fechaRespaldada('2026-12-20', h), false)
})

const pregunta = (/** @type {any} */ extra = {}) => ({
  version: 1, clave: '100-preaviso-pregunta', titulo: '¿Cuánto preaviso te dan?', categoria: 'pregunta', formato: 'pregunta', tema: 'preaviso', idea: 'preaviso-quince', hechos: ['preaviso-15'],
  hooks: ['¿Cuántos días de preaviso te dan?', 'La pregunta que más nos llega', 'Antes de renunciar, mirá esto'],
  voz: '¿Cuántos días de preaviso me tienen que dar? Depende de tu antigüedad y te lo explico rápido. Si te despiden, el aviso llega antes. Si renunciás, lo das vos. Y si no te avisan, te lo pagan.',
  contenido: { pregunta: '¿Cuántos días de preaviso me tienen que dar?', respuesta: 'Depende de tu antigüedad', claves: ['Si te despiden, llega antes', 'Si renunciás, lo das vos', 'Si no avisan, te lo pagan'] },
  captions: ['El preaviso tiene reglas claras.', 'Guardalo para cuando lo necesites.', '¿Te avisaron a tiempo?'],
  hashtags: ['preaviso', 'trabajo', 'despido', 'renuncia', 'sueldo', 'argentina', 'derechoslaborales', 'calcularar'],
  ...extra,
})

test('revisarTanda: pasa un guion bien hecho y descarta cifra inventada, idea inexistente, clave y hooks repetidos', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tanda-'))
  writeFileSync(join(dir, '100-preaviso-pregunta.json'), JSON.stringify(pregunta()))
  writeFileSync(join(dir, '101-preaviso-inventado.json'), JSON.stringify(pregunta({ clave: '101-preaviso-inventado', hooks: ['Te deben 45 días de preaviso', 'Otro gancho distinto acá', 'Y uno más para variar'] })))
  writeFileSync(join(dir, '102-sin-idea.json'), JSON.stringify(pregunta({ clave: '102-sin-idea', idea: 'no-existe', hooks: ['Uno', 'Dos ganchos', 'Tres ganchos más'] })))
  writeFileSync(join(dir, '103-repetido.json'), JSON.stringify(pregunta({ clave: '103-repetido' })))
  const ideas = new Map([['preaviso-quince', idea()]])
  const existentes = [{ clave: '050-viejo', hooks: ['La pregunta que más nos llega'] }]
  const r = Object.fromEntries((await revisarTanda({ cuenta: cuenta(), dir, dirFormatos: FORMATOS, ideas, hechos: HECHOS, paletas: [], existentes })).map((x) => [x.archivo, x.problemas.join('; ')]))
  assert.match(r['100-preaviso-pregunta.json'], /repite hooks de otro guion: La pregunta que más nos llega/)
  assert.match(r['101-preaviso-inventado.json'], /cifras sin respaldo en los hechos que cita: 45/)
  assert.match(r['102-sin-idea.json'], /idea: tiene que ser una idea existente/)
  const limpio = await revisarTanda({ cuenta: cuenta(), dir, dirFormatos: FORMATOS, ideas, hechos: HECHOS, paletas: [], existentes: [] })
  assert.equal(limpio.find((x) => x.archivo === '100-preaviso-pregunta.json')?.problemas.length, 0)
})

test('revisarTanda: una cuenta regresiva pasa si su fecha está en un hecho, y no si no', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tanda-'))
  const g = (/** @type {string} */ clave, /** @type {string} */ fecha) => ({
    version: 1, clave, titulo: 'Antes del aguinaldo', categoria: 'calendario', formato: 'cuenta-regresiva', tema: 'aguinaldo', idea: 'aguinaldo-fecha', hechos: ['aguinaldo-18-dic'],
    hooks: [`Se viene el aguinaldo ${clave.slice(4, 14)}`, `Antes de cobrar hacé esto ${clave.slice(4, 14)}`, `Faltan semanas para cobrar ${clave.slice(4, 14)}`],
    voz: 'Faltan semanas y conviene ordenarse. Primero, revisá tu recibo de junio. Después, hacé la cuenta con tu mejor sueldo. El día antes, chequeá que te lo depositen completo. El dieciocho de diciembre es el último día para pagarlo.',
    contenido: { evento: 'Aguinaldo', fecha, pasos: [{ cuando: 'Tres semanas antes', que: 'Revisá tu recibo de junio', dias: 21 }, { cuando: 'Una semana antes', que: 'Hacé la cuenta con tu mejor sueldo', dias: 7 }, { cuando: 'El día antes', que: 'Chequeá que te lo depositen completo', dias: 1 }] },
    captions: ['Tres cosas para hacer antes de cobrar.', 'Guardalo para diciembre.', '¿Ya sabés cuánto te toca?'],
    hashtags: ['aguinaldo', 'sueldo', 'trabajo', 'argentina', 'finanzas', 'diciembre', 'derechoslaborales', 'calcularar'],
  })
  writeFileSync(join(dir, '200-aguinaldo-bien.json'), JSON.stringify(g('200-aguinaldo-bien', '2026-12-18')))
  writeFileSync(join(dir, '201-aguinaldo-mal.json'), JSON.stringify(g('201-aguinaldo-mal', '2026-12-20')))
  const ideas = new Map([['aguinaldo-fecha', idea({ id: 'aguinaldo-fecha', tema: 'aguinaldo', idea: 'Cuándo se paga el aguinaldo', hechos: ['aguinaldo-18-dic'], origen: 'temporada', ventana: { desde: '11-20', hasta: '12-18' } })]])
  const r = Object.fromEntries((await revisarTanda({ cuenta: cuenta(), dir, dirFormatos: FORMATOS, ideas, hechos: HECHOS, paletas: [], existentes: [] })).map((x) => [x.archivo, x.problemas.join('; ')]))
  assert.equal(r['200-aguinaldo-bien.json'], '')
  assert.match(r['201-aguinaldo-mal.json'], /la fecha 2026-12-20 no está en los hechos/)
})
