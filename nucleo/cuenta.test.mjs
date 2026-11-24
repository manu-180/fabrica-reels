import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cargarCuenta, listarCuentas, validarCuenta, porDiaHoy, variablePausa, accionesPorDia } from './cuenta.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

function base() {
  return {
    version: 1,
    id: 'apex-stack',
    usuario: 'apex.stack',
    idioma: 'es-AR',
    activa: true,
    modo: 'real',
    creativos_por_dia: 1,
    variantes_por_creativo: 2,
    destinos: {
      prueba: { activo: true, trial: 'MANUAL' },
      normal: { activo: true, share_to_feed: false, espera_min: 60 },
      historia: { activo: true, espera_min: 30, cierre: 'historia' },
    },
    franjas: [
      { desde: '11:30', hasta: '14:30' },
      { desde: '18:00', hasta: '23:30' },
    ],
    antispam: { max_dia: 10, max_dia_propias: 6, gap_min: 50, max_por_corrida: 1, reserva_cupo: 15 },
    rampa: null,
    voz: {
      proveedor: 'elevenlabs',
      modelo: 'eleven_multilingual_v2',
      voice_id: 'p7AwDmKvTdoHTBuueGvP',
      ajustes: { stability: 0.45, similarity_boost: 0.8, style: 0.3 },
      pausas: { tras_hook: 0.85, entre: 0.8, antes_cta: 0.9, coma: 0.25 },
      respaldo: { proveedor: 'gemini', voz: 'Kore', estilo: 'rioplatense cálido' },
      presupuesto_mes: 18000,
    },
    marca: {
      paletas: 'marca/paletas.json',
      fuentes: { titulo: 'marca/fuentes/a.woff2', cuerpo: 'marca/fuentes/b.woff2', mono: 'marca/fuentes/c.woff2' },
      tracking_titulo: -0.03,
      motivos: ['grilla', 'luz'],
      logo: 'marca/logo.svg',
      radio: 28,
      formatos: ['chat', 'mito', 'explicador', 'antes-despues'],
    },
    cierre: {
      texto_voz: 'Comentá WEB y te armamos gratis la página de tu empresa.',
      texto_historia: 'Respondé WEB a esta historia',
      caption: 'Comentá WEB y te armamos gratis la página web de tu empresa.',
      clips: 'cta/clips.json',
      palabra_clave: 'WEB',
    },
    captions: { hashtags_por_post: [5, 7], hashtags_fijos: ['apexstack'] },
    secretos: { ig_user: 'IG_APEX_STACK_USER_ID', ig_token: 'IG_APEX_STACK_TOKEN', ig_insights: 'IG_APEX_STACK_INSIGHTS_TOKEN' },
    reglas_texto: { prohibidas: [], max_palabras_voz: [25, 55], sin_montos: true, fuentes_dominios: null },
    kairo: { seccion: 'reels-apex-stack' },
  }
}

const con = (cambio) => {
  const c = base()
  cambio(c)
  return c
}

const tiene = (problemas, trozo) => assert.ok(problemas.some((p) => p.includes(trozo)), `falta un problema con "${trozo}" en ${JSON.stringify(problemas)}`)

test('una cuenta completa no tiene problemas', () => {
  assert.deepEqual(validarCuenta(base()), [])
})

test('lo que no es un objeto se rechaza sin tirar', () => {
  for (const v of [null, 3, 'x', []]) assert.deepEqual(validarCuenta(v), ['la cuenta no es un objeto'])
})

test('version distinta de 1', () => {
  tiene(validarCuenta(con((c) => (c.version = 2))), 'version')
})

test('id en kebab-case', () => {
  tiene(validarCuenta(con((c) => (c.id = 'Apex Stack'))), 'id')
  tiene(validarCuenta(con((c) => (c.id = '../otra'))), 'id')
})

