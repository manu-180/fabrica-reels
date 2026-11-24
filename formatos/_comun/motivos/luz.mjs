// @ts-check
import { derivar, mezclar, rgba } from '../color.mjs'
import { GRANO, cssVars } from './textura.mjs'

/**
 * Luz de estudio: una ventana alta que tira haces en diagonal sobre una pared con degradé, un rebote
 * cálido abajo y profundidad con dos planos de luz que viajan a distinta velocidad. Nada de color de
 * marca en la luz: la luz es blanca (o la superficie), el acento queda para el contenido.
 * @param {import('../tema.mjs').Tema} tema
 */
export function capas(tema) {
  const p = tema.paleta
  const o = derivar(p).oscura
  const pared = mezclar(p.fondo, p.superficie, o ? 0.55 : 0.4)
  const vars = {
    '--l-pared': pared,
    '--l-haz': o ? 'rgba(255,255,255,0.085)' : 'rgba(255,255,255,0.7)',
    '--l-haz-fino': o ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.45)',
    '--l-clave': o ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.95)',
    '--l-rebote': rgba(p.superficie, o ? 0.55 : 0.8),
    '--l-sombra': o ? 'rgba(0,0,0,0.5)' : rgba(p.tinta, 0.09),
    '--l-polvo': rgba(p.tinta, o ? 0.06 : 0.05),
  }
  const css = `${cssVars(vars)}
#fondo { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; overflow: hidden; z-index: 0;
  background: radial-gradient(ellipse 120% 80% at 85% 0%, var(--l-pared) 0%, var(--fondo) 62%); }
#l-clave { position: absolute; left: 340px; top: -700px; width: 1500px; height: 1500px; border-radius: 50%;
  background: radial-gradient(closest-side, var(--l-clave) 0%, var(--l-clave) 12%, transparent 100%); }
#l-haces { position: absolute; left: -600px; top: -400px; width: 2400px; height: 2600px; transform: rotate(24deg); transform-origin: 70% 0%;
  background: repeating-linear-gradient(90deg, transparent 0 140px, var(--l-haz) 140px 290px, transparent 290px 380px, var(--l-haz-fino) 380px 430px, transparent 430px 620px);
  -webkit-mask-image: linear-gradient(180deg, black 0%, black 30%, transparent 78%); mask-image: linear-gradient(180deg, black 0%, black 30%, transparent 78%); filter: blur(18px); }
#l-rebote { position: absolute; left: -300px; top: 1420px; width: 1700px; height: 900px; border-radius: 50%;
  background: radial-gradient(closest-side, var(--l-rebote) 0%, transparent 100%); opacity: 0.7; }
#hoja { position: absolute; left: -2160px; top: -1920px; width: 7560px; height: 13440px; pointer-events: none;
  background-image: radial-gradient(circle at 50% 50%, var(--l-polvo) 0, var(--l-polvo) 2px, transparent 3px), radial-gradient(circle at 50% 50%, var(--l-polvo) 0, var(--l-polvo) 1.5px, transparent 2.5px);
  background-size: 360px 300px, 220px 260px; background-position: 40px 70px, 170px 10px; }
#profundo { position: absolute; left: -1080px; top: -1920px; width: 3240px; height: 13440px; pointer-events: none; transform-origin: 1620px 2880px;
  background: repeating-linear-gradient(180deg, transparent 0 1500px, var(--l-haz-fino) 1500px 1900px, transparent 1900px 3840px); filter: blur(60px); opacity: 0.9; }
#l-sombra { position: absolute; inset: 0;
  background: radial-gradient(ellipse 82% 60% at 58% 34%, transparent 40%, var(--l-sombra) 100%), linear-gradient(180deg, transparent 70%, var(--vineta) 100%); }
#grano { position: absolute; inset: 0; opacity: var(--grano); mix-blend-mode: overlay; background-size: 300px 300px; background-image: ${GRANO(23, 0.68)}; }
`
  return {
    css,
    fondo: '<div id="fondo" data-layout-ignore><div id="l-clave"></div><div id="l-haces"></div><div id="l-rebote"></div></div>',
    hoja: '<div id="hoja" data-layout-ignore></div>',
    profundo: '<div id="profundo" data-layout-ignore></div>',
    luces: '<div id="luces" data-layout-ignore data-layout-allow-occlusion><div id="l-sombra" data-layout-allow-occlusion></div><div id="grano" data-layout-allow-occlusion></div></div>',
  }
}
