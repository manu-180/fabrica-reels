# Contrato entre las piezas de la fábrica (F0, 2026-11-23)

Las firmas y formas de datos que comparten las fases. El porqué de cada cosa está en
`docs/decisiones/fabrica.md` (el diseño); acá está el qué, con tipos. **Este archivo lo cambia sólo
el coordinador.** Si una fase necesita otra firma, lo pide; no la cambia por su cuenta.

Convenciones para todo el código:

- ESM (`.mjs`), node ≥ 22, `// @ts-check` y JSDoc. Sin dependencias salvo `@vercel/blob` (lo
  instala el workflow) y lo que ya usa calcular (`hyperframes@0.8.140` vía `npx`).
- Horas siempre de Buenos Aires (`America/Argentina/Buenos_Aires`), también en cuentas en inglés:
  las franjas de @apex.webssites ya vienen convertidas. Instantes en ISO UTC (`...Z`), días como
  `AAAA-MM-DD` del día de Buenos Aires.
- Lo que no se pudo medir es `null`, nunca `0`.
- Funciones puras sin IO donde se pueda; el IO entra por parámetros (`fetch`, `put`, `head`,
  `reloj`, `env`, `log`) para poder probar con dobles.
- Mensajes para personas en castellano rioplatense, sin rayas.

## 1. La cuenta: `cuentas/<id>/cuenta.json`

Lo carga y valida `nucleo/cuenta.mjs` (hecho en F0, con tests). El typedef completo `Cuenta` vive
en ese archivo; acá van los campos y sus reglas.

```js
import { cargarCuenta, listarCuentas, validarCuenta, porDiaHoy, accionesPorDia, dirCuenta, variablePausa } from './nucleo/cuenta.mjs'

/** @returns {string[]} ids de cuentas/<id>/cuenta.json, ordenados (carpetas con _ o . no cuentan) */
listarCuentas(raiz)
/** Tira con TODOS los problemas juntos; devuelve la cuenta con `banco` completado por defecto. */
cargarCuenta(id, raiz)            // → Cuenta
/** Nunca tira. Vacío = válida. */
validarCuenta(obj)                // → string[] (problemas en castellano, con el campo adelante: "antispam.gap_min: ...")
/** Cuánto toca hoy según la rampa (ver abajo). */
porDiaHoy(cuenta, fecha, { escalon })  // → { creativos, variantes, acciones, escalon: number | null }
accionesPorDia(cuenta, { creativos, variantes }?)  // → creativos × variantes × destinos activos
dirCuenta(id, raiz)               // → ruta de cuentas/<id>, tira si el id no es kebab-case
variablePausa('apex-stack')       // → 'FABRICA_PAUSADA_APEX_STACK'
```