test('usuario de Instagram sin arroba', () => {
  tiene(validarCuenta(con((c) => (c.usuario = '@apex.stack'))), 'usuario')
})

test('idioma y modo de las listas', () => {
  tiene(validarCuenta(con((c) => (c.idioma = 'es'))), 'idioma')
  tiene(validarCuenta(con((c) => (c.modo = 'prueba'))), 'modo')
  tiene(validarCuenta(con((c) => (c.activa = 'si'))), 'activa')
})

test('creativos y variantes enteros en rango', () => {
  tiene(validarCuenta(con((c) => (c.creativos_por_dia = 0))), 'creativos_por_dia')
  tiene(validarCuenta(con((c) => (c.creativos_por_dia = 1.5))), 'creativos_por_dia')
  tiene(validarCuenta(con((c) => (c.variantes_por_creativo = 4))), 'variantes_por_creativo')
})

test('destinos: forma de cada uno', () => {
  tiene(validarCuenta(con((c) => (c.destinos.prueba.trial = 'OTRO'))), 'destinos.prueba.trial')
  tiene(validarCuenta(con((c) => (c.destinos.normal.share_to_feed = 'no'))), 'destinos.normal.share_to_feed')
  tiene(validarCuenta(con((c) => (c.destinos.historia.cierre = 'feed'))), 'destinos.historia.cierre')
  tiene(validarCuenta(con((c) => (c.destinos.normal.espera_min = -1))), 'destinos.normal.espera_min')
  tiene(validarCuenta(con((c) => delete c.destinos.historia)), 'destinos.historia')
  tiene(validarCuenta(con((c) => (c.destinos.extra = { activo: true }))), 'destinos.extra')
})

test('al menos un destino activo', () => {
  const c = con((c) => {
    for (const d of Object.values(c.destinos)) d.activo = false
  })
  tiene(validarCuenta(c), 'ningún destino activo')
})

test('historia con cierre propio pide texto_historia', () => {
  tiene(validarCuenta(con((c) => (c.cierre.texto_historia = null))), 'cierre.texto_historia')
})

test('franjas: hora válida, desde antes que hasta, ordenadas y sin pisarse', () => {
  tiene(validarCuenta(con((c) => (c.franjas = []))), 'franjas')
  tiene(validarCuenta(con((c) => (c.franjas[0].desde = '25:00'))), 'franjas[0].desde')
  tiene(validarCuenta(con((c) => (c.franjas[0] = { desde: '14:30', hasta: '11:30' }))), 'franjas[0]')
  tiene(validarCuenta(con((c) => (c.franjas[1] = { desde: '14:00', hasta: '20:00' }))), 'se pisa')
})

test('antispam: propias no pasan del total y lo planeado entra en el tope', () => {
  tiene(validarCuenta(con((c) => (c.antispam.max_dia_propias = 11))), 'max_dia_propias')
  tiene(validarCuenta(con((c) => (c.variantes_por_creativo = 3))), 'publicaciones por día')
  tiene(validarCuenta(con((c) => (c.antispam.reserva_cupo = 100))), 'reserva_cupo')
  tiene(validarCuenta(con((c) => (c.antispam.max_por_corrida = 0))), 'max_por_corrida')
})

test('las franjas tienen que dar lugar a las publicaciones con su gap', () => {
  const c = con((c) => {
    c.franjas = [{ desde: '12:00', hasta: '13:00' }]
    c.antispam.gap_min = 50
  })
  tiene(validarCuenta(c), 'no entran')
})

