// @ts-check
import { derivar, rgba } from '../color.mjs'
import { GRANO, cssVars } from './textura.mjs'

/**
 * Plano técnico: grilla mayor y menor con cruces en las intersecciones mayores, un piso de grilla
 * en perspectiva que se pierde en el horizonte (en #profundo) y un foco de luz arriba. Es el fondo
 * de APEX: dice "esto está construido con medida".
 * @param {import('../tema.mjs').Tema} tema
 */
export function capas(tema) {
  const p = tema.paleta
  const o = derivar(p).oscura
  const vars = {
    '--g-mayor': rgba(p.tinta, o ? 0.085 : 0.08),
    '--g-menor': rgba(p.tinta, o ? 0.045 : 0.045),
    '--g-cruz': rgba(p.tinta, o ? 0.32 : 0.26),
    '--g-piso': rgba(p.tinta, o ? 0.12 : 0.1),
    '--g-foco': o ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.85)',
    '--g-horizonte': rgba(p.superficie, o ? 0.9 : 0.75),
  }
  // Las cruces: una máscara (forma fija, sin color) sobre un plano del color del tema, en tile de 240.
  const cruz = "url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cpath d='M106 120H134M120 106V134' stroke='black' stroke-width='3'/%3E%3C/svg%3E\")"
  const css = `${cssVars(vars)}
#fondo { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; overflow: hidden; z-index: 0;
  background: linear-gradient(180deg, var(--fondo) 0%, var(--fondo) 46%, color-mix(in srgb, var(--fondo) 82%, var(--superficie)) 100%); }
#g-foco { position: absolute; left: -380px; top: -520px; width: 1700px; height: 1500px; border-radius: 50%;
  background: radial-gradient(closest-side, var(--g-foco) 0%, var(--g-foco) 16%, transparent 100%); }
#g-horizonte { position: absolute; left: 0; top: 1180px; width: 1080px; height: 740px;
  background: linear-gradient(180deg, transparent 0%, var(--g-horizonte) 100%); opacity: 0.55; }
#hoja { position: absolute; left: -2160px; top: -1920px; width: 7560px; height: 13440px; pointer-events: none;
  background:
    linear-gradient(to right, var(--g-mayor) 0, var(--g-mayor) 2px, transparent 2px) 0 0 / 240px 240px repeat,
    linear-gradient(to bottom, var(--g-mayor) 0, var(--g-mayor) 2px, transparent 2px) 0 0 / 240px 240px repeat,
    linear-gradient(to right, var(--g-menor) 0, var(--g-menor) 1px, transparent 1px) 0 0 / 48px 48px repeat,
    linear-gradient(to bottom, var(--g-menor) 0, var(--g-menor) 1px, transparent 1px) 0 0 / 48px 48px repeat; }
#g-cruces { position: absolute; inset: 0; background: var(--g-cruz); -webkit-mask: ${cruz} -120px -120px / 240px 240px repeat; mask: ${cruz} -120px -120px / 240px 240px repeat; }
#profundo { position: absolute; left: -1080px; top: -1920px; width: 3240px; height: 13440px; pointer-events: none; transform-origin: 1620px 2880px; }
#g-piso { position: absolute; left: 0; top: 3200px; width: 3240px; height: 1600px; transform: perspective(900px) rotateX(64deg); transform-origin: 50% 0%;
  background:
    linear-gradient(to right, var(--g-piso) 0, var(--g-piso) 3px, transparent 3px) 0 0 / 160px 160px repeat,
    linear-gradient(to bottom, var(--g-piso) 0, var(--g-piso) 3px, transparent 3px) 0 0 / 160px 160px repeat;
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, black 30%, black 70%, transparent 100%); mask-image: linear-gradient(180deg, transparent 0%, black 30%, black 70%, transparent 100%); opacity: 0.8; }
#vineta { position: absolute; inset: 0;
  background: radial-gradient(ellipse 78% 56% at 46% 40%, transparent 42%, var(--vineta) 100%), linear-gradient(180deg, transparent 66%, var(--vineta) 100%); }
#grano { position: absolute; inset: 0; opacity: var(--grano); mix-blend-mode: overlay; background-size: 300px 300px; background-image: ${GRANO(13, 0.74)}; }
`
  return {
    css,
    fondo: '<div id="fondo" data-layout-ignore><div id="g-foco"></div><div id="g-horizonte"></div></div>',
    hoja: '<div id="hoja" data-layout-ignore><div id="g-cruces"></div></div>',
    profundo: '<div id="profundo" data-layout-ignore><div id="g-piso"></div></div>',
    luces: '<div id="luces" data-layout-ignore data-layout-allow-occlusion><div id="vineta" data-layout-allow-occlusion></div><div id="grano" data-layout-allow-occlusion></div></div>',
  }
}