| Campo | Tipo | Regla |
|---|---|---|
| `version` | `1` | |
| `id` | kebab-case | igual a la carpeta |
| `usuario` | `string` | usuario de Instagram sin `@`; se verifica contra `GET /{ig-user}?fields=username` antes de publicar |
| `idioma` | `'es-AR' \| 'en-US'` | |
| `activa` | `boolean` | `false`: planear la saltea en segundos |
| `modo` | `'real' \| 'sombra'` | sombra produce y deja artefactos, no publica |
| `creativos_por_dia` | entero 1 a 10 | el techo; la rampa puede dar menos |
| `variantes_por_creativo` | entero 1 a 3 | APEX 2, el resto 1 |
| `destinos.prueba` | `{ activo, trial: 'MANUAL' \| 'SS_PERFORMANCE' }` | |
| `destinos.normal` | `{ activo, share_to_feed, espera_min }` | `espera_min` cuenta desde que salió su prueba |
| `destinos.historia` | `{ activo, espera_min, cierre: 'reel' \| 'historia' }` | `espera_min` desde su normal; `cierre: 'historia'` pide `cierre.texto_historia` |
| `franjas` | `{ desde: 'HH:MM', hasta: 'HH:MM' }[]` | ≥ 1, ordenadas, sin pisarse, hora de BA |
| `antispam` | `{ max_dia, max_dia_propias, gap_min, max_por_corrida, reserva_cupo }` | `max_dia` cuenta propias + ajenas leídas de Instagram (D5); `max_dia_propias ≤ max_dia`; `reserva_cupo` 0 a 99 |
| `rampa` | `null \| { inicio: 'AAAA-MM-DD', escalones: { creativos, acciones, variantes?, dias? }[] }` | ver abajo |
| `voz` | `{ proveedor, modelo, voice_id, ajustes, pausas, respaldo, presupuesto_mes }` | `voice_id: null` sólo con `activa: false` (cuenta esperando su audición, F3) |
| `voz.ajustes` | `{ stability, similarity_boost, style, use_speaker_boost? }` | 0 a 1 |
| `voz.pausas` | `{ tras_hook, entre, antes_cta, coma, pregunta?, cola? }` | segundos |
| `voz.respaldo` | `null \| { proveedor: 'gemini', voz, estilo }` | |
| `marca` | `{ paletas, fuentes: { titulo, cuerpo, mono }, tracking_titulo, motivos, logo, radio, formatos }` | rutas relativas a `cuentas/<id>/`, sin `..`; `motivos` 1 a 3 de `cuaderno, grilla, luz, pizarra, papel`; `formatos` son carpetas de `formatos/` |
| `cierre` | `{ texto_voz, texto_historia?, caption, clips, palabra_clave }` | `caption` ≤ 300; `palabra_clave` en mayúscula o `null` (activa `comentarios_web`) |
| `captions` | `{ hashtags_por_post: [min, max], hashtags_fijos }` | hashtags sin `#`, minúscula |
| `secretos` | `{ ig_user, ig_token, ig_insights? }` | **nombres** de secretos de GitHub (`MAYÚSCULAS_CON_GUION`), nunca valores. `ig_insights: null` = usa `ig_token` |
| `reglas_texto` | `{ prohibidas, max_palabras_voz: [min, max], sin_montos, fuentes_dominios }` | `fuentes_dominios: null` = sin restricción |
| `banco` (opcional) | `{ guiones, ideas, hechos, tono }` | por defecto `guiones`, `ideas.json`, `hechos.json`, `TONO.md` |
| `kairo` | `{ seccion }` | |

Reglas cruzadas que valida `validarCuenta`:

- Campo desconocido en cualquier nivel = problema (un typo no pasa callado).
- `accionesPorDia(cuenta) ≤ antispam.max_dia_propias`.
- Las franjas dan lugar: `Σ (floor(duración / gap_min) + 1) ≥ min(planeadas, max_dia_propias)`.
- Al menos un destino activo.
- Rampa: cada escalón `creativos ≤ creativos_por_dia`, `variantes ≤ variantes_por_creativo`,
  `acciones ≤ max_dia_propias` y `creativos × variantes × destinos activos ≤ acciones`; nunca baja
  respecto del anterior.

**Rampa** (`porDiaHoy`): cada escalón dura `dias` (por defecto 7) contados desde `inicio`; el último
se sostiene. Antes de `inicio` devuelve `{ creativos: 0, acciones: 0, escalon: -1 }`. Sin rampa
devuelve lo de la cuenta con `escalon: null`. El tercer parámetro es el escalón que sostiene el
estado (`estado.rampa.escalon`, que baja tras un antispam, § 2): el resultado nunca pasa de ese.
Subir de escalón "sólo tras 7 días sin error" lo decide `antispam.mjs` (F1) escribiendo
`estado.rampa`; `porDiaHoy` no mira el estado más allá de ese número. Tampoco mira `activa` ni
`modo`: eso lo decide `planear`.

Archivos que la cuenta referencia (los escribe F5, la forma se fija acá):