test('rampa: inicio fecha real, escalones crecientes y que entren en la cuenta', () => {
  const rampa = { inicio: '2026-12-01', escalones: [{ creativos: 1, variantes: 1, acciones: 3 }, { creativos: 1, acciones: 6 }] }
  assert.deepEqual(validarCuenta(con((c) => (c.rampa = rampa))), [])
  tiene(validarCuenta(con((c) => (c.rampa = { ...rampa, inicio: '2026-02-30' }))), 'rampa.inicio')
  tiene(validarCuenta(con((c) => (c.rampa = { ...rampa, escalones: [] }))), 'rampa.escalones')
  tiene(validarCuenta(con((c) => (c.rampa = { ...rampa, escalones: [{ creativos: 2, acciones: 6 }, { creativos: 1, acciones: 6 }] }))), 'baja')
  tiene(validarCuenta(con((c) => (c.rampa = { ...rampa, escalones: [{ creativos: 2, acciones: 12 }] }))), 'creativos_por_dia')
  tiene(validarCuenta(con((c) => (c.rampa = { ...rampa, escalones: [{ creativos: 1, acciones: 9 }] }))), 'max_dia_propias')
  tiene(validarCuenta(con((c) => (c.rampa = { ...rampa, escalones: [{ creativos: 1, acciones: 2 }] }))), 'no alcanzan')
})

test('voz: proveedor, ajustes en rango y voice_id', () => {
  tiene(validarCuenta(con((c) => (c.voz.proveedor = 'azure'))), 'voz.proveedor')
  tiene(validarCuenta(con((c) => (c.voz.ajustes.stability = 2))), 'voz.ajustes.stability')
  tiene(validarCuenta(con((c) => (c.voz.pausas.entre = 'mucho'))), 'voz.pausas.entre')
  tiene(validarCuenta(con((c) => (c.voz.presupuesto_mes = -5))), 'voz.presupuesto_mes')
  tiene(validarCuenta(con((c) => (c.voz.respaldo = { proveedor: 'elevenlabs' }))), 'voz.respaldo')
})

test('voice_id puede faltar sólo si la cuenta está apagada', () => {
  tiene(validarCuenta(con((c) => (c.voz.voice_id = null))), 'voz.voice_id')
  assert.deepEqual(validarCuenta(con((c) => ((c.voz.voice_id = null), (c.activa = false)))), [])
})

test('marca: rutas relativas dentro de la cuenta, motivos y formatos', () => {
  tiene(validarCuenta(con((c) => (c.marca.logo = '../apex/logo.svg'))), 'marca.logo')
  tiene(validarCuenta(con((c) => (c.marca.paletas = 'C:/x/paletas.json'))), 'marca.paletas')
  tiene(validarCuenta(con((c) => (c.marca.fuentes.mono = '/abs.woff2'))), 'marca.fuentes.mono')
  tiene(validarCuenta(con((c) => (c.marca.motivos = ['neon']))), 'marca.motivos')
  tiene(validarCuenta(con((c) => (c.marca.motivos = []))), 'marca.motivos')
  tiene(validarCuenta(con((c) => (c.marca.formatos = []))), 'marca.formatos')
})

test('cierre y captions', () => {
  tiene(validarCuenta(con((c) => (c.cierre.texto_voz = ''))), 'cierre.texto_voz')
  tiene(validarCuenta(con((c) => (c.cierre.caption = 'x'.repeat(301)))), 'cierre.caption')
  tiene(validarCuenta(con((c) => (c.cierre.palabra_clave = 'web'))), 'cierre.palabra_clave')
  tiene(validarCuenta(con((c) => (c.captions.hashtags_por_post = [7, 5]))), 'captions.hashtags_por_post')
  tiene(validarCuenta(con((c) => (c.captions.hashtags_fijos = ['#ApexStack']))), 'captions.hashtags_fijos')
})

test('secretos: sólo nombres de variables, nunca valores', () => {
  tiene(validarCuenta(con((c) => (c.secretos.ig_token = 'EAAG123abc'))), 'secretos.ig_token')
  tiene(validarCuenta(con((c) => delete c.secretos.ig_user)), 'secretos.ig_user')
  assert.deepEqual(validarCuenta(con((c) => (c.secretos.ig_insights = null))), [])
})

