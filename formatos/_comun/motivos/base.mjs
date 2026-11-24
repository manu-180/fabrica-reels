// @ts-check
import { derivar, rgba } from '../color.mjs'

/**
 * El fondo de los reels de APEX (luz, contraluz, grilla ancha, viñeta y grano) con la forma de un
 * motivo. Lo usa `motivoDe` mientras el motivo pedido no tenga su módulo (F2b escribe grilla, luz,
 * pizarra y papel): nunca sale un fondo plano.
 * @param {import('../tema.mjs').Tema} tema
 */
export function capas(tema) {
  const p = tema.paleta
  const o = derivar(p).oscura
  const css = `:root{--reja:${rgba(p.tinta, o ? 0.075 : 0.085)};--reja-fina:${rgba(p.tinta, o ? 0.04 : 0.045)}}
#fondo { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; overflow: hidden; background: var(--fondo); z-index: 0; }
#fondo-luz { position: absolute; left: -360px; top: -180px; width: 1800px; height: 1800px; border-radius: 50%;
  background: radial-gradient(closest-side, var(--luz) 0%, var(--luz) 18%, transparent 100%); }
#fondo-contraluz { position: absolute; left: -420px; top: 1180px; width: 1300px; height: 1300px; border-radius: 50%; opacity: 0.6;
  background: radial-gradient(closest-side, var(--luz) 0%, transparent 100%); }
#hoja { position: absolute; left: -2160px; top: -1920px; width: 7560px; height: 13440px; pointer-events: none;
  background-image: linear-gradient(to right, var(--reja) 0, var(--reja) 2px, transparent 2px), linear-gradient(to bottom, var(--reja) 0, var(--reja) 2px, transparent 2px);
  background-size: 120px 120px; background-position: 0 0; }
#profundo { position: absolute; left: -1080px; top: -1920px; width: 3240px; height: 13440px; pointer-events: none; transform-origin: 1620px 2880px; filter: blur(2px);
  background-image: linear-gradient(to right, var(--reja-fina) 0, var(--reja-fina) 4px, transparent 4px), linear-gradient(to bottom, var(--reja-fina) 0, var(--reja-fina) 4px, transparent 4px);
  background-size: 600px 600px; background-position: 300px 160px; }
#vineta { position: absolute; inset: 0;
  background: radial-gradient(ellipse 70% 52% at 50% 44%, transparent 40%, var(--vineta) 100%),
    linear-gradient(180deg, transparent 62%, var(--vineta) 100%); }
#grano { position: absolute; inset: 0; opacity: var(--grano); mix-blend-mode: overlay; background-size: 300px 300px;
  background-image: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='g' x='0' y='0'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.72' numOctaves='3' seed='7' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23g)'/%3E%3C/svg%3E"); }
`
  return {
    css,
    fondo: '<div id="fondo" data-layout-ignore><div id="fondo-luz"></div><div id="fondo-contraluz"></div></div>',
    hoja: '<div id="hoja" data-layout-ignore></div>',
    profundo: '<div id="profundo" data-layout-ignore></div>',
    luces: '<div id="luces" data-layout-ignore data-layout-allow-occlusion><div id="vineta" data-layout-allow-occlusion></div><div id="grano" data-layout-allow-occlusion></div></div>',
  }
}
