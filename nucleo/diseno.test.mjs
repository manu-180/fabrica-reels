import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distancia, firmaPara, historialDeFirmas, hookDe, resumenFirma } from './diseno.mjs'
import { creativo, cuentaAr, cuentaWeb, estadoCon, firma } from './__fixtures__/ayuda.mjs'

const formato = { layouts: ['hoja', 'zoom', 'lista'].map((id) => ({ id, apto: () => true })) }
const clips = ['noche', 'crema', 'bosque', 'tinta', 'arcilla'].flatMap((p) => ['sello', 'tipografico'].flatMap((estilo) => [{ id: `${p}-${estilo}`, paleta: p, estilo, destino: /** @type {const} */ ('reel') }, { id: `${p}-${estilo}-historia`, paleta: p, estilo, destino: /** @type {const} */ ('historia') }]))
const opciones = { paletas: ['noche', 'crema', 'bosque', 'tinta', 'arcilla'], musicas: ['acustica-1', 'acustica-2', 'tech-house-1', 'tech-house-2'], clips }
const guion = { clave: '001-x', formato: 'explicador', paleta: 'crema', tema: 'celular' }

test('firmaPara: determinista, la paleta del guion en su primera salida y el hook de la ronda', () => {
  const cuenta = cuentaWeb()
  const a = firmaPara({ cuenta, guion, ronda: 0, indice: 0, historial: [], formato, opciones })
  assert.deepEqual(firmaPara({ cuenta, guion, ronda: 0, indice: 0, historial: [], formato, opciones }), a)
  assert.equal(a.paleta, 'crema')
  assert.equal(a.hook, 0)
  assert.ok(cuenta.marca.motivos.includes(/** @type {any} */ (a.motivo)))
  assert.equal(clips.find((c) => c.id === a.cierre)?.destino, 'reel')
  assert.equal(clips.find((c) => c.id === a.cierre)?.paleta, a.paleta)
  assert.deepEqual([hookDe(0, 1, 2), hookDe(1, 0, 2), hookDe(1, 1, 2), hookDe(2, 0, 1)], [1, 2, 0, 2])
  assert.ok(resumenFirma(a).length <= 60)
})

test('firmaPara: las hermanas (variantes del mismo creativo) difieren en 3 ejes o más', () => {
  const cuenta = cuentaWeb()
  const a = firmaPara({ cuenta, guion, ronda: 0, indice: 0, historial: [], formato, opciones })
  const b = firmaPara({ cuenta, guion, ronda: 0, indice: 1, historial: [], formato, opciones, hermanas: [a] })
  assert.ok(distancia(a, b) >= 3, `${distancia(a, b)}`)
  assert.notEqual(a.hook, b.hook)
})

test('firmaPara: un tema que vuelve cambia de layout y de paleta; contra los 3 anteriores difiere en 2 ejes o más', () => {
  const cuenta = cuentaWeb()
  const previas = [
    { tema: 'celular', fecha: '2026-11-01', slot: 0, firmas: [firma({ formato: 'explicador', layout: 'hoja', paleta: 'crema' })] },
    { tema: 'otro', fecha: '2026-11-02', slot: 0, firmas: [firma({ formato: 'explicador', layout: 'zoom', paleta: 'noche', motivo: 'grilla' })] },
    { tema: 'otro2', fecha: '2026-11-03', slot: 0, firmas: [firma({ formato: 'explicador', layout: 'lista', paleta: 'bosque', motivo: 'luz' })] },
  ]
  for (let ronda = 1; ronda < 4; ronda++) {
    const f = firmaPara({ cuenta, guion, ronda, indice: 0, historial: previas, formato, opciones })
    assert.notEqual(f.layout, 'hoja', `ronda ${ronda}`)
    assert.notEqual(f.paleta, 'crema', `ronda ${ronda}`)
    for (const p of previas) assert.ok(distancia(f, p.firmas[0]) >= 2)
  }
})

test('firmaPara: sin música, sin paletas o sin clips de reel no hay firma', () => {
  const cuenta = cuentaAr()
  assert.throws(() => firmaPara({ cuenta, guion, ronda: 0, indice: 0, historial: [], formato, opciones: { ...opciones, musicas: [] } }), /música/)
  assert.throws(() => firmaPara({ cuenta, guion, ronda: 0, indice: 0, historial: [], formato, opciones: { ...opciones, clips: clips.filter((c) => c.destino === 'historia') } }), /clips/)
})

test('historialDeFirmas: un elemento por creativo producido, en orden, sin el que se arma', () => {
  const e = estadoCon('prueba-ar', [creativo('2026-11-02-b', [{}]), creativo('2026-11-01-a', [{}, {}], { tema: 'aguinaldo' }), creativo('2026-11-03-c', [{}], { producido_at: null })])
  const h = historialDeFirmas(e, '2026-11-02-b')
  assert.deepEqual(h.map((x) => [x.fecha, x.tema, x.firmas.length]), [['2026-11-01', 'aguinaldo', 2]])
})
