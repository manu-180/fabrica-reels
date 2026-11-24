// @ts-check
import { derivar, mezclar, rgba } from '../color.mjs'
import { FIBRAS, GRANO, cssVars } from './textura.mjs'

/**
 * Papel de carpeta: fibras, renglones finos con el margen en el acento, la sombra de una hoja de
 * abajo que asoma corrida y la luz de un escritorio. Es el cuaderno de la profe, no el de cuentas
 * (`cuaderno` es cuadriculado). En una paleta oscura es cartulina negra con renglones de tiza.
 * @param {import('../tema.mjs').Tema} tema
 */
export function capas(tema) {
  const p = tema.paleta
  const o = derivar(p).oscura
  const hoja = o ? mezclar(p.fondo, p.superficie, 0.45) : mezclar(p.fondo, p.superficie, 0.65)
  const vars = {
    '--pp-hoja': hoja,
    '--pp-debajo': o ? mezclar(p.fondo, p.superficie, 0.2) : mezclar(p.fondo, p.tinta, 0.04),
    '--pp-renglon': rgba(p.tinta, o ? 0.09 : 0.1),
    '--pp-margen': rgba(p.acento, o ? 0.45 : 0.42),
    '--pp-luz': o ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.9)',
    '--pp-sombra': o ? 'rgba(0,0,0,0.5)' : rgba(p.tinta, 0.1),
  }
  const css = `${cssVars(vars)}
#fondo { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; overflow: hidden; z-index: 0; background: var(--pp-debajo); }
#pp-debajo { position: absolute; left: 34px; top: -40px; width: 1140px; height: 2100px; background: var(--pp-hoja); transform: rotate(-2.2deg); transform-origin: 0 0; opacity: 0.6;
  box-shadow: 0 0 0 1px var(--linea), 0 30px 80px var(--pp-sombra); }
#pp-luz { position: absolute; left: -500px; top: -620px; width: 1900px; height: 1700px; border-radius: 50%;
  background: radial-gradient(closest-side, var(--pp-luz) 0%, var(--pp-luz) 14%, transparent 100%); }
#hoja { position: absolute; left: -2160px; top: -1920px; width: 7560px; height: 13440px; pointer-events: none; background-color: var(--pp-hoja);
  background-image: ${FIBRAS(9, 0.012, 0.03, o ? 0.1 : 0.05)},
    linear-gradient(to right, transparent 2290px, var(--pp-margen) 2290px, var(--pp-margen) 2293px, transparent 2293px, transparent 2302px, var(--pp-margen) 2302px, var(--pp-margen) 2305px, transparent 2305px),
    linear-gradient(to bottom, transparent 0, transparent 70px, var(--pp-renglon) 70px, var(--pp-renglon) 72px, transparent 72px);
  background-size: 600px 600px, 100% 100%, 100% 72px; background-repeat: repeat, no-repeat, repeat;
  box-shadow: 0 40px 120px var(--pp-sombra); }
#profundo { position: absolute; left: -1080px; top: -1920px; width: 3240px; height: 13440px; pointer-events: none; transform-origin: 1620px 2880px; }
#pp-sombra { position: absolute; inset: 0;
  background: radial-gradient(ellipse 80% 62% at 40% 34%, transparent 50%, var(--vineta) 100%), linear-gradient(180deg, transparent 72%, var(--pp-sombra) 100%); }
#grano { position: absolute; inset: 0; opacity: var(--grano); mix-blend-mode: overlay; background-size: 300px 300px; background-image: ${GRANO(41, 0.82)}; }
`
  return {
    css,
    fondo: '<div id="fondo" data-layout-ignore><div id="pp-debajo"></div><div id="pp-luz"></div></div>',
    hoja: '<div id="hoja" data-layout-ignore></div>',
    profundo: '<div id="profundo" data-layout-ignore></div>',
    luces: '<div id="luces" data-layout-ignore data-layout-allow-occlusion><div id="pp-sombra" data-layout-allow-occlusion></div><div id="grano" data-layout-allow-occlusion></div></div>',
  }
}
