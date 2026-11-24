import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { armarCaptions, captionsDeVariante, cifrasDe, cifrasSinRespaldo, leerBancoCuenta, leerHechos, leerIdeas, letrasACifras, pendientes, revisarBanco, revisarEstricto, revisarGuion } from './banco.mjs'
import { RAIZ, cuentaAr, cuentaWeb } from './__fixtures__/ayuda.mjs'

/** @param {Record<string, unknown>} [extra] */
function guion(extra = {}) {
  return {
    version: 1, clave: 'sobrino-hace-webs', titulo: 'El sobrino que hace webs', categoria: 'comedia', formato: 'chat', paleta: 'papel',
    hooks: ['Tu sobrino te hizo la web', 'Le pediste la web al sobrino', 'La web que te hizo el sobrino'], voz: null,
    contenido: { contacto: 'Cliente nuevo', mensajes: [], remate: null },
    captions: ['El sobrino hace lo que puede.', 'Todos tenemos un sobrino que hace webs.', 'Una web no es un favor.'],
    hashtags: ['diseñoweb', 'paginaweb', 'emprendedores', 'pymes', 'negocios', 'marketingdigital', 'webs', 'argentina'],
    fuentes: [{ nombre: 'LCT', url: 'https://servicios.infoleg.gob.ar/lct.htm', consultado: '2026-11-10' }],
    ...extra,
  }
}
const ARCHIVO = 'sobrino-hace-webs.json'

test('el banco de las cuentas de prueba pasa el revisor estricto', async () => {
  for (const cuenta of [cuentaAr(), cuentaWeb()]) {
    const r = await revisarBanco({ cuenta, raiz: RAIZ, estricto: true })
    assert.ok(r.length >= 2)
    for (const x of r) assert.deepEqual(x.problemas, [], `${cuenta.id} ${x.archivo}`)
  }
})

test('revisarGuion encuentra lo que rompe el contrato, con las reglas de la cuenta', () => {
  const ar = { cuenta: cuentaAr(), paletas: ['papel', 'selva'] }
  assert.deepEqual(revisarGuion(guion(), ARCHIVO, ar), [])
  const hay = (/** @type {any} */ g, /** @type {RegExp} */ re, c = ar, archivo = ARCHIVO) => revisarGuion(g, archivo, c).some((p) => re.test(p))
  assert.ok(hay(guion(), /archivo/, ar, 'otro.json'))
  assert.ok(hay(guion({ hooks: ['a', 'b'] }), /hooks/))
  assert.ok(hay(guion({ categoria: 'Drama Fuerte' }), /categoria/))
  assert.ok(hay(guion({ formato: 'antes-despues' }), /formato/))
  assert.ok(hay(guion({ paleta: 'rosa' }), /paleta/))
  assert.ok(hay(guion({ hashtags: ['#web'] }), /hashtag/))
  assert.ok(hay(guion({ formato: 'mito', voz: null }), /voz: de 25 a 55/))
  assert.ok(hay(guion({ captions: ['uno'] }), /captions/))
  assert.ok(hay(guion({ fuentes: [] }), /fuentes/))
  assert.ok(hay(guion({ fuentes: [{ nombre: 'Un blog', url: 'https://blog.com/x', consultado: '2026-11-10' }] }), /\.gob\.ar/))
  // Una cuenta sin fuentes_dominios no exige fuentes.
  const { fuentes: _, ...sinFuentes } = guion()
  assert.deepEqual(revisarGuion(sinFuentes, ARCHIVO, { cuenta: cuentaWeb() }), [])
  assert.ok(hay(guion({ hechos: ['no-existe'] }), /hechos/, { ...ar, hechos: new Map([['si', /** @type {any} */ ({})]]) }))
  assert.ok(hay(guion({ tema: 'Con Espacios' }), /tema/))
})