test('reglas_texto y kairo', () => {
  tiene(validarCuenta(con((c) => (c.reglas_texto.max_palabras_voz = [60, 20]))), 'reglas_texto.max_palabras_voz')
  tiene(validarCuenta(con((c) => (c.reglas_texto.prohibidas = 'dashboard'))), 'reglas_texto.prohibidas')
  tiene(validarCuenta(con((c) => (c.reglas_texto.fuentes_dominios = []))), 'reglas_texto.fuentes_dominios')
  tiene(validarCuenta(con((c) => (c.kairo.seccion = ''))), 'kairo.seccion')
})

test('banco es opcional, pero si viene sus rutas son relativas', () => {
  assert.deepEqual(validarCuenta(con((c) => (c.banco = { guiones: 'guiones', ideas: 'ideas.json', hechos: 'hechos.json', tono: 'TONO.md' }))), [])
  tiene(validarCuenta(con((c) => (c.banco = { hechos: '../hechos.json' }))), 'banco.hechos')
})

test('un campo desconocido es un problema (un typo no pasa callado)', () => {
  tiene(validarCuenta(con((c) => (c.creativos_dia = 2))), 'creativos_dia')
  tiene(validarCuenta(con((c) => (c.antispam.gap = 2))), 'antispam.gap')
})

test('accionesPorDia multiplica creativos, variantes y destinos activos', () => {
  assert.equal(accionesPorDia(base()), 6)
  assert.equal(accionesPorDia(con((c) => (c.destinos.historia.activo = false))), 4)
  assert.equal(accionesPorDia(base(), { creativos: 1, variantes: 1 }), 3)
})

const rampa = () =>
  con((c) => {
    c.creativos_por_dia = 5
    c.variantes_por_creativo = 1
    c.antispam.max_dia = 15
    c.antispam.max_dia_propias = 15
    c.franjas = [{ desde: '09:00', hasta: '23:59' }]
    c.rampa = {
      inicio: '2026-12-01',
      escalones: [
        { creativos: 1, acciones: 3 },
        { creativos: 2, acciones: 6 },
        { creativos: 3, acciones: 9 },
        { creativos: 4, acciones: 12 },
        { creativos: 5, acciones: 15 },
      ],
    }
  })

test('porDiaHoy sin rampa devuelve lo de la cuenta', () => {
  assert.deepEqual(porDiaHoy(base(), '2026-12-10'), { creativos: 1, variantes: 2, acciones: 6, escalon: null })
})

test('porDiaHoy con rampa: una semana por escalón y el último se sostiene', () => {
  const c = rampa()
  assert.deepEqual(porDiaHoy(c, '2026-12-01'), { creativos: 1, variantes: 1, acciones: 3, escalon: 0 })
  assert.deepEqual(porDiaHoy(c, '2026-12-07'), { creativos: 1, variantes: 1, acciones: 3, escalon: 0 })
  assert.deepEqual(porDiaHoy(c, '2026-12-08'), { creativos: 2, variantes: 1, acciones: 6, escalon: 1 })
  assert.deepEqual(porDiaHoy(c, '2027-03-01'), { creativos: 5, variantes: 1, acciones: 15, escalon: 4 })
})

test('porDiaHoy antes del inicio de la rampa no produce nada', () => {
  assert.deepEqual(porDiaHoy(rampa(), '2026-11-30'), { creativos: 0, variantes: 1, acciones: 0, escalon: -1 })
})

test('porDiaHoy toma el día de Buenos Aires de un Date', () => {
  // 02:30 UTC del 8/12 son las 23:30 del 7/12 en Buenos Aires: sigue la semana 1.
  assert.equal(porDiaHoy(rampa(), new Date('2026-12-08T02:30:00Z')).escalon, 0)
  assert.equal(porDiaHoy(rampa(), new Date('2026-12-08T03:30:00Z')).escalon, 1)
})

