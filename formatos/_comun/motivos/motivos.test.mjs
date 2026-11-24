// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { motivoDe } from './index.mjs'

const tema = (/** @type {Record<string, string>} */ p) => /** @type {any} */ ({ paleta: { clave: 'x', ...p } })
const OSCURA = { fondo: '#1D2B13', superficie: '#2A3B1E', tinta: '#F1E7D3', tenue: '#A39B8A', acento: '#E07A3F' }
const CLARA = { fondo: '#EDE4F7', superficie: '#FBF8FE', tinta: '#2B1638', tenue: '#7A6888', acento: '#2C6E9B' }
const sinData = (/** @type {string} */ s) => s.replace(/url\("data:[^"]*"\)/g, '')
const hexes = (/** @type {string} */ s) => new Set([...sinData(s).matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map((m) => m[0].toLowerCase()))

describe('motivos de F2b', () => {
  for (const nombre of ['grilla', 'luz', 'pizarra', 'papel']) {
    test(`${nombre}: tiene su módulo, las cuatro capas y ningún color fijo`, async () => {
      const m = await motivoDe(nombre)
      assert.equal(m.nombre, nombre)
      const a = m.capas(tema(OSCURA))
      const b = m.capas(tema(CLARA))
      for (const id of /** @type {const} */ (['fondo', 'hoja', 'profundo', 'luces'])) {
        assert.match(a[id], new RegExp(`id="${id}"`), `${nombre}: #${id}`)
        // #luces lo ubica el lienzo común; el motivo sólo pone lo que va adentro.
        if (id !== 'luces') assert.match(a.css, new RegExp(`#${id}\\b`), `${nombre}: css de #${id}`)
      }
      const enB = hexes(b.css + b.fondo + b.hoja)
      const fijos = [...hexes(a.css + a.fondo + a.hoja)].filter((x) => enB.has(x))
      assert.deepEqual(fijos, [], `${nombre}: colores que no salen de la paleta`)
      assert.notEqual(a.css, b.css, `${nombre}: la paleta cambia el fondo`)
      // Nunca plano: además del color de fondo, al menos una luz y una textura.
      assert.match(a.css, /radial-gradient/)
      assert.match(a.css, /#grano/)
    })
  }
})