test('revisarGuion valida la ventana, caduca e idea', () => {
  const c = { cuenta: cuentaAr() }
  const ok = (/** @type {unknown} */ ventana) => !revisarGuion(guion({ ventana }), ARCHIVO, c).some((p) => /ventana/.test(p))
  assert.ok(ok(undefined))
  assert.ok(ok({ desde: '12-01', hasta: '01-10' }))
  assert.ok(ok({ desde: '02-29', hasta: '03-01' }))
  for (const mala of [null, 'diciembre', { desde: '12-01' }, { desde: '13-01', hasta: '01-10' }, { desde: '02-30', hasta: '03-01' }]) assert.ok(!ok(mala), JSON.stringify(mala))
  assert.ok(revisarGuion(guion({ caduca: '31/12/2026' }), ARCHIVO, c).some((p) => p.startsWith('caduca')))
  const ideas = leerIdeas(JSON.stringify({ version: 1, ideas: [{ id: 'aguinaldo-tope', tema: 'aguinaldo' }] }))
  assert.equal(revisarGuion(guion({ idea: 'no-existe' }), ARCHIVO, { ...c, ideas }).filter((p) => /idea/.test(p)).length, 1)
  assert.deepEqual(revisarGuion(guion({ idea: 'aguinaldo-tope' }), ARCHIVO, { ...c, ideas }), [])
  assert.throws(() => leerIdeas('{ no'))
  assert.throws(() => leerHechos('{ no'))
})

test('cifrasDe deja libres los ejemplos chicos y los años, y toma porcentajes, decimales, 5 o más y lo escrito en letra', () => {
  const g = (/** @type {string} */ voz) => ({ hooks: ['a', 'b', 'c'], voz, contenido: {}, captions: [] })
  assert.deepEqual(cifrasDe(g('Son 4 años y 3 meses, desde 2026, con 50 % y 1,5 veces y 30 días')).sort(), ['1,5', '30', '50'])
  assert.deepEqual(cifrasDe(g('Son quince días y el cincuenta por ciento')).sort(), ['15', '50'])
  assert.equal(letrasACifras('cuarenta y cinco antes del parto'), '45 antes del parto')
  assert.equal(letrasACifras('tres coma cero nueve'), '3,09')
  assert.equal(letrasACifras('once por ciento de jubilacion'), '11% de jubilacion')
  assert.equal(letrasACifras('julio de dos mil veinticuatro'), 'julio de 2024')
  assert.equal(letrasACifras('doscientas ocho horas'), '208 horas')
  assert.equal(letrasACifras('seventy-five percent of people', 'en-US'), '75% of people')
  assert.equal(letrasACifras('three hundred and twenty visits', 'en-US'), '320 visits')
  assert.deepEqual(cifrasDe(g('Fifty three percent leave in three seconds'), 'en-US'), ['53'])
})

test('cifrasSinRespaldo: lo que está en las cifras de los hechos que cita (él o su idea) o cerca de la línea del repo; marca lo inventado', () => {
  const hechos = leerHechos(JSON.stringify({ hechos: [{ id: 'recargo', cifras: ['50'] }, { id: 'dias', cifras: ['14', '21'] }] }))
  const g = (/** @type {string} */ voz, extra = {}) => ({ hooks: ['a', 'b', 'c'], voz, contenido: {}, captions: [], ...extra })
  assert.deepEqual(cifrasSinRespaldo({ guion: g('Son 14 o 21 días y el 50 % de recargo', { hechos: ['recargo', 'dias'] }), hechos }), [])
  assert.deepEqual(cifrasSinRespaldo({ guion: g('Son 15 días', { hechos: ['dias'] }), hechos }), ['15'])
  assert.deepEqual(cifrasSinRespaldo({ guion: g('Son 14 días', { idea: 'x' }), hechos, idea: { id: 'x', tema: 't', hechos: ['dias'] } }), [])
  const repo = (/** @type {string} */ a) => (a === 'src/dato.ts' ? ['export const DIAS = [14, 28, 35]', 'export const RECARGO = 0.5'].join('\n') : null)
  assert.deepEqual(cifrasSinRespaldo({ guion: g('Son 35 días'), idea: { id: 'x', tema: 't', dato: 'recargo', origen_repo: 'src/dato.ts:1' }, leerRepo: repo }), [])
})