test('porDiaHoy respeta el escalón que sostiene el estado tras un antispam', () => {
  assert.deepEqual(porDiaHoy(rampa(), '2027-03-01', { escalon: 2 }), { creativos: 3, variantes: 1, acciones: 9, escalon: 2 })
  assert.equal(porDiaHoy(rampa(), '2026-12-01', { escalon: 3 }).escalon, 0)
})

test('porDiaHoy usa las variantes del escalón si las trae', () => {
  const c = con((c) => (c.rampa = { inicio: '2026-12-01', escalones: [{ creativos: 1, variantes: 1, acciones: 3 }, { creativos: 1, acciones: 6 }] }))
  assert.deepEqual(porDiaHoy(c, '2026-12-02'), { creativos: 1, variantes: 1, acciones: 3, escalon: 0 })
  assert.deepEqual(porDiaHoy(c, '2026-12-09'), { creativos: 1, variantes: 2, acciones: 6, escalon: 1 })
})

test('variablePausa arma el nombre de la variable del repo', () => {
  assert.equal(variablePausa('apex-stack'), 'FABRICA_PAUSADA_APEX_STACK')
})

function raizCon(cuentas) {
  const raiz = mkdtempSync(join(tmpdir(), 'fabrica-'))
  for (const [id, contenido] of Object.entries(cuentas)) {
    mkdirSync(join(raiz, 'cuentas', id), { recursive: true })
    if (contenido !== undefined) writeFileSync(join(raiz, 'cuentas', id, 'cuenta.json'), typeof contenido === 'string' ? contenido : JSON.stringify(contenido))
  }
  return raiz
}

test('listarCuentas devuelve las carpetas con cuenta.json, ordenadas', () => {
  const raiz = raizCon({ 'b-cuenta': base(), 'a-cuenta': base(), 'sin-config': undefined, _plantilla: base() })
  assert.deepEqual(listarCuentas(raiz), ['a-cuenta', 'b-cuenta'])
})

test('listarCuentas sin carpeta cuentas devuelve vacío', () => {
  assert.deepEqual(listarCuentas(mkdtempSync(join(tmpdir(), 'fabrica-'))), [])
})

test('cargarCuenta devuelve la cuenta con el banco por defecto', () => {
  const raiz = raizCon({ 'apex-stack': base() })
  const c = cargarCuenta('apex-stack', raiz)
  assert.equal(c.usuario, 'apex.stack')
  assert.deepEqual(c.banco, { guiones: 'guiones', ideas: 'ideas.json', hechos: 'hechos.json', tono: 'TONO.md' })
})

test('cargarCuenta tira si el id de la carpeta no coincide', () => {
  const raiz = raizCon({ 'otra-cuenta': base() })
  assert.throws(() => cargarCuenta('otra-cuenta', raiz), /no coincide/)
})

test('cargarCuenta tira con los problemas en el mensaje', () => {
  const raiz = raizCon({ 'apex-stack': con((c) => (c.idioma = 'fr')) })
  assert.throws(() => cargarCuenta('apex-stack', raiz), /idioma/)
})

test('cargarCuenta tira con JSON roto o cuenta inexistente', () => {
  const raiz = raizCon({ 'apex-stack': '{ roto' })
  assert.throws(() => cargarCuenta('apex-stack', raiz), /no es JSON/)
  assert.throws(() => cargarCuenta('no-existe', raiz), /no existe/)
})

test('cargarCuenta rechaza ids que salen de la carpeta', () => {
  assert.throws(() => cargarCuenta('../etc', RAIZ), /id/)
})

test('la cuenta de ejemplo de calcular-ar es válida', () => {
  const c = cargarCuenta('calcular-ar', RAIZ)
  assert.equal(c.id, 'calcular-ar')
  assert.deepEqual(validarCuenta(JSON.parse(readFileSync(join(RAIZ, 'cuentas', 'calcular-ar', 'cuenta.json'), 'utf8'))), [])
})
