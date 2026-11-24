# Formatos (F2a y F2b)

Plantillas HyperFrames neutras de marca. Cada formato exporta lo de `docs/CONTRATO.md` § 5:
`armar({ guion, hook, voz, salida, diseno, tema })`, `validar(guion)` (sin IO) y `layouts`.

| Formato | Layouts | Qué es |
|---|---|---|
| `chat` | `telefono`, `hoja` | La charla en un celular con teclado, o en la hoja con la cabecera grande; remate con cifra enorme |
| `mito` | `hoja`, `panel` | Lo que se cree se achica (o su panel de tinta se levanta) y lo que es sube palabra por palabra |
| `explicador` | `hoja`, `zoom` (guiones con `titulo`, `cuenta`, `comparacion`), `pantallas` (con `navegador`, `busqueda`, `celular-vs-compu`, `codigo`) | Bloques que entran cuando la voz dice su `frase` |
| `antes-despues` | `web`, `app` | `web`: la web vieja con sus defectos marcados (los subtítulos caen en su libro de visitas blanco, nunca sobre la foto pixelada), el barrido a la nueva y la vuelta al celular. `app`: el caos de quien da clases (planilla en la pared, grupo de mensajes, cuaderno de asistencia) y las pantallas reales de la app (`pantallas/`, capturas de sus videos de App Store) en un celular. Lo elige `antes.tipo` (`web` o `papel`) o, si no está, los defectos |
| `lista-de-errores` | `pila`, `tarjetas`, `tachon` | Tres errores que se tachan cuando la voz termina de decirlos y su arreglo sube con un tilde: en una lista, en tarjetas que corren a la izquierda, o en carteles que el tachón parte al medio |
| `pregunta` | `comentario`, `titular` | Una pregunta de comentario (sin usuario ni foto) y la respuesta de la cuenta colgada en hilo con su logo; o la pregunta enorme entre comillas y la respuesta que la empuja |
| `comparador` | `columnas`, `rondas` | A contra B fila por fila (tilde y cruz cuando la voz dice cada punto) que se resuelve: la columna que pierde se va y la que gana toma el centro; o una ronda por punto y el veredicto con la etiqueta ganadora enorme |
| `cuenta-regresiva` | `calendario`, `reloj` | Tres pasos hacia una fecha (`AAAA-MM-DD`): el mes con un anillo que salta de día en día y el día que se llena del acento; o un odómetro que rueda los días que faltan y le deja el lugar a la fecha |
| `_cierre` | `tipografico`, `buscador` | El cierre genérico (no es un formato de guion; ver `_cierre/README.md`) |

## El tema (`_comun/tema.mjs`, congelado)

```js
import { temaDe, temaCss, copiarTema } from './_comun/tema.mjs'
const tema = temaDe({ cuenta, dirCuenta, paleta: firma.paleta, motivo: firma.motivo })
```

- `temaDe` lee `marca.paletas`, `marca.fuentes`, `marca.logo` de la cuenta. La familia y el peso salen del
  nombre del archivo (`bricolage-grotesque-latin-800-normal.woff2` → "Bricolage Grotesque" 800).
- Las **hermanas** de una fuente (mismo nombre con otro peso, en la misma carpeta) también se cargan: la
  cuenta decide qué pesos tiene. Una plantilla puede pedir 500 o 600 del cuerpo; si la cuenta no los tiene,
  el navegador usa el más cercano (`font-synthesis: none`, nunca negrita falsa).
- `temaCss(tema)` deja las variables del contrato (`--fondo`, `--superficie`, `--tinta`, `--tenue`,
  `--acento`, `--f-titulo`, `--f-cuerpo`, `--f-mono`, `--radio`, `--tracking-titulo`), los pesos
  (`--p-titulo`, `--p-cuerpo`, `--p-mono`), las derivadas (`--sobre-acento`, `--acento-texto`, `--resalte`,
  `--resalte-tinta`, `--linea`, `--linea-fuerte`, `--sombra-1/2`, `--luz`, `--vineta`, `--grano`) y los
  `@font-face`. Las sombras son neutras: nunca del acento.
- `copiarTema(tema, salida)` copia fuentes y logo a `salida/assets/`.

Las plantillas no tienen colores, fuentes ni textos escritos. Lo controla `tema.test.mjs`: arma cada layout
con dos cuentas inventadas (colores y fuentes que ninguna marca usa, una en castellano y otra en inglés) y
falla si un color no cambia con el tema (salvo `NEUTROS` de `_comun/color.mjs` y los `COLORES_FIJOS` que un
formato declara como contenido, como la web vieja de `antes-despues`), si aparece una `font-family` que no
sale del tema, si queda castellano en el render en inglés, o si el código nombra una marca o una fuente.

## Textos por idioma

`_comun/textos.es-AR.json` y `textos.en-US.json` (mismas claves, lo verifica el test). En el HTML van como
`{{t:chat.mensaje}}` (los reemplaza `rellenar(plantilla, vars, tema.idioma)`); lo que arma el script viaja en
`assets/datos.js`. Un idioma nuevo es un archivo nuevo y su entrada en `IDIOMAS`.

## Motivos (`_comun/motivos/`)

Cada motivo exporta `capas(tema) → { css, fondo, hoja, profundo, luces }` con ids fijos: `#fondo` (quieto,
primero), `#hoja` (adentro de `#riel`, viaja con la cámara: mide ≥ 7 pantallas), `#profundo` (parallax lento,
adentro de `#camara`) y `#luces` (viñeta y grano, encima, z-index 40). `cuaderno.mjs` es el de calcular. Los
de F2b (`grilla`, `luz`, `pizarra`, `papel`) se suman con la misma forma; mientras no existan, `motivoDe` usa
`base.mjs` (luz, contraluz, grilla ancha, viñeta y grano: nunca un fondo plano).

| Motivo | Qué es | Cuenta |
|---|---|---|
| `grilla` | Plano técnico: grilla mayor y menor, cruces en las intersecciones, piso en perspectiva y foco | APEX |
| `luz` | Luz de estudio: haces en diagonal, clave arriba a la derecha, rebote abajo, polvo en el aire | APEX |
| `pizarra` | Pizarrón con borrones de tiza, polvo y renglones guía (en paleta clara, pizarra blanca) | Assistify |
| `papel` | Hoja de carpeta con renglones, margen en el acento, fibras y la hoja de abajo corrida | Assistify |

Las texturas que comparten (grano, fibras) viven en `motivos/textura.mjs`, que no es un motivo.

## Probar

```bash
node formatos/_comun/probar.mjs --cuenta calcular-ar --guion 009-aguinaldo-mitos --layout panel --paleta papel --voz <dir>/009-aguinaldo-mitos --salida pruebas
node formatos/_comun/probar.mjs --cuenta apex-webssites --guion 004-panaderia-antes-despues --paleta noche --motivo luz --salida pruebas
```

Sin `--voz`, una voz muda con tiempos sintéticos (para mirar el diseño sin pagar ElevenLabs). Deja el mp4 y
una hoja de contactos (`-hoja.jpg`, 2 cuadros por segundo) para revisar.

## Lo que viene de afuera

- `antes-despues/fotos/`: una foto por rubro (de `apex-demos`, generadas sin personas ni texto). Un rubro nuevo
  es una foto nueva y su nombre en `textos.<idioma>.json` (`antes_despues.rubros`).
- `_comun/sfx/` y `_comun/vendor/gsap.min.js`: los de calcular. Picos medidos en `SFX` de `_comun/assets.mjs`.