test('revisarEstricto: oferta sin hecho de oferta, precios, prohibidas, datos de contacto, dominios ajenos e idioma', () => {
  const ar = cuentaAr()
  const web = cuentaWeb()
  const hechos = leerHechos(JSON.stringify({ hechos: [{ id: 'oferta', tipo: 'oferta', cifras: [] }, { id: 'dato', tipo: 'dato', cifras: ['50'] }] }))
  const g = (/** @type {string} */ voz, extra = {}) => ({ hooks: ['a', 'b', 'c'], voz, contenido: {}, captions: [], ...extra })
  const problemas = (/** @type {any} */ x, cuenta = ar) => revisarEstricto({ guion: x, cuenta, hechos })
  assert.deepEqual(problemas(g('Te armamos la página de tu empresa')), [])
  assert.ok(problemas(g('Te la armamos gratis')).some((p) => /oferta/.test(p)))
  assert.deepEqual(problemas(g('Te la armamos gratis', { hechos: ['oferta'] })), [])
  assert.ok(problemas(g('Sale $ 30000 por mes')).some((p) => /precio/.test(p)))
  assert.ok(problemas(g('Cuesta 200 dólares')).some((p) => /precio/.test(p)))
  assert.ok(problemas(g('Mirá el dashboard'), web).some((p) => /prohibida/.test(p)))
  assert.ok(problemas(g('Escribime a ana@gmail.com')).some((p) => /mail/.test(p)))
  assert.ok(problemas(g('Seguí a @juanperez')).some((p) => /@usuario/.test(p)))
  assert.ok(problemas(g('Llamá al 11 3427-2488')).some((p) => /teléfono/.test(p)))
  assert.ok(!problemas(g('Los días son 14 21 28 y 35')).some((p) => /teléfono/.test(p)))
  assert.ok(problemas(g('Entrá a competencia.com.ar')).some((p) => /competencia\.com\.ar/.test(p)))
  assert.deepEqual(problemas(g('Entrá a prueba.ar y a tunegocio.com')), [])
  assert.ok(problemas(g('Che, mirá esto')).some((p) => /che/.test(p)))
  assert.ok(problemas(g('Si tú tienes un negocio')).some((p) => /tutea/.test(p)))
  assert.ok(!problemas(g('Si vos tenés un negocio, mirá esto y sabés qué hacer')).some((p) => /tutea/.test(p)))
  const ingles = { ...web, idioma: /** @type {const} */ ('en-US') }
  assert.deepEqual(problemas(g('Your business needs a page that loads fast'), ingles), [])
  assert.ok(problemas(g('Your business necesita una pagina para vos'), ingles).some((p) => /castellano/.test(p)))
  assert.ok(problemas(g('El 70 % se va')).some((p) => /cifras sin respaldo.*: 70/.test(p)))
})

test('pendientes cuenta lo que no salió y reparte las ideas libres por tema', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'banco-'))
  const dir = join(raiz, 'guiones')
  mkdirSync(dir)
  writeFileSync(join(dir, '100-a.json'), JSON.stringify({ clave: '100-a', idea: 'a1' }))
  writeFileSync(join(dir, '101-b.json'), JSON.stringify({ clave: '101-b', idea: 'b1' }))
  const ideas = leerIdeas(JSON.stringify({ ideas: ['a1', 'a2', 'a3', 'b1', 'b2', 'c1'].map((id) => ({ id, tema: id[0] })) }))
  const estado = { creativos: { x: { clave: '100-a', fecha: '2026-11-20', producido_at: '2026-11-20T08:00:00Z' } } }
  const r = pendientes({ dirs: [dir], estado, ideas, cuantas: 3 })
  assert.equal(r.sin_salir, 1)
  assert.equal(r.ideas_libres, 4)
  assert.deepEqual(r.elegidas, ['a2', 'b2', 'c1'])
  assert.equal(r.proximo_numero, 102)
})