```ts
// marca/paletas.json: 4 a 6 paletas, claves kebab
type Paletas = Record<string, { fondo: Hex, superficie: Hex, tinta: Hex, tenue: Hex, acento: Hex }>
// cta/clips.json
type Clip = { id: string, paleta: string, estilo: string, destino: 'reel' | 'historia', archivo: string, duracion_s: number }
// hechos.json
type Hecho = { id: string, tipo: 'dato' | 'oferta' | 'producto' | 'norma', texto: string, cifras: string[],
               fuente: string /* 'repo:<repo>:<archivo>:<línea>' | 'https://...' | 'manuel:AAAA-MM-DD' */, envejece: string | null }
// ideas.json
type Idea = { id: string, tema: string, angulo: string, formato_sugerido: string, hechos: string[],
              ventana: { desde: 'MM-DD', hasta: 'MM-DD' } | null, origen: 'hechos' | 'dolor' | 'rendimiento' | 'temporada' }
```

El guion (`guiones/<clave>.json` y `guiones-auto/` en la rama `estado`) es el de
`calcular/marketing/reels/scripts/prueba/CONTRATO.md` § El guion, con estos cambios: `categoria`
libre por cuenta (kebab-case), `paleta` opcional (una clave de `marca/paletas.json`), `hechos:
string[]` (ids de `hechos.json`, obligatorio si el texto tiene cifras; calcular mantiene además
`fuentes`) y `tema` (kebab-case, el de la idea: la variedad y el puntaje van por tema).

## 2. El estado v2: `cuentas/<id>/estado.json` en la rama `estado`

Lo leen, serializan y fusionan `nucleo/estado.mjs` (F1). Un archivo por cuenta; nadie más que el
job de esa cuenta lo escribe (y Kairo sólo `pausado`).

```js
/**
 * @typedef {{
 *   version: 2, cuenta: string, actualizado: string,
 *   pausado: string | null,                       // motivo legible; con texto no se produce ni publica
 *   pausado_por: 'token' | 'permiso' | 'bloqueo' | 'antispam' | 'manual' | null,
 *   pausado_hasta: string | null,                 // ISO; null = hasta despausar (token: se levanta solo)
 *   insights: { disponible: boolean, motivo: string | null },
 *   destinos_apagados: Partial<Record<'prueba' | 'normal' | 'historia', { motivo: string, at: string }>>,  // D6
 *   rampa: { escalon: number, desde: string, bajadas: { at: string, codigo: string }[] } | null,
 *   saltados: Record<string, { motivo: string, at: string }>,   // guiones que no validaron
 *   creativos: Record<string, Creativo>,          // id = `${fecha}-${clave}`
 * }} EstadoV2
 *
 * @typedef {{
 *   id: string, clave: string, idea: string | null, tema: string | null, fecha: string,
 *   titulo: string, categoria: string, formato: string,
 *   ronda: number,                                // cuántas veces había salido el guion antes
 *   slot: number,                                 // orden del creativo en el día (reparte las franjas, § 3)
 *   producido_at: string | null, error: string | null, falla: 'guion' | 'general' | null, intentos: number,
 *   voz: { proveedor: string, caracteres_pagados: number, caracteres_cache: number } | null,
 *   variantes: Variante[],
 * }} Creativo
 *
 * @typedef {{
 *   indice: number,                               // 0..variantes_por_creativo-1
 *   hook: 0 | 1 | 2,                              // (ronda·V + indice) % 3
 *   firma: Firma,
 *   resumen: string,                              // ≤ 60, en criollo
 *   video_url: string | null,                     // mp4 del reel (Blob)
 *   video_historia_url: string | null,            // sólo si destinos.historia.cierre === 'historia'
 *   duracion_s: number | null,
 *   publicaciones: Partial<Record<'prueba' | 'normal' | 'historia', Publicacion>>,  // sólo los destinos activos al producir
 * }} Variante
 *
 * @typedef {{
 *   formato: string, layout: string, motivo: string, paleta: string, hook: number,
 *   musica: string, cierre: string, color: string, textura: string,
 *   ffmpeg: { zoom: number, encuadre: string, velocidad: number },
 * }} Firma
 *
 * @typedef {{
 *   destino: 'prueba' | 'normal' | 'historia',
 *   caption: string,                              // '' en historia
 *   no_antes_de: string | null,                   // null = espera a su anterior (§ 3)
 *   vence: string,                                // fin del día de BA de `fecha`
 *   creando_at: string | null, ig_container_id: string | null,
 *   ig_media_id: string | null, permalink: string | null, publicado_at: string | null,
 *   error_publicar: string | null, clase_error: ClaseError | null, intentos_publicar: number,
 *   descartada_at: string | null, motivo_descarte: string | null,
 *   metricas: Metricas | null,                    // la última lectura
 *   metricas_72h: Metricas | null,                // la foto que puntúa (historia: la de ~20 h)
 * }} Publicacion
 *
 * @typedef {{ medido_at: string, vistas: number | null, alcance: number | null, likes: number | null,
 *   comentarios: number | null, compartidos: number | null, guardados: number | null,
 *   comentarios_web: number | null, promedio_visto_s: number | null,
 *   respuestas: number | null, avances: number | null, salidas: number | null,   // historia
 *   preguntas: string[] | null }} Metricas         // comentarios con "?", para el informe de ideas
 *
 * @typedef {'token' | 'permiso-trial' | 'permiso' | 'bloqueo' | 'antispam' | 'cupo' | 'transitorio' | 'publicacion'} ClaseError
 */
```

