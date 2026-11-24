// @ts-check
import { derivar, mezclar, rgba } from '../color.mjs'
import { FIBRAS, GRANO, cssVars } from './textura.mjs'

/**
 * El pizarrón del aula: superficie mate con borrones de tiza (lo que quedó de la clase anterior),
 * polvo fino, renglones guía apenas marcados y la luz del aula desde arriba. En una paleta clara es
 * una pizarra blanca con fantasmas de marcador.
 * @param {import('../tema.mjs').Tema} tema
 */
export function capas(tema) {
  const p = tema.paleta
  const o = derivar(p).oscura
  const losa = mezclar(p.fondo, p.superficie, o ? 0.35 : 0.2)
  const vars = {
    '--pz-losa': losa,
    '--pz-borron': rgba(p.tinta, o ? 0.07 : 0.05),
    '--pz-borron-fuerte': rgba(p.tinta, o ? 0.11 : 0.075),
    '--pz-renglon': rgba(p.tinta, o ? 0.05 : 0.06),
    '--pz-luz': o ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.75)',
    '--pz-canto': o ? 'rgba(0,0,0,0.45)' : rgba(p.tinta, 0.08),
  }
  const borron = (x, y, w, h, giro, fuerte = false) =>
    `<i style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;transform:rotate(${giro}deg);background:radial-gradient(closest-side, var(${fuerte ? '--pz-borron-fuerte' : '--pz-borron'}) 0%, transparent 100%)"></i>`
  const css = `${cssVars(vars)}
#fondo { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; overflow: hidden; z-index: 0; background: var(--pz-losa); }
#pz-luz { position: absolute; left: -200px; top: -760px; width: 1500px; height: 1500px; border-radius: 50%;
  background: radial-gradient(closest-side, var(--pz-luz) 0%, var(--pz-luz) 10%, transparent 100%); }
#pz-polvo { position: absolute; inset: 0; background-image: ${FIBRAS(5, 0.0035, 0.007, o ? 0.09 : 0.05)}; background-size: 1200px 1200px; mix-blend-mode: ${o ? 'screen' : 'multiply'}; opacity: 0.8; }
#hoja { position: absolute; left: -2160px; top: -1920px; width: 7560px; height: 13440px; pointer-events: none;
  background: linear-gradient(to bottom, var(--pz-renglon) 0, var(--pz-renglon) 2px, transparent 2px) 0 0 / 100% 160px repeat; }
#hoja i, #profundo i { position: absolute; display: block; border-radius: 50%; filter: blur(22px); }
#profundo { position: absolute; left: -1080px; top: -1920px; width: 3240px; height: 13440px; pointer-events: none; transform-origin: 1620px 2880px; }
#pz-canto { position: absolute; inset: 0;
  background: radial-gradient(ellipse 85% 62% at 48% 36%, transparent 46%, var(--vineta) 100%), linear-gradient(180deg, transparent 74%, var(--pz-canto) 100%); }
#grano { position: absolute; inset: 0; opacity: var(--grano); mix-blend-mode: overlay; background-size: 300px 300px; background-image: ${GRANO(31, 0.9)}; }
`
  // Los borrones se repiten cada pantalla (1920) para cubrir todo lo que recorre la cámara.
  const pantalla = (dy) => [
    borron(2160 + 80, 1920 + dy + 180, 900, 260, -6, true), borron(2160 + 560, 1920 + dy + 620, 700, 200, 4),
    borron(2160 - 120, 1920 + dy + 1080, 820, 240, -3), borron(2160 + 420, 1920 + dy + 1500, 980, 300, 7, true),
  ].join('')
  const hoja = [0, 1920, 3840, 5760, 7680].map(pantalla).join('')
  const lejos = [0, 2400, 4800, 7200].map((dy) => borron(1080 + 200, 1920 + dy + 400, 1400, 520, 9) + borron(1080 + 900, 1920 + dy + 1300, 1100, 420, -8)).join('')
  return {
    css,
    fondo: '<div id="fondo" data-layout-ignore><div id="pz-luz"></div><div id="pz-polvo"></div></div>',
    hoja: `<div id="hoja" data-layout-ignore>${hoja}</div>`,
    profundo: `<div id="profundo" data-layout-ignore>${lejos}</div>`,
    luces: '<div id="luces" data-layout-ignore data-layout-allow-occlusion><div id="pz-canto" data-layout-allow-occlusion></div><div id="grano" data-layout-allow-occlusion></div></div>',
  }
}