test('armarCaptions: todos distintos, con los hashtags fijos y el cierre de la cuenta al final, sin emojis', () => {
  const cuenta = cuentaWeb()
  const g = guion({ captions: ['El sobrino hace lo que puede 🙃', 'Todos tenemos un sobrino que hace webs.', 'Una web no es un favor.'] })
  const cs = armarCaptions({ guion: g, cuenta, n: 30 })
  assert.equal(new Set(cs).size, 30)
  for (const c of cs) {
    assert.ok(c.endsWith(cuenta.cierre.caption), c)
    assert.ok(c.length <= 2200)
    assert.doesNotMatch(c, /\p{Extended_Pictographic}/u)
    const tags = (c.match(/#\S+/g) ?? []).map((t) => t.slice(1))
    assert.ok(tags.includes('pruebaweb'))
    assert.ok(tags.length >= cuenta.captions.hashtags_por_post[0] && tags.length <= cuenta.captions.hashtags_por_post[1], `${tags.length}`)
    for (const t of tags) assert.ok([...g.hashtags, 'pruebaweb'].includes(t), t)
  }
})

test('captionsDeVariante: prueba y normal distintas, y otras para cada variante y cada ronda', () => {
  const cuenta = cuentaWeb()
  const todos = []
  for (let ronda = 0; ronda < 3; ronda++) {
    for (let indice = 0; indice < 2; indice++) {
      const [p, n] = captionsDeVariante({ guion: guion(), cuenta, ronda, indice, variantes: 2 })
      assert.ok(p && n && p !== n)
      todos.push(p, n)
    }
  }
  assert.equal(new Set(todos).size, todos.length)
})

test('leerBancoCuenta lee ideas, hechos y paletas de la carpeta de la cuenta', () => {
  const b = leerBancoCuenta(cuentaAr(), RAIZ)
  assert.ok(b.ideas.has('aguinaldo-mitad'))
  assert.deepEqual(b.hechos.get('aguinaldo-50')?.cifras, ['50'])
  assert.deepEqual(b.paletas, ['papel', 'selva', 'noche', 'menta', 'pizarra'])
})

test('revisarEstricto: dominios y mails de ejemplo (tu/your + rubro) sí; marcas reales, dominios de los hechos y otros mails no', () => {
  const g = (/** @type {string} */ voz) => ({ hooks: ['a', 'b', 'c'], voz, contenido: {}, captions: [] })
  const ar = cuentaAr()
  assert.deepEqual(revisarEstricto({ guion: g('Mirá tutaller.com.ar y escribí a consultas@tuestudio.com'), cuenta: ar }), [])
  assert.deepEqual(revisarEstricto({ guion: g('Visit yourgarage.com'), cuenta: { ...cuentaWeb(), idioma: 'en-US' } }), [])
  assert.ok(revisarEstricto({ guion: g('Entrá a tumblr.com'), cuenta: ar }).some((p) => /tumblr/.test(p)))
  assert.ok(revisarEstricto({ guion: g('Escribí a juan@gmail.com'), cuenta: ar }).some((p) => /mail: juan@gmail.com/.test(p)))
  const hechos = leerHechos(JSON.stringify({ hechos: [{ id: 'h', tipo: 'dato', cifras: [], texto: 'El sitio tufactura.com.ar cobra comisión' }] }))
  assert.ok(revisarEstricto({ guion: g('Mirá tufactura.com.ar'), cuenta: ar, hechos }).some((p) => /tufactura/.test(p)))
})

test('revisarEstricto: "gratis" sólo pide respaldo cuando la cuenta lo promete; un dato gratis con su hecho pasa', () => {
  const g = (/** @type {string} */ voz, extra = {}) => ({ hooks: ['a', 'b', 'c'], voz, contenido: {}, captions: [], ...extra })
  const ar = cuentaAr()
  const hechos = leerHechos(JSON.stringify({ hechos: [{ id: 'telegrama', tipo: 'norma', cifras: [], texto: 'El telegrama laboral es gratis para el trabajador' }, { id: 'demo', tipo: 'oferta', cifras: [], texto: 'La demo es gratis' }] }))
  assert.deepEqual(revisarEstricto({ guion: g('Con una plantilla gratis queda igual. Lo gratis sale caro.'), cuenta: ar, hechos }), [])
  assert.deepEqual(revisarEstricto({ guion: g('La ficha de Google Maps es gratis'), cuenta: ar, hechos }), [])
  assert.ok(revisarEstricto({ guion: g('Te la armamos gratis'), cuenta: ar, hechos }).some((p) => /oferta/.test(p)))
  assert.deepEqual(revisarEstricto({ guion: g('Te la armamos gratis', { hechos: ['demo'] }), cuenta: ar, hechos }), [])
  assert.ok(revisarEstricto({ guion: g('Te mandamos el telegrama gratis'), cuenta: ar, hechos }).some((p) => /oferta/.test(p)))
  assert.deepEqual(revisarEstricto({ guion: g('Te mandamos el telegrama gratis', { hechos: ['telegrama'] }), cuenta: ar, hechos }), [])
  assert.ok(revisarEstricto({ guion: g('Pagás la primera cuota cuando te gusta'), cuenta: ar, hechos }).some((p) => /oferta/.test(p)))
})

test('revisarEstricto: números de utilería sólo en un chat de comedia que los marca en ilustrativos, y nunca precios, plazos ni porcentajes de la oferta', () => {
  const ar = cuentaAr()
  const hechos = leerHechos(JSON.stringify({ hechos: [{ id: 'demo-24', tipo: 'oferta', cifras: ['24'], texto: 'La demo en 24 horas' }] }))
  const chat = (/** @type {string} */ texto, extra = {}) => ({ formato: 'chat', categoria: 'comedia', hooks: ['a', 'b', 'c'], voz: null, contenido: { mensajes: [{ de: 'ellos', texto }] }, captions: [], ...extra })
  assert.ok(revisarEstricto({ guion: chat('1.284 visitas. Pa, 1.280 son tuyas'), cuenta: ar, hechos }).some((p) => /1\.284/.test(p)))
  assert.deepEqual(revisarEstricto({ guion: chat('1.284 visitas. Pa, 1.280 son tuyas', { ilustrativos: ['1.284', '1.280'] }), cuenta: ar, hechos }), [])
  assert.ok(revisarEstricto({ guion: chat('1.284 visitas', { ilustrativos: ['1.284'], formato: 'explicador' }), cuenta: ar, hechos }).some((p) => /sólo en un chat de comedia/.test(p)))
  assert.ok(revisarEstricto({ guion: chat('1.284 visitas', { ilustrativos: ['1.284'], categoria: 'tecnico' }), cuenta: ar, hechos }).some((p) => /1\.284/.test(p)))
  assert.ok(revisarEstricto({ guion: chat('La tenés en 24 horas', { ilustrativos: ['24'] }), cuenta: ar, hechos }).some((p) => /oferta/.test(p)))
  assert.ok(revisarEstricto({ guion: chat('En 15 días está', { ilustrativos: ['15'] }), cuenta: ar, hechos }).some((p) => /plazo/.test(p)))
  assert.ok(revisarEstricto({ guion: chat('El 70 % se va', { ilustrativos: ['70 %'] }), cuenta: ar, hechos }).some((p) => /porcentaje/.test(p)))
  assert.ok(revisarEstricto({ guion: chat('Sale $ 30000', { ilustrativos: ['30000'] }), cuenta: ar, hechos }).some((p) => /precio/.test(p)))
  assert.ok(revisarGuion({ ...guion(), ilustrativos: 'x' }, ARCHIVO, { cuenta: ar }).some((p) => /ilustrativos/.test(p)))
})

test('cifrasDe no toma los atributos de un visual de código', () => {
  const g = { hooks: ['a', 'b', 'c'], voz: 'Cargá rápido', contenido: { bloques: [{ visual: { tipo: 'codigo', lineas: ['<img width="800" height="600">'] } }, { visual: { tipo: 'titulo', texto: '53 %' } }] }, captions: [] }
  assert.deepEqual(cifrasDe(g), ['53'])
})

test('revisarEstricto: "la primera cuota del aguinaldo" es un dato, no la oferta', () => {
  const g = { hooks: ['a', 'b', 'c'], voz: 'La primera cuota del aguinaldo vence en junio', contenido: {}, captions: [] }
  assert.deepEqual(revisarEstricto({ guion: g, cuenta: cuentaAr() }), [])
})