```js
leerEstado(texto, cuentaId)        // → EstadoV2; vacío → estadoVacio; roto o de otra cuenta → TIRA (nunca arranca de cero)
estadoVacio(cuentaId, ahora)       // → EstadoV2
serializarEstado(e)                // → string, orden estable de claves, '\n' final
migrarV1(estadoV1, cuentaId)       // → EstadoV2 (M1: cada variante vieja pasa a publicaciones[tipo ?? 'prueba'])
fusionarEstado(base, remoto, propio)  // → EstadoV2
```

**Fusión** (`fusionarEstado`, tres vías como la de calcular): `base` es lo que esta corrida leyó,
`remoto` la punta de la rama, `propio` lo que esta corrida deja.

1. Por clave de primer nivel: si `propio` no cambió respecto de `base`, vale `remoto`; si cambió,
   vale `propio`. `actualizado` = el mayor.
2. `creativos` por id; adentro, por campo igual que 1, salvo `variantes`, que va por `indice`; adentro
   de cada variante, por campo, salvo `publicaciones`, que va por destino como objeto entero.
3. **Monótonos**: `ig_container_id`, `ig_media_id`, `publicado_at` y `creando_at` nunca se pierden.
   Si la regla 1 elige un lado que no los tiene y el otro sí, se quedan los del otro. Es lo que
   impide publicar dos veces tras una carrera.
4. Borrar un creativo sólo lo hace `limpiar` con un `propio` que no lo tiene y una `base` que sí.

`correr.mjs fusionar` reintenta 8 veces con espera creciente; siempre fast-forward, nunca force push.

## 3. La cola de publicaciones (`nucleo/agenda.mjs`, F1)

Cada publicación se identifica con `ref = { creativo, variante, destino }` (texto:
`<creativo>/<indice>/<destino>`).

```js
agendar({ cuenta, creativos, dia, semilla })   // al producir: pone no_antes_de y vence a cada publicación
cola({ estado, cuenta, ahora })                // → { ref, no_antes_de, vence }[] pendientes, por no_antes_de
siguiente({ estado, cuenta, ahora, cuentaReal })  // → ref | null: la vencida más vieja que pasa el antispam
alPublicar({ estado, cuenta, ref, publicado_at, semilla })  // pone el reloj de la que sigue
descartarViejas({ estado, ahora })             // a medianoche de BA, con motivo
```

Relojes (todo determinista por `semilla = cuenta|creativo|indice|destino`):

- **Slots**: el día tiene `creativos × variantes` slots, en orden de creativo y variante. Las franjas
  se ponen una detrás de otra como una sola línea de minutos y se parten en partes iguales; el slot
  `i` toma la parte `i`.
- `prueba.no_antes_de`: un minuto al azar dentro de su parte, nunca terminado en 0 o 5, y no más
  tarde que `fin de la última franja − (espera normal + espera historia + 50)`.
- `normal.no_antes_de`: `null` al producir; `alPublicar` de la prueba lo pone en
  `publicado_at + espera_min + azar(3..25)`. Si la prueba se descarta o su destino está apagado,
  hereda el `no_antes_de` de la prueba (sale en su lugar).
