// @ts-check
import { derivar, rgba } from '../color.mjs'

/**
 * La hoja cuadriculada de cuaderno de cuentas (el motivo de calcular): cuadros chicos y grandes,
 * margen doble en el acento, lámpara arriba a la izquierda, penumbra y grano. En paletas oscuras es
 * una pizarra cuadriculada.
 * @param {import('../tema.mjs').Tema} tema
 */
export function capas(tema) {
  const p = tema.paleta
  const o = derivar(p).oscura
  const vars = {
    '--cuadro': rgba(p.tinta, o ? 0.095 : 0.07),
    '--cuadro-fuerte': rgba(p.tinta, o ? 0.19 : 0.13),
    '--margen': rgba(p.acento, o ? 0.42 : 0.5),
    '--lampara': o ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.95)',
    '--sombra-hoja': o ? 'rgba(0,0,0,0.5)' : 'rgba(40,32,20,0.13)',
  }
  const css = `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}
#fondo { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; background: ${o ? 'var(--fondo)' : 'color-mix(in srgb, var(--fondo) 91%, var(--tinta))'}; z-index: 0; overflow: hidden; }
#hoja { position: absolute; left: -2160px; top: -1920px; width: 7560px; height: 13440px; pointer-events: none;
  background-image:
    linear-gradient(to right, var(--cuadro-fuerte) 0, var(--cuadro-fuerte) 2px, transparent 2px),
    linear-gradient(to bottom, var(--cuadro-fuerte) 0, var(--cuadro-fuerte) 2px, transparent 2px),
    linear-gradient(to right, var(--cuadro) 0, var(--cuadro) 1px, transparent 1px),
    linear-gradient(to bottom, var(--cuadro) 0, var(--cuadro) 1px, transparent 1px);
  background-size: 240px 240px, 240px 240px, 48px 48px, 48px 48px; background-position: 0 0; }
#profundo { position: absolute; left: -1080px; top: -1920px; width: 3240px; height: 13440px; pointer-events: none; transform-origin: 1620px 2880px; filter: blur(1.5px);
  background-image: linear-gradient(to right, var(--cuadro) 0, var(--cuadro) 3px, transparent 3px), linear-gradient(to bottom, var(--cuadro) 0, var(--cuadro) 3px, transparent 3px);
  background-size: 540px 540px; background-position: 270px 120px; opacity: 0.9; }
#margen { position: absolute; left: 2216px; top: 0; width: 14px; height: 100%; border-left: 3px solid var(--margen); border-right: 3px solid var(--margen); opacity: 0.75; }
#lampara { position: absolute; left: -520px; top: -640px; width: 1900px; height: 1900px; border-radius: 50%;
  background: radial-gradient(closest-side, var(--lampara) 0%, var(--lampara) 22%, transparent 100%); }
#penumbra { position: absolute; inset: 0;
  background: radial-gradient(ellipse 85% 70% at 42% 34%, transparent 52%, var(--vineta) 100%),
    linear-gradient(180deg, transparent 70%, var(--sombra-hoja) 100%); }
#grano { position: absolute; inset: 0; opacity: var(--grano); mix-blend-mode: overlay; background-size: 300px 300px;
  background-image: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='g' x='0' y='0'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' seed='11' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23g)'/%3E%3C/svg%3E"); }
`
  return {
    css,
    fondo: '<div id="fondo" data-layout-ignore><div id="lampara"></div></div>',
    hoja: '<div id="hoja" data-layout-ignore><div id="margen"></div></div>',
    profundo: '<div id="profundo" data-layout-ignore></div>',
    luces: '<div id="luces" data-layout-ignore data-layout-allow-occlusion><div id="penumbra" data-layout-allow-occlusion></div><div id="grano" data-layout-allow-occlusion></div></div>',
  }
}