- `historia.no_antes_de`: igual, desde la normal.
- Si un reloj cae fuera de franja, se corre al arranque de la franja siguiente + `azar(3..25)`; si no
  queda franja ese día, se descarta (`motivo_descarte: 'sin franja'`).
- `vence` = 23:59:59 de BA del día del creativo. Una historia cuya normal salió después de las 23:00
  se descarta.
- Una publicación de un destino en `estado.destinos_apagados` no entra a la cola; su siguiente hereda.

`siguiente` elige como mucho `antispam.max_por_corrida` por tic (hoy 1) y nunca una cuya anterior
está pendiente.

## 4. Antispam (`nucleo/antispam.mjs`, F1)

```js
/** Lectura real de la cuenta (D5): todo lo publicado en 24 h por cualquiera. */
leerCuentaReal({ igUser, token, ahora, fetch })  // → CuentaReal
/** @typedef {{ publicaciones_24h: { at: string, tipo: 'REELS' | 'STORY' | 'FEED' | string, propia: boolean }[],
 *              ultima_at: string | null, cupo: { usado: number, total: number } | null, username: string | null }} CuentaReal */
puedePublicar({ cuenta, estado, cuentaReal, ahora })  // → { ok: true } | { ok: false, motivo: string }
aplicarErrorRampa({ estado, cuenta, codigo, ahora })  // baja un escalón; dos en 7 días: pausa 48 h
```

`propia` = su `ig_media_id` está en el estado. No pasa si: 24 h ≥ `max_dia`; propias de hoy ≥
`porDiaHoy(...).acciones`; última de la cuenta hace < `gap_min`; cupo libre < `reserva_cupo`;
`username` distinto de `cuenta.usuario`. Lo que no sale por antispam no cuenta intento.

Errores de Meta: `clasificarErrorMeta(e, { destino }) → ClaseError` con la tabla del diseño § 8.4.

## 5. Los formatos (`formatos/<formato>/armar.mjs`, F2a y F2b)

```js
/**
 * @param {{
 *   guion: object,
 *   hook: 0 | 1 | 2,
 *   voz: { wav: string, duracion_s: number, palabras: { texto: string, inicio_s: number, fin_s: number }[] } | null,  // null en chat
 *   salida: string,          // carpeta vacía: ahí queda el proyecto HyperFrames, con todos sus assets (sin red al renderizar)
 *   diseno: Diseno,
 *   tema: Tema,
 * }} p
 * @returns {Promise<{ duracion_s: number }>}
 */
export async function armar(p)

/** @param {object} guion @returns {string[]} problemas; vacío = válido. Sin IO. */
export function validar(guion)

/** Los layouts del formato; diseno.mjs elige uno apto. */
export const layouts /* : { id: string, apto: (guion) => boolean }[] */

/**
 * @typedef {{ ronda: number, firma: Firma, layout: string, paleta: string }} Diseno
 *   layout === firma.layout y paleta === firma.paleta (vienen aparte por comodidad de la plantilla)
 *
 * @typedef {{
 *   idioma: 'es-AR' | 'en-US',
 *   paleta: { clave: string, fondo: string, superficie: string, tinta: string, tenue: string, acento: string },
 *   fuentes: { titulo: Fuente, cuerpo: Fuente, mono: Fuente },
 *   tracking_titulo: number,
 *   motivo: 'cuaderno' | 'grilla' | 'luz' | 'pizarra' | 'papel',
 *   logo: string,            // ruta absoluta al svg de la cuenta
 *   radio: number,
 *   contraste: { tinta_sobre_acento: string },   // calculado (WCAG) por tema.mjs
 * }} Tema
 * @typedef {{ archivo: string, familia: string, peso: number }} Fuente   // archivo: ruta absoluta
 */
```

- `voz.palabras` incluye el hook al principio. Los últimos 0,3 s quedan quietos (ahí se pega el
  cierre). El audio lleva voz y sfx, **sin música**.
- La plantilla no escribe colores, fuentes ni textos de marca: todo sale de `tema`; los rótulos fijos
  de `formatos/<f>/textos.<idioma>.json`. Lo verifica `formatos/tema.test.mjs`.
- `formatos/_comun/tema.mjs` (F2a) exporta `temaDe({ cuenta, dirCuenta, paleta, motivo }) → Tema` y
  `temaCss(tema) → string` (variables `--fondo`, `--superficie`, `--tinta`, `--tenue`, `--acento`,
  `--f-titulo`, `--f-cuerpo`, `--f-mono`, `--radio`, `--tracking-titulo`), y
  `copiarTema(tema, salida)` (fuentes y logo a `salida/`). Congelado al cerrar F2a.
- Render: `npx hyperframes@0.8.140 render <salida> -o <mp4> --fps 30 -q delivery` con las banderas
  de `render.mjs` de calcular. 1080×1920, 30 fps, zona segura de Reels.

`nucleo/diseno.mjs` (F1): `firmaPara({ cuenta, guion, ronda, indice, historial, formato }) → Firma`
con las reglas del diseño § 5.3 (no repite `layout` ni `paleta` del mismo tema; difiere en ≥ 2 ejes
de cada uno de los 3 creativos anteriores; hermanas en ≥ 3 ejes).

## 6. La voz (`nucleo/voz/**`, F3)

```js
/**
 * @param {{ cuenta: Cuenta, hook: string, cuerpo: string | null, env, fetch, blob: { head, put, get }, log }} p
 * @returns {Promise<{ wav: string, duracion_s: number, palabras: Palabra[], proveedor: string,
 *                     caracteres_pagados: number, caracteres_cache: number }>}
 */
export async function locutar(p)

/** sha256 hex del JSON canónico (claves ordenadas) de estos campos; texto normalizado (NFC, trim, espacios simples). */
export function claveVoz({ proveedor, modelo, voice_id, ajustes, pausas, texto, previo, siguiente })

export async function presupuesto({ cuenta, estado, env, fetch })  // → { quedan_ciclo: number | null, quedan_mes_cuenta: number }
```

- Caché por **oración**: Blob `voz/<cuenta>/<hash>.mp3` + `voz/<cuenta>/<hash>.json`
  `{ texto, proveedor, duracion_s, palabras, bordes: { inicio_s, fin_s }, caracteres, creado_at }`.
  `head()` antes de pedir: si está, no se paga.
- Gemini es otra clave (el `proveedor` entra al hash) y nunca pisa una entrada de ElevenLabs.
- Orden si no alcanza el presupuesto: cacheados y `chat` primero, después `presupuesto_mes` de la
  cuenta, Gemini sólo en `historia`.

## 7. Puntaje (`nucleo/puntaje.mjs`, F7)

```js
puntuar({ estado, cuenta, ahora })   // → { publicaciones: Record<ref, number | null>, creativos: Record<id, number | null>,
                                     //     temas: Record<tema, { puntaje: number, n: number }>, con_insights: boolean }
informe({ estados, cuentas, ahora }) // → { por_cuenta: { cuenta, mejores: Tema[], peores: Tema[], preguntas: string[], sin_estadisticas: boolean }[] }
```

- Con insights: `p = 0,35·z(retención) + 0,25·z(compartidos/alcance) + 0,20·z(guardados/alcance)
  + 0,10·z(comentarios/alcance) + 0,10·z(likes/alcance)` + `0,30·z(comentarios_web/alcance)` si la
  cuenta tiene `palabra_clave`. `z` dentro de la misma cuenta y destino, últimos 30 días, sobre
  `metricas_72h`.
- Sin insights: percentil de `likes + 3·comentarios + 10·comentarios_web` dentro de cuenta, destino y
  día; `con_insights: false`.
- Creativo: promedio de sus publicaciones con dato. Tema: `(Σp) / (n + 3)`.
- Sin datos, `null`.

## 8. La entrada: `nucleo/correr.mjs` (F1; los workflows son F6)

```
node nucleo/correr.mjs planear  [--cuenta <id>]
node nucleo/correr.mjs producir --cuenta <id> [--guion <clave>] [--seco <dir>]
node nucleo/correr.mjs publicar --cuenta <id> [--ahora] [--seco]
node nucleo/correr.mjs medir    --cuenta <id>
node nucleo/correr.mjs fusionar <base> <remoto> <propio> <salida>
```

- `planear` sólo usa node (sin instalar nada), lee todas las cuentas (o una) y escribe en
  `GITHUB_OUTPUT` `matriz={"include":[{"cuenta":"apex-stack","producir":true,"publicar":false,"medir":true}]}`
  sólo con las cuentas que tienen algo que hacer, y `hay=true|false`. Saltea `activa: false`, las
  pausadas (estado o `FABRICA_PAUSADA`, `variablePausa(id)`) y, en publicar, `modo: 'sombra'`.
- `producir`, `publicar` y `medir` exigen `--cuenta`. `--seco` hace todo menos Blob, Instagram y el
  push: deja mp4 y `estado.json` en `<dir>`. `--ahora` ignora `no_antes_de` (no el antispam).
- Entorno: `FABRICA_RAIZ` (checkout de `main`, por defecto la raíz del repo), `FABRICA_ESTADO`
  (checkout de la rama `estado`), `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`, `BLOB_READ_WRITE_TOKEN`, y
  los IG de la cuenta **con sus propios nombres** (`env[cuenta.secretos.ig_token]`): el workflow
  exporta sólo los de la cuenta del job. El render corre con `entornoSinSecretos()`.
- `publicar` pushea el estado tras crear cada contenedor y tras cada `media_publish` (callback
  `guardar(estado)` que el workflow convierte en commit + fusión + push).
- Salida: 0 bien (también "nada que hacer"), 1 falla, 2 uso incorrecto. Anotaciones de Actions con
  `::notice::[fabrica:<cuenta>]`.

## 9. Fronteras de archivos por fase

Dos agentes no escriben el mismo archivo. Para tocar algo de otra fase se le pide al dueño o al
coordinador.

| Fase | Archivos exclusivos | Depende de |
|---|---|---|
| F0 contrato | `docs/CONTRATO.md`, `docs/decisiones/fabrica.md`, `nucleo/cuenta.mjs` + test, `package.json`, `.github/workflows/ci.yml`, `cuentas/calcular-ar/cuenta.json` (ejemplo; pasa a F5) | |
| F1 núcleo | `nucleo/estado.mjs`, `banco.mjs`, `elegir.mjs`, `diseno.mjs`, `agenda.mjs`, `antispam.mjs`, `correr.mjs`, `nucleo/meta/**` (salvo `medir.mjs` desde que cierra), sus tests | F0 |
| F2a tema y formatos | `formatos/**` (salvo lo de F2b) | F0 |
| F2b formatos nuevos | `formatos/lista-de-errores/**`, `pregunta/**`, `comparador/**`, `cuenta-regresiva/**`, `formatos/_comun/motivos/{grilla,luz,pizarra,papel}.mjs` | F2a (`_comun/tema.mjs` congelado) |
| F3 voz | `nucleo/voz/**` | F0 |
| F4 render y cierres | `nucleo/render/**`, `cuentas/*/cta/**` | F2a, F3 |
| F5 cuentas | `cuentas/*/cuenta.json`, `marca/**`, `guiones/**`, `hechos.json`, `ideas.json`, `TONO.md` | F0 |
| F6 workflows | `.github/workflows/fabrica.yml`, `mantenimiento.yml`, `nucleo/limpiar.mjs` | F1 |
| F7 medición y Kairo | `nucleo/puntaje.mjs`, `nucleo/meta/medir.mjs`, `kairo/herramientas/reels-prueba.mjs` (repo kairo) | F1 |
| F8 ideas y guiones | `agentes/**`, `.github/workflows/guiones.yml`, `ideas.yml`, `nucleo/hechos.mjs` | F1 (`banco.mjs` congelado), F5 |
| F9 corte | variables de los repos, PR de apagado en apex-demos y calcular | todo |

Un cambio a `nucleo/cuenta.mjs` (un campo nuevo de la cuenta) lo hace el coordinador, con su test y
su fila en § 1, antes de que una fase lo use.
