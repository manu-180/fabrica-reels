# Fábrica de reels: una sola, cuatro cuentas (diseño, 2026-11-23)

Generaliza el pipeline de calcular (`manu-180/calcular`, `marketing/reels/scripts/prueba/`, que a su
vez salió de `manu-180/apex-demos` `scripts/prueba/`) a una fábrica que sirve a @apex.stack,
@apex.webssites, @calcular.ar y @assistify_app con un solo código, una config por cuenta y un
estado por cuenta. Este documento es el contrato de diseño: lo que sigue se implementa por fases
(§ 12) sin volver a decidir.

## 0. Lo que se midió antes de diseñar (23/11)

| Dato | Valor | De dónde |
|---|---|---|
| @apex.stack hoy | 12 reels de prueba por día (`REELS_PRUEBA_POR_DIA=12`), de a 2 por tic, + "reel real" diario `share_to_feed=false`, + reels de demos (grilla, `reels.yml`, ≤ 4/día) | variables de `manu-180/apex-demos`, `reels/prueba/estado.json` en main |
| Insights de @apex.stack | no disponibles: el token no tiene `instagram_manage_insights` (Meta 10) | `estado.insights` |
| Banco de APEX | 15 creativos producidos; guiones en `reels/prueba/guiones/` (~35 archivos) | `git ls-tree origin/main` |
| Pipeline de calcular | apagado (`REELS_PRUEBA_ACTIVOS` sin setear); 143 guiones, 762 ideas | variables del repo, `marketing/reels/` |
| ElevenLabs (key del namespace `apex_demos`) | plan `starter`, ciclo actual 83.367 de 84.239 caracteres usados, reinicia 28/11; `/usage/character-stats` por voz suma ~43k en 30 días (Malena ~24k, Zara ~7,5k, otras ~11k) | API de ElevenLabs |
| Keys de ElevenLabs en envkit | 3 distintas (hashes `#c44fc7fa`, `#8a077ec8`, `#9826071a`): pueden ser cuentas distintas | `envkit list --all` |
| Tokens de Instagram en envkit | `IG_ACCESS_TOKEN`/`IG_USER_ID` (@apex.stack) e `IG_EN_ACCESS_TOKEN`/`IG_EN_USER_ID` (@apex.webssites); nada para calcular ni Assistify | `envkit list --all` |
| Repos | `manu-180/calcular` público, `manu-180/apex-demos` privado, `manu-180/assistify_web` privado; `manu-180/fabrica-reels` no existe | `gh api` |
| Marca Assistify | primario `#1257AA` (claro) / `#2F80ED` (oscuro), fondo oscuro `#0A0E18`, acentos índigo `#3949AB` y teal `#00695C`; Oxanium + Inter; logos en `assistify_web/public/images/brand/` | `globals.css`, `layout.tsx` |

La discrepancia del contador de ElevenLabs (83k del ciclo contra ~43k por voz) no se pudo explicar
desde la API (puede ser crédito arrastrado o modelos que cuentan distinto). La fase 3 lo mide por
corrida (§ 7.4), sin suponer.

## 1. Decisiones clave

| # | Decisión | Por qué |
|---|---|---|
| D1 | Repo **público nuevo `manu-180/fabrica-reels`, sin proyecto de Vercel** | Actions gratis e ilimitado en público (en privado la fábrica gastaría ~6.000 min/mes: § 10); sin Vercel no hay build cobrado por push, así que el estado puede pushear después de **cada** publicación (lo que cierra el hueco de "nunca dos veces" en historias, § 8.3). Meter APEX en `calcular` mezcla marcas y cada push a main cobra 1 minuto de build |
| D2 | **Un workflow con matriz por cuenta**, dos grupos de concurrencia por cuenta (`producir-<cuenta>`, `publicar-<cuenta>`) | Una cuenta trabada no frena a las otras; producir y publicar no se pisan en la cola (GitHub reemplaza el pendiente de un mismo grupo: una corrida de producción no puede quedar reemplazada por un tic) |
| D3 | **Estado por cuenta** en la rama `estado`: `cuentas/<id>/estado.json` | Cada job toca sólo su archivo: el rebase entre cuentas nunca choca; la fusión por creativo y publicación de calcular (`fusionarEstado`) queda para la misma cuenta |
| D4 | **Agenda como cola con relojes**, no tics con índice fijo | Hoy `FRANJAS` ata cada publicación a un índice de `TICS_PUBLICAR`; con 4 cuentas y 3 destinos eso no escala. Cada publicación lleva `no_antes_de`; el tic toma la vencida más vieja si la cuenta pasa el antispam (§ 8) |
| D5 | **Antispam cuenta lo que hay en Instagram**, no sólo lo propio | @apex.stack recibe también los reels de demos de `apex-demos`. Antes de publicar se lee la media y las historias de las últimas 24 h de la cuenta y el tope se aplica sobre eso |
| D6 | **Destinos degradables por cuenta** | Si Meta rechaza `trial_params` en una cuenta (cuenta nueva sin reels de prueba), se apaga sólo el destino `prueba` de esa cuenta y siguen `normal` e `historia`; hoy eso pausa todo |
| D7 | **Tema por cuenta, formatos neutros** | Las plantillas leen tokens (paleta, fuentes, motivo de fondo, logo) y no tienen colores ni fuentes propias; el cuaderno de calcular pasa a ser el "motivo" de calcular |
| D8 | **Voz cacheada por contenido** en Blob (`voz/<hash>.mp3` + `.json` de tiempos) | Las 2 variantes de APEX comparten el cuerpo; una ronda que repite un guion no paga voz; los hooks se pagan una vez cada uno |
| D9 | **Guiones validados contra `hechos.json`** por cuenta | Para APEX y Assistify no hay "datos del repo" como en calcular: el equivalente es una lista de hechos con fuente (archivo:línea, doc o decisión de Manuel), y el revisor estricto rechaza cifras y promesas que no estén ahí |
| D10 | **Kairo lee, no recibe** | Kairo baja el estado público de la rama `estado` con su propio cron; el repo público no guarda `KAIRO_GITHUB_TOKEN` ni corre código de Kairo |

## 2. Dónde vive y estructura

```
manu-180/fabrica-reels  (público, sin Vercel; autor de commits: manu-180 noreply)
├─ nucleo/                       pipeline genérico (sale de calcular/marketing/reels/scripts/prueba)
│  ├─ cuenta.mjs                 carga y valida cuentas/<id>/cuenta.json
│  ├─ estado.mjs                 leer, serializar, fusionar (de lib.mjs)
│  ├─ banco.mjs                  guiones, ideas, hechos, revisor estricto
│  ├─ elegir.mjs                 creativo del día: nuevo, ronda, ganador; variantes
│  ├─ diseno.mjs                 firma de diseño, rondas, variedad (§ 5)
│  ├─ agenda.mjs                 cola con relojes por destino (§ 8)
│  ├─ antispam.mjs               topes, rampa, lectura de la cuenta real
│  ├─ meta/  graph.mjs errores.mjs publicar.mjs historias.mjs medir.mjs
│  ├─ voz/   eleven.mjs gemini.mjs cache.mjs presupuesto.mjs tiempos.mjs
│  ├─ render/ hyperframes.mjs variar.mjs (ffmpeg) cierre.mjs
│  ├─ puntaje.mjs                score y elección de ganadores (§ 6)
│  └─ correr.mjs                 entrada: planear | producir | publicar | medir | fusionar
├─ formatos/                     plantillas HyperFrames neutras de marca
│  ├─ _comun/ tema.mjs cinetica.js subtitulos.* motivos/{cuaderno,grilla,luz,pizarra,papel}.mjs
│  ├─ explicador/ mito/ chat/ antes-despues/ (+ nuevos, § 5.3)
├─ cuentas/
│  ├─ apex-stack/      cuenta.json marca/ cta/ guiones/ ideas.json hechos.json TONO.md
│  ├─ apex-webssites/  (ídem, en inglés)
│  ├─ calcular-ar/     (migrado de calcular)
│  └─ assistify/
├─ agentes/ GUIONES.md IDEAS.md      instrucciones del agente semanal (comunes) + TONO.md de cada cuenta
├─ musica/ sfx/                      compartidos (de scripts/reel/assets de apex-demos)
├─ .github/workflows/ fabrica.yml guiones.yml mantenimiento.yml
└─ docs/ CONTRATO.md decisiones/fabrica.md

rama `estado` (huérfana, nunca se mergea):
   cuentas/<id>/estado.json   cuentas/<id>/guiones-auto/*.json   cuentas/<id>/ideas-auto.json
```

Lo que **no** se muda: `reels.yml` de apex-demos (reels de demos en la grilla de @apex.stack y
de @apex.webssites) sigue donde está, porque depende de la agenda que escribe `apex_manager` y del
`build.json` de cada demo. La fábrica sólo lo tiene en cuenta como publicaciones ajenas de la misma
cuenta (D5).

Por qué público no expone nada: los guiones y el estado son marketing que ya sale en Instagram;
los secretos van en GitHub Secrets (los PR de forks no los reciben; el workflow no corre con
`pull_request_target`). Regla del revisor (§ 4.4): ningún guion, idea ni estado lleva un nombre,
teléfono, mail o usuario de un lead o cliente.

## 3. Config por cuenta (`cuentas/<id>/cuenta.json`)

```jsonc
{
  "version": 1,
  "id": "apex-stack",
  "usuario": "apex.stack",                 // se verifica contra GET /{ig-user}?fields=username antes de publicar
  "idioma": "es-AR",                       // es-AR | en-US
  "activa": true,                          // false: planear corta en segundos
  "modo": "real",                          // real | sombra (produce, no publica; § 11) 
  "creativos_por_dia": 1,
  "variantes_por_creativo": 2,             // APEX 2; las demás 1
  "destinos": {                            // por variante, en este orden
    "prueba":   { "activo": true,  "trial": "MANUAL" },
    "normal":   { "activo": true,  "share_to_feed": false, "espera_min": 60 },   // tras su prueba
    "historia": { "activo": true,  "espera_min": 30, "cierre": "historia" }       // tras su normal
  },
  "franjas": [ { "desde": "11:30", "hasta": "14:30" }, { "desde": "18:00", "hasta": "23:30" } ],
  "antispam": {
    "max_dia": 8,                          // acciones propias + ajenas leídas de la cuenta (D5)
    "max_dia_propias": 6,
    "gap_min": 50,                         // entre dos publicaciones cualesquiera de la cuenta
    "max_por_corrida": 1,
    "reserva_cupo": 15                     // del content_publishing_limit, para lo que publica otro
  },
  "rampa": null,                           // o { "inicio": "2026-12-01", "escalones": [...] } (§ 8.2)
  "voz": {
    "proveedor": "elevenlabs", "modelo": "eleven_multilingual_v2",
    "voice_id": "p7AwDmKvTdoHTBuueGvP",    // Malena
    "ajustes": { "stability": 0.45, "similarity_boost": 0.8, "style": 0.3 },
    "pausas": { "tras_hook": 0.85, "entre": 0.8, "antes_cta": 0.9, "coma": 0.25 },
    "respaldo": { "proveedor": "gemini", "voz": "Kore", "estilo": "rioplatense cálido" },
    "presupuesto_mes": 18000               // caracteres; § 7.3
  },
  "marca": {
    "paletas": "marca/paletas.json",       // { clave: { fondo, superficie, tinta, tenue, acento } }, 4 a 6
    "fuentes": { "titulo": "marca/fuentes/Bricolage-800.woff2", "cuerpo": "...", "mono": "..." },
    "tracking_titulo": -0.03,
    "motivos": ["grilla", "luz"],          // fondos con carácter que usa esta marca (§ 5.2)
    "logo": "marca/logo.svg", "radio": 28,
    "formatos": ["chat", "mito", "explicador", "antes-despues"]
  },
  "cierre": {
    "texto_voz": "Comentá WEB y te armamos gratis la página de tu empresa.",
    "caption": "Comentá WEB y te armamos gratis la página web de tu empresa. Recién cuando la ves y te gusta, pagás la primera cuota para avanzar.",
    "clips": "cta/clips.json",             // por paleta × estilo × destino (reel | historia)
    "palabra_clave": "WEB"                 // null fuera de APEX; activa comentarios_web en el puntaje
  },
  "captions": { "hashtags_por_post": [5, 7], "hashtags_fijos": ["apexstack"] },
  "secretos": { "ig_user": "IG_APEX_STACK_USER_ID", "ig_token": "IG_APEX_STACK_TOKEN", "ig_insights": "IG_APEX_STACK_INSIGHTS_TOKEN" },
  "reglas_texto": { "prohibidas": [], "max_palabras_voz": [25, 55], "sin_montos": true, "fuentes_dominios": null },
  "kairo": { "seccion": "reels-apex-stack" }
}
```

Valores iniciales de las cuatro:

| Campo | apex-stack | apex-webssites | calcular-ar | assistify |
|---|---|---|---|---|
| idioma | es-AR | en-US | es-AR | es-AR |
| creativos × variantes | 1 × 2 | 1 × 2 | 5 × 1 | 3 × 1 |
| acciones propias/día | 6 | 6 | 15 (con rampa) | 9 (rampa si la cuenta tiene < 90 días) |
| prueba / normal / historia | sí / `share_to_feed=false` / sí | sí / `false` / sí | sí / `true` / sí | sí / `true` / sí |
| franjas (hora de BA) | 11:30–14:30, 18:00–23:30 | 10:30–13:30 de Chicago = 13:30–16:30 BA, 19:00–23:59 BA | 9:00–23:59 | 8:00–10:00, 12:30–14:30, 19:00–22:30 (docentes: antes de clase, almuerzo, noche) |
| gap_min | 50 | 50 | 55 | 50 |
| max_dia (con ajenas) | 10 (6 + demos) | 10 | 15 | 9 |
| voz | Malena `p7AwDmKvTdoHTBuueGvP` | Zara `jqcCZkN6Knx8BJ5TBdYR` | audición (§ 7.1), base Agus | audición (§ 7.1), base Malena con `stability` 0,55 |
| paletas | las 5 de APEX (`noche`, `crema`, `bosque`, `tinta`, `arcilla`) | las mismas | las 5 de calcular | 5 nuevas desde `#1257AA`/`#2F80ED`/`#0A0E18`/índigo/teal |
| fuentes | las de apex-demos `_comun/fuentes.css` | ídem | Geist 400–800 + Geist Mono | Oxanium (títulos) + Inter (cuerpo) |
| motivos | grilla, luz | grilla, luz | cuaderno | pizarra, papel |
| formatos | chat, mito, explicador, antes-despues | ídem | chat, mito, explicador | chat, mito, explicador, antes-despues (planilla en papel → app) |
| cierre (voz) | "Comentá WEB y te armamos gratis la página de tu empresa." | "Comment WEB and we'll build you a free website demo." | "Hacé la cuenta con tus números, gratis, en calcular punto ar." | a escribir con `ux-writing` (ej.: "Probá Assistify gratis: el link está en el perfil.") |
| cierre historia | "Respondé WEB a esta historia" | "Reply WEB to this story" | el mismo del reel | el mismo del reel |
| palabra_clave | WEB | WEB | null | null |
| secretos IG | `IG_APEX_STACK_*` (de `IG_ACCESS_TOKEN`/`IG_USER_ID` de envkit `apex_demos`) | `IG_APEX_WEBSSITES_*` (de `IG_EN_*`) | `IG_CALCULAR_*` (no existe: lo genera Manuel) | `IG_ASSISTIFY_*` (no existe) |

Secretos compartidos del repo: `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`, `BLOB_READ_WRITE_TOKEN`
(un store nuevo `fabrica-reels` en el team de manu-180), `CLAUDE_CODE_OAUTH_TOKEN` (cuenta personal,
la que paga APEX y calcular), `REPOS_LECTURA_TOKEN` (fine-grained, sólo lectura de
`assistify_web`, `assistify_app` y `calcular`, para el agente de ideas). Los IG van sólo en los
pasos Publicar y Medir de su cuenta (`secrets[cuenta.secretos.ig_token]` vía un mapa en el
workflow) y el render corre con `entornoSinSecretos()` como hoy.

El cierre de APEX es copy de venta: no lo cambia la fábrica ni el agente de guiones; se copia
textual de `CTA_CAPTION` de apex-demos. Cambiarlo es decisión de negocio (panel `founder-consumer`
primero, regla de decisiones de negocio).

## 4. Bancos de ideas y guiones

### 4.1 Archivos por cuenta

| Archivo | Qué es | Quién escribe |
|---|---|---|
| `hechos.json` | Lo que se puede afirmar: cada hecho con `id`, `texto`, `cifras` permitidas, `fuente` (`repo:archivo:línea`, `url` oficial o `manuel:<fecha>`), `envejece` | Humano o agente de ideas (sólo con fuente verificable); los de `manuel:` sólo a mano |
| `ideas.json` | Lista larga de ideas: `id`, `tema`, `angulo`, `formato_sugerido`, `hechos: [ids]`, `ventana`, `origen` (`hechos`, `dolor`, `rendimiento`, `temporada`) | Agente mensual de ideas (§ 4.3) |
| `guiones/*.json` | Banco curado en main (el esquema de `CONTRATO.md` de calcular, con `hechos` en vez de/además de `fuentes`) | Humano o PR |
| `guiones-auto/*.json` (rama `estado`) | Guiones del agente semanal | `guiones.yml` |
| `TONO.md` | Voz de marca, palabras prohibidas, ejemplos buenos y malos | Humano |

calcular entra con sus 762 ideas (sus `dato` + `origen_repo` pasan a `hechos` 1:1, sin perder el
revisor actual). APEX entra con sus ~35 guiones de `reels/prueba/guiones/`.

### 4.2 De dónde salen los hechos para APEX y Assistify

| Cuenta | Fuentes de hechos | Fuentes de dolores (ideas, nunca cifras) |
|---|---|---|
| APEX (es/en) | La oferta tal como la dice el `CTA_CAPTION` y `factory/VARA.md` / lo que incluye una demo (`apex-demos` docs); estándares técnicos con fuente pública (Core Web Vitals de web.dev, % de tráfico móvil de un informe con URL); decisiones de Manuel anotadas con fecha | Agregado semanal de `loss_reason` y objeciones de `apex_manager` (sólo conteos por categoría, sin texto de chats ni nombres), comentarios de los reels propios |
| Assistify | Features que existen en el código (`assistify_app/lib/features/**`, `INFORME_PRODUCTO_ASSISTIFY.md`) con `archivo:línea`, como las ideas de calcular; planes y precios sólo con `manuel:` | Preguntas frecuentes de soporte/feedback in-app agregadas; comentarios de los reels |

El agregado de objeciones de APEX lo genera el lado privado (una función de `apex_manager` o una
herramienta de Kairo con sus credenciales) y lo deja como `dolores.json` sin PII en la rama
`estado`; el repo público nunca tiene una key de la base de APEX.

### 4.3 Generar ideas nuevas con el tiempo

- **`guiones.yml` semanal** (domingo 11:30 BA, matriz por cuenta): si a la cuenta le quedan menos de
  `15 × creativos_por_dia` guiones sin salir, el agente (`agentes/GUIONES.md` + `TONO.md` de la
  cuenta, modelo Sonnet: es escritura acotada contra un esquema) escribe `7 × creativos_por_dia`
  guiones de ideas sin guion, repartidas por tema y ángulo.
- **`ideas.yml` mensual** (primer domingo): si quedan menos de 60 días de ideas, el agente de ideas
  (Opus, esfuerzo alto: es criterio) propone ideas nuevas desde: hechos sin idea, `dolores.json`, el
  **informe de rendimiento** (`puntaje.mjs informe`: los 10 temas y ángulos de mejor y peor puntaje,
  y los comentarios con preguntas), y el calendario (fechas de la cuenta: inicio de clases para
  Assistify, aguinaldo para calcular, Black Friday para APEX). Cada idea nueva cita los `hechos` que
  usa; si necesita un hecho que no existe, lo propone en `hechos-propuestos.json` con fuente y no
  escribe la idea hasta que el revisor de hechos lo acepte (fuente `repo:` o `url` verificable: se
  comprueba que la línea existe y contiene la cifra; `manuel:` queda pendiente en Kairo).
- Nunca hay ideas "de la nada": una idea sin `hechos` válidos se descarta.

### 4.4 El revisor estricto (generaliza `banco.mjs revisar --estricto`)

Un guion pasa sólo si:
1. Cumple el esquema y el `validar()` de su formato.
2. Toda cifra de 2 o más dígitos, decimal o porcentaje (incluidas las escritas en letras,
   `letrasACifras`) aparece en las `cifras` de algún hecho que el guion cita (calcular además
   mantiene su chequeo de ±60 líneas del `origen_repo`).
3. No promete nada de la oferta fuera de los hechos de tipo `oferta` (APEX: "gratis", "primera
   cuota", plazos de entrega) y no menciona precios.
4. Ninguna palabra de `reglas_texto.prohibidas` (Assistify: jerga técnica como "dashboard",
   "backend", "sincronizar", "app nativa", "cloud"; la lista vive en su `TONO.md`).
5. Sin teléfonos, mails, `@usuarios`, URLs fuera de la de la cuenta, ni nombres propios que no
   estén en la lista de nombres ficticios permitidos.
6. Idioma: en-US sin voseo ni restos de castellano; es-AR con voseo y sin "che".

Lo que no pasa no llega a la rama: el workflow lo descarta y lo cuenta en el resumen.

## 5. Diseño: tema por cuenta y variedad

### 5.1 Cómo toma la marca una plantilla

`armar({ guion, hook, voz, salida, diseno, tema })` (el contrato de calcular más `tema`):

```js
tema = {
  idioma, paleta: { fondo, superficie, tinta, tenue, acento },      // la de la ronda
  fuentes: { titulo, cuerpo, mono },  pesos, tracking_titulo,
  motivo: 'cuaderno' | 'grilla' | 'luz' | 'pizarra' | 'papel',      // el fondo con carácter
  logo, radio, contraste: { tinta_sobre_acento }                    // calculado (WCAG) en tema.mjs
}
```

`formatos/_comun/tema.mjs` vuelca el tema a variables CSS (`--fondo`, `--acento`, `--f-titulo`…) y
copia fuentes y logo a `salida/`. Ninguna plantilla tiene un color, fuente o texto de marca escrito:
el test `formatos/tema.test.mjs` renderiza el HTML de cada layout con un tema de prueba de colores
imposibles y falla si aparece un hex o una `font-family` que no vino del tema. El texto fijo de una
plantilla (rótulos como "Lo que se cree") sale de `formatos/<f>/textos.<idioma>.json`.

### 5.2 Motivos (fondos con carácter)

Cada motivo es un módulo de `_comun/motivos/` que devuelve capas (grilla profunda, luz, grano,
viñeta) parametrizadas por la paleta; el cuaderno de calcular es el primero (sale de
`_comun/cuaderno.mjs`). Una cuenta declara 1 a 3 motivos en `marca.motivos`; la ronda elige uno.

### 5.3 Firma de diseño y variedad

Cada creativo guarda su **firma**: `formato`, `layout`, `motivo`, `paleta`, `hook`, `musica`,
`cierre` (estilo), `color` (grade), `textura`. Reglas (en `diseno.mjs`, deterministas por semilla
`cuenta|guion|ronda|variante`):

- **Un tema que se repite cambia de diseño**: la firma nueva no puede coincidir en `layout` ni en
  `paleta` con ninguna firma anterior del mismo `tema` (no sólo del mismo guion); con historial
  largo, contra las 4 últimas.
- **Contra lo reciente de la cuenta**: difiere en 2 ejes o más de cada uno de los 3 creativos
  anteriores (la distancia de `matrizVariantes` de APEX) y no repite formato ni categoría del
  anterior si hay alternativa.
- **Layouts**: cada formato registra los suyos (`layouts: [{ id, apto(guion) }]`); calcular ya
  tiene 2 por formato (hoja/zoom, hoja/panel, telefono/hoja). Meta: 3 por formato antes de prender
  calcular a 5 por día (con 5 diarios, 2 layouts se repiten en tres días).
- Formatos nuevos a sumar en fase 2b (los cuatro sirven a las cuatro cuentas): `lista-de-errores`
  (tres errores que se tachan), `pregunta` (una pregunta de comentario y su respuesta visual),
  `comparador` (A contra B en pantalla partida que se resuelve) y `cuenta-regresiva` (para
  fechas de calendario). Todos con la misma doctrina (`motion-doctrine`, `edicion-reels`,
  `subtitulos-premium`, vetos de Manuel) y nunca video de gente generado con IA.

### 5.4 Creativo nuevo o variante (APEX)

| | Creativo nuevo | Variante |
|---|---|---|
| Qué es | Un guion en una ronda | Otro video del mismo guion y la misma ronda |
| Cuerpo de voz | Se locuta (o sale del caché si el texto ya se pagó) | El mismo archivo del creativo |
| Hook | `hooks[ronda*V % 3]` | El siguiente hook: variante `i` usa `hooks[(ronda*V + i) % 3]` (sólo se paga el hook, ~40 caracteres) |
| Render | HyperFrames con su firma | HyperFrames con otra firma: otro `layout` o `motivo` y otra `paleta`, `musica`, `cierre` (difiere en ≥ 3 ejes de su hermana) |
| Captions | 2 por variante (prueba, normal) de la rotación | La rotación sigue: la variante 1 usa los índices 2 y 3 |
| Cuándo | Lo decide `elegir.mjs` (§ 6.3) | Siempre `variantes_por_creativo` por creativo |

Las dos variantes del día de APEX son el A/B real de la cuenta: misma idea, distinto gancho y
diseño. El puntaje compara las hermanas entre sí (misma idea, mismo día), que es la comparación
más limpia que permite el volumen.

## 6. Medición y lazo de rendimiento

### 6.1 Qué se mide y cuándo

| Destino | Métricas | Cuándo |
|---|---|---|
| prueba, normal | `like_count`, `comments_count` siempre; con insights: `views`, `reach`, `shares`, `saved`, `ig_reels_avg_watch_time`, `total_interactions` | en cada tic hasta 14 días; se congela una foto a las **72 h** (`metricas_72h`), que es la que puntúa |
| historia | con insights: `reach`, `replies`, `navigation` (taps_forward/exits), `shares` | **antes de 24 h** (Instagram las borra a las 24 h): foto a las ~20 h |
| comentarios | texto de los comentarios con `?`, para el informe de ideas; `comentarios_web` si `palabra_clave` | con la foto de 72 h |

Lo que no se puede leer queda `null`, nunca 0 (como hoy).

### 6.2 Puntaje

Con insights (por publicación, a 72 h):

```
retencion = promedio_visto_s / duracion_s
p = 0.35·z(retencion) + 0.25·z(compartidos/alcance) + 0.20·z(guardados/alcance)
  + 0.10·z(comentarios/alcance) + 0.10·z(likes/alcance)
  [+ 0.30·z(comentarios_web/alcance) si la cuenta tiene palabra_clave]
```

`z` dentro de la misma cuenta y el mismo destino (una prueba se compara con pruebas: la ven no
seguidores), en los últimos 30 días. Puntaje del creativo: promedio de sus publicaciones con
datos. Puntaje de un **tema**: promedio bayesiano `(Σp + k·0) / (n + k)` con `k = 3`, para que un
tema con un solo reel bueno no domine.

Sin insights (@apex.stack hoy): `p = percentil de (likes + 3·comentarios + 10·comentarios_web)`
dentro de la cuenta, destino y **día** (el horario y el día pesan más que el contenido en likes
crudos). Vale para ordenar, no para concluir: el informe de Kairo lo marca como "sin estadísticas" y
pide el permiso. Prender insights en las cuatro cuentas es parte de la fase 0 (el token se genera
con `instagram_manage_insights` desde el arranque).

### 6.3 Qué se produce cada día (`elegir.mjs`)

Por cada uno de los `creativos_por_dia`, en orden:

1. **Calendario**: guion con `ventana` abierta hoy y sin salir en esta vuelta.
2. **Nuevo**: guion que nunca salió (banco + `guiones-auto`), sin repetir categoría ni formato del
   anterior si hay otro.
3. **Ganador repetido**: si no queda nuevo, o como **1 de cada 7** creativos desde que la cuenta
   tiene 30 días medidos. Candidatos: guiones con ≥ 21 días desde su última salida y ronda < 4;
   se elige por puntaje de su tema con 20 % de azar entre el resto (para no quedar atado a un
   ganador por ruido). Sale con firma nueva (§ 5.3) y el hook siguiente.
4. Sin nada elegible: no se produce y Kairo avisa "banco vacío" (el agente semanal debería haberlo
   evitado).

Guiones de tema con puntaje en el tercil más bajo y ≥ 4 creativos medidos dejan de repetirse y el
agente de ideas recibe ese tema como "no insistir".

## 7. Voz

### 7.1 Elección por cuenta

- @apex.stack: Malena con los ajustes de la v3a (validada por Manuel el 8/10). @apex.webssites:
  Zara (la que ya usan los reels en inglés). No se tocan.
- @calcular.ar y @assistify_app: **audición** en fase 3, sin preguntar: 3 voces candidatas de la
  biblioteca de ElevenLabs (`/v1/shared-voices`, acento argentino, uso "conversational" o
  "narration") + la base de la tabla, el mismo guion de cada cuenta, y se elige con el panel
  `founder-consumer` del público de la cuenta (docentes y dueños de institutos para Assistify;
  trabajadores y pymes para calcular) más la regla de `edicion-reels` (145–165 ppm, pausas 0,8–0,9 s).
  Nunca la voz clonada de una persona real (en la cuenta está "Fede Garbarino v2": no se usa).
  Calcular y Assistify con una voz distinta de Malena: las cuentas no deben sonar a la misma marca.

### 7.2 Caché

- Clave: `sha256(proveedor | modelo | voice_id | ajustes | pausas | texto normalizado | previo | siguiente)`
  por **oración** (la síntesis ya es oración por oración con `previous_text`/`next_text`).
- Se guarda en Blob `voz/<cuenta>/<hash>.mp3` + `<hash>.json` (tiempos por palabra, bordes de
  `silencedetect`). Antes de pedir a ElevenLabs se hace `head()` al Blob: si está, no se paga.
- Lo que no cambia y nunca se vuelve a pagar: el cuerpo de una ronda repetida, el cuerpo compartido
  de las variantes de APEX, cada hook después de su primera vez, los cierres (clips ya renderizados
  y commiteados en `cuentas/<id>/cta/`, como hoy).
- El respaldo Gemini se cachea aparte (otra clave) y nunca reemplaza una entrada de ElevenLabs.

### 7.3 Presupuesto

`voz/presupuesto.mjs` lee `GET /v1/user/subscription` al arrancar producir. Si lo que queda del
ciclo no alcanza para lo planeado, en este orden: (1) se prefieren guiones con voz cacheada
(ganadores repetidos, rondas) y el formato `chat` (sin voz); (2) se respeta `presupuesto_mes` por
cuenta; (3) recién después el respaldo Gemini, y sólo en `historia` (nunca en la prueba ni la
normal de APEX). Cada corrida anota `caracteres_pagados` y `caracteres_cache` por creativo.

### 7.4 Caracteres estimados

Supuestos: voz de 40 palabras ≈ 240 caracteres, hook ≈ 40, 70 % de los creativos con voz (el resto
`chat`), mes de 30 días, sin caché (peor caso, primer mes).

| Cuenta | Pagado por día | Por mes |
|---|---|---|
| calcular-ar (5) | 5 × 0,7 × 280 = 980 | 29.400 |
| assistify (3) | 3 × 0,7 × 280 = 590 | 17.600 |
| apex-stack (1 × 2 variantes: 1 cuerpo + 2 hooks) | 0,7 × 320 = 225 | 6.700 |
| apex-webssites (ídem) | 225 | 6.700 |
| **Fábrica** | **~2.000** | **~60.000** |
| APEX existente (demos es/en y otros) | — | ~43.000 (medido por voz) |
| **Total** | | **~103.000** |

Con la rampa de calcular (§ 8.2) el primer mes de calcular cuesta ~60 % de eso. El caché baja la
fábrica a medida que crecen las rondas y los ganadores repetidos (1 de cada 7 creativos ya sale
gratis desde el mes 2).

## 8. Agenda, antispam y robustez

### 8.1 La cola con relojes

Al producir, cada publicación recibe `no_antes_de` y `vence` (fin del día de BA):
- `prueba`: un horario al azar dentro de la franja asignada al creativo, nunca en minuto terminado
  en 0 o 5.
- `normal`: `publicado_at(prueba) + espera_min` (60) + azar de 3 a 25 min.
- `historia`: `publicado_at(normal) + espera_min` (30) + azar de 3 a 25 min.

Las franjas se reparten entre los creativos del día en orden (con 5 creativos y 1 franja larga,
partes iguales). Cada **tic** (cron cada 30 min de 8:47 a 23:47 BA, minutos `17` y `47`) y por
cuenta: si `planear` dice que hay algo vencido, lee la cuenta real (§ 8.2) y publica **una**
publicación como mucho (`max_por_corrida: 1`): la vencida más vieja. Lo que no salió el día
programado se descarta a la medianoche (`descartarViejas`), salvo la historia de una normal que
salió después de las 23: se descarta también (una historia a la madrugada no la ve nadie).

### 8.2 Antispam

Antes de cada publicación, `antispam.mjs`:
1. `GET /{ig-user}/media?fields=timestamp,media_product_type&since=-24h` (paginado) y
   `GET /{ig-user}/stories` → todo lo publicado en 24 h por cualquiera (la fábrica, `reels.yml`, a
   mano).
2. No publica si: lo de 24 h ≥ `max_dia`; lo propio de hoy ≥ `max_dia_propias` (o el escalón de la
   rampa); la última publicación de la cuenta (propia o ajena) fue hace < `gap_min`;
   `content_publishing_limit` deja < `reserva_cupo`.
3. Lo que no sale por antispam no cuenta intento: espera al tic siguiente.

**Rampa** (cuentas nuevas o con menos de 90 días; calcular seguro, Assistify si aplica):

| Semana | Creativos/día (calcular) | Acciones/día |
|---|---|---|
| 1 | 1 | 3 |
| 2 | 2 | 6 |
| 3 | 3 | 9 |
| 4 | 4 | 12 |
| 5 en adelante | 5 | 15 |

Se sube de escalón sólo tras 7 días seguidos sin error de límite ni de bloqueo. Un `9/2207078`
(o cualquier `limite` que no sea por cupo) **baja un escalón y lo sostiene 7 días**; dos en una
semana, pausa de la cuenta 48 h y aviso a Kairo. Un bloqueo (`2207050/51`, `368`) pausa la cuenta
hasta despausar a mano. Producir respeta el escalón: no se produce lo que no se va a poder
publicar (no se gasta voz ni se quema un guion).

### 8.3 Nunca dos veces

Lo de calcular/APEX (contenedor guardado, estados `FINISHED/IN_PROGRESS/EXPIRED/ERROR/PUBLISHED`,
búsqueda del caption en la media de 48 h, un contenedor que pudo publicarse no se reemplaza) más:

- **Push del estado después de cada paso que toca Meta**: tras crear el contenedor (con su id) y
  tras `media_publish`. En calcular el push es al final de la corrida; si el runner muere en el
  medio, el id del contenedor se pierde. Sin Vercel el push no cuesta nada.
- **Historias**: no tienen caption, así que la búsqueda por caption no sirve. La garantía es el
  contenedor guardado y pusheado antes de `media_publish`; si el GET del contenedor falla, no se
  crea otro (transitorio). Como segunda red, `GET /{ig-user}/stories` y se compara la duración y la
  hora contra la historia esperada: si hay una de esa duración ±0,5 s en los 90 min posteriores al
  intento anterior, se da por publicada.
- Caption distinto por publicación (prueba y normal), como hoy; la historia no lleva caption.

### 8.4 Errores de Meta (generaliza `clasificarErrorMeta`)

| Clase | Códigos | Qué hace | Alcance |
|---|---|---|---|
| token | 190, 102 | pausa la cuenta; se despausa sola cuando el token vuelve a andar | cuenta |
| permiso-trial | 10/2xx o mensaje con `trial` **en una prueba** | apaga `destinos.prueba` en el estado de la cuenta (`destinos_apagados.prueba`) y sigue con normal e historia; Kairo avisa | destino |
| permiso | 10, 200–299 en cualquier otro caso | pausa la cuenta | cuenta |
| bloqueo | 2207050, 2207051, 368, "block/spam/restrict" | pausa la cuenta, sólo a mano | cuenta |
| antispam | 9 con subcódigo 2207078, 4, 17, 32, 341, 613 | baja un escalón de rampa (§ 8.2), sin intento | cuenta |
| cupo | 2207042 o `content_publishing_limit` agotado | espera al próximo tic, sin intento | cuenta |
| transitorio | 9007/2207027 ("not ready"), 5xx, 1, 2 | reintenta en el próximo tic sin contar | publicación |
| publicación | cualquier otro | cuenta intento; 3 y se deja | publicación |

Despausar: `"pausado": null` en `cuentas/<id>/estado.json` de la rama `estado` (o desde Kairo,
que escribe ese campo con la API de contents). Variables del repo `FABRICA_PAUSADA=1` (todo) y
`FABRICA_PAUSADA_<ID>=1` (una cuenta) frenan producir y publicar sin tocar el estado; medir sigue.

### 8.5 Producir

- `fabrica.yml` producir: **17:05 BA del día anterior**, reintentos a las 19:05 y 5:05 del día. Así
  un creativo que falla tiene 12 h y tres intentos antes de su franja, y la cola del día está lista
  antes del primer tic. (Calcular produce a las 5:05 del mismo día: si falla tres veces se pierde
  la franja.)
- Matriz por cuenta; dentro de la cuenta, cada creativo por su lado (uno que falla no frena a los
  otros), intento contado antes de empezar (como hoy), tope de 15 min por render.
- Render: HyperFrames 0.8.140 con las banderas de `render.mjs` de calcular; cuerpos ≤ 30 s; un mp4
  por variante (≤ 15 MB, −14 LUFS, revisado con `revisarSalida`); la historia usa el mismo mp4 salvo
  que la cuenta tenga cierre `historia` distinto (APEX): entonces ffmpeg pega el otro clip de
  cierre al mismo cuerpo (segundos, sin HyperFrames).
- Blob: `videos/<cuenta>/<fecha>/<creativo>-<variante>-<destino>.mp4`; `limpiar.mjs` borra los de
  más de 21 días (Meta ya los bajó; se guarda la firma en el estado para regenerar si hiciera falta).

## 9. Workflows

| Workflow | Disparo | Qué hace |
|---|---|---|
| `fabrica.yml` | cron producir (`5 20,22 * * *` y `5 8 * * *` UTC), cron publicar (`17,47 11-23,0-2 * * *` UTC = 8:17–23:47 BA), `workflow_dispatch` (cuenta, acción, guion, `dry_run`, `ahora`) | job `planear` (sólo node, lee la rama `estado`, decide por cuenta) → matriz `producir` / `publicar` / `medir` sólo de las cuentas con algo que hacer. Un tic vacío termina en segundos |
| `guiones.yml` | domingo 14:30 UTC | matriz por cuenta: agente semanal → `revisar --estricto` → commit a `cuentas/<id>/guiones-auto/` en la rama `estado` |
| `ideas.yml` | primer domingo del mes | agente de ideas + revisor de hechos → `ideas-auto.json` y `hechos-propuestos.json` en la rama `estado` |
| `mantenimiento.yml` | diario 4:05 BA | `limpiar.mjs` (Blob), informe de puntaje, chequeo de que los crons siguen vivos (abajo), tests |

- Cron de repos públicos: GitHub los desactiva tras 60 días sin actividad en el repo. Los pushes a
  la rama `estado` son actividad diaria, pero como red Kairo mira cada día la hora del último
  `actualizado` de cada cuenta (`VIEJO = 26 h`, como hoy) y, si hace falta, reactiva el workflow
  con `gh workflow enable`.
- El job de publicar de una cuenta usa `concurrency: publicar-<id>`; el de producir,
  `producir-<id>`; medir corre dentro de publicar (es lectura). Las dos escrituras se fusionan con
  `fusionarEstado` sobre la punta de la rama, 8 vueltas con espera creciente, fast-forward siempre,
  nunca force push.
- Autor de los commits del estado: `manu-180` `157671390+manu-180@users.noreply.github.com` (no hay
  Vercel que bloquee, pero se mantiene la identidad de siempre).

## 10. Costo mensual estimado

| Rubro | Supuestos | Costo |
|---|---|---|
| GitHub Actions | Repo público: minutos sin cargo. Referencia si fuera privado: 12 renders/día × ~7 min ≈ 85 min + ~31 tics × 4 cuentas × 1 min ≈ 124 min → ~6.300 min/mes, el doble de los 3.000 gratis | **US$0** |
| ElevenLabs | ~103.000 caracteres/mes en total (§ 7.4) contra Starter de 30.000 (hoy con 84.239 por crédito arrastrado, casi agotado). Mínimo: **Creator** (100.000/mes, ~US$22 de lista; verificar precio y el cobro por excedente en la página de planes antes de cambiar). Si dos meses seguidos pasa de 100k: Pro (~US$99, 500.000). El presupuesto de § 7.3 evita pasarse | **+~US$17** sobre lo de hoy (de US$5 a ~US$22) |
| Vercel Blob | 12 mp4/día × ~10 MB; Meta baja cada uno 2 o 3 veces → ~11 GB/mes de salida; ~2,5 GB guardados (21 días); caché de voz ~30 MB/mes. Tarifas de lista de Blob (~US$0,05/GB de transferencia, ~US$0,023/GB-mes) | **< US$1** |
| Claude (guiones e ideas) | Con `CLAUDE_CODE_OAUTH_TOKEN` de la suscripción personal: sin cargo aparte, consume cupo (~90 guiones/semana en 4 corridas Sonnet + 4 corridas Opus de ideas al mes). Referencia por API: ~US$5–10/mes con Sonnet para guiones y ~US$10–20 con Opus para ideas | **US$0** (suscripción) |
| Gemini | Sólo respaldo de voz (y de historias si se acaba el presupuesto) | ~US$0 |
| Vercel builds | Sin proyecto de Vercel en el repo | US$0 |
| **Total marginal** | | **~US$18/mes** |

El cambio de plan de ElevenLabs es plata: lo decide Manuel. Sin el cambio, la fábrica funciona
igual con el presupuesto de § 7.3 pero con menos creativos nuevos con voz (más `chat` y más
repeticiones cacheadas) o con Gemini en las historias.

## 11. Migración de APEX sin cortar lo que publica

Hoy `apex-demos/reels-prueba.yml` publica 12 pruebas por día en @apex.stack y un "real"
`share_to_feed=false`; Kairo lee `reels/prueba/estado.json`; `apex_manager` contesta los
comentarios WEB por el webhook de la cuenta (no depende de quién publica).

| Paso | Qué | Listo cuando |
|---|---|---|
| M1 importar | Copiar `reels/prueba/guiones/*` a `cuentas/apex-stack/guiones/`, el estado de `reels/prueba/estado.json` a `cuentas/apex-stack/estado.json` (convertido: cada creativo viejo con sus publicaciones como `prueba`, métricas incluidas, para que rondas e historial sigan) | `correr.mjs planear --cuenta apex-stack` elige el mismo guion que elegiría apex-demos con el mismo estado (test de paridad) |
| M2 sombra | `modo: "sombra"` 3 días: produce los 2 videos del día, los deja como artefacto, no publica | 6 videos revisados con capturas y la vara de diseño; voz idéntica a la de apex-demos (misma voz y ajustes) |
| M3 corte | Un día D: en apex-demos `REELS_PRUEBA_POR_DIA=0` y `REELS_PRUEBA_PAUSADOS=1` después del último tic de D−1 (22:47); en la fábrica `modo: "real"` desde la producción de las 17:05 de D−1 | El día D salen 6 publicaciones de la fábrica y 0 de apex-demos; Graph API no muestra duplicados |
| M4 Kairo | `kairo/herramientas/reels-prueba.mjs` pasa a leer `cuentas/<id>/estado.json` de `manu-180/fabrica-reels` (rama `estado`, raw público, sin token) y arma una sección por cuenta; el job `kairo` de apex-demos se borra | La sección de @apex.stack muestra el día D completo |
| M5 apagar | Tras 7 días sin incidentes: PR en apex-demos que borra `reels-prueba.yml`, `scripts/prueba/` y `reels/prueba/` (queda en el historial) y su fila en la decisión | `gh workflow list` de apex-demos ya no tiene Reels de prueba |
| M6 inglés | @apex.webssites arranca directo en la fábrica (hoy sólo tiene demos): rampa corta (semana 1: 1 variante, 3 acciones; semana 2: 2 variantes) | 7 días sin límite ni bloqueo |

"Comentá WEB" no cambia: el cierre y el caption se copian textuales, `palabra_clave: "WEB"` hace
que `comentarios_web` siga contando, y `apex_manager` sigue contestando por su webhook. Lo único
nuevo es la historia: la respuesta a una historia llega como **mensaje directo**, no como
comentario. Antes de prender `historia` en APEX (fase 8) se verifica que el flujo de venta de
`apex_manager` arranca también con un DM que dice "WEB"; si no, la historia de APEX sale con el
cierre del reel (sin "Respondé WEB") hasta que se sume.

Lo que se deja de hacer: las 12 pruebas por día y el "reel real" diario. Los reemplazan 2 pruebas
+ 2 normales `share_to_feed=false` + 2 historias, que es lo que pidió Manuel, con menos acciones
(6 contra 13) y por lo tanto menos riesgo de antispam.

Calcular: su pipeline nunca se prendió, así que no hay corte: la cuenta arranca en la fábrica y en
`manu-180/calcular` se borra `marketing/reels/scripts/prueba`, `reels-prueba.yml` y
`reels-guiones.yml` en **un solo PR** (un build de Vercel) cuando la fábrica publica 7 días limpios.
Los dos agentes que hoy trabajan ahí (historias y rediseño de plantillas) terminan en calcular; la
fase 1 porta su resultado, no lo reescribe.

## 12. Plan por fases

Cada fase tiene dueño de archivos exclusivo. Dos agentes no escriben el mismo archivo; las
interfaces entre fases son las firmas de `docs/CONTRATO.md` (fase 0) y se cambian sólo ahí, por el
coordinador.

| Fase | Agente | Archivos (exclusivos) | Depende de | Listo cuando |
|---|---|---|---|---|
| F0 esqueleto y contrato | coordinador | repo, `docs/CONTRATO.md`, `docs/decisiones/fabrica.md`, `nucleo/cuenta.mjs` + esquema de `cuenta.json`, `package.json`, `.github/workflows/ci.yml` | — | repo público creado; `CONTRATO.md` con las firmas de `armar`, `tema`, estado v2, cola, puntaje; `node --test` verde; secretos compartidos cargados; Blob store creado |
| F1 núcleo | A | `nucleo/estado.mjs`, `banco.mjs`, `elegir.mjs`, `diseno.mjs`, `agenda.mjs`, `antispam.mjs`, `correr.mjs`, `nucleo/meta/**`, tests | F0, y el trabajo de historias de calcular terminado | tests portados de calcular (`lib`, `meta`, `correr`, `banco`) verdes contra la cuenta `calcular-ar`; `planear` multi-cuenta; cola con relojes; antispam con media real (dobles de Meta); push tras cada paso de Meta; historias con dedupe por contenedor |
| F2a tema y formatos existentes | B | `formatos/**` | F0, y el rediseño de plantillas de calcular terminado | chat, mito, explicador (de calcular) y antes-despues (de APEX) leen `tema`; `tema.test.mjs` sin colores ni fuentes escritos; los 4 temas renderizan cada layout; capturas pasan la autocrítica de `diseno-maestro` |
| F2b formatos nuevos | C | `formatos/lista-de-errores/**`, `pregunta/**`, `comparador/**`, `cuenta-regresiva/**`, `_comun/motivos/{grilla,luz,pizarra,papel}.mjs` | F2a (`_comun/tema.mjs` congelado) | 3 layouts por formato en promedio; cada uno validado con su `validar()` y renderizado en los 4 temas |
| F3 voz | D | `nucleo/voz/**` | F0 | caché por oración en Blob; segunda corrida del mismo guion: delta 0 en `GET /v1/user/subscription`; presupuesto con prioridad a cacheados; audición de calcular y Assistify hecha y voces en sus `cuenta.json` |
| F4 render y cierres | E | `nucleo/render/**`, `cuentas/*/cta/**` | F2a, F3 | `variar` por variante con firma; clips de cierre de las 4 cuentas (paleta × estilo × destino); historia de APEX con su cierre; salidas pasan `revisarSalida` y −14 LUFS |
| F5 cuentas | F | `cuentas/*/cuenta.json`, `marca/**`, `guiones/**`, `hechos.json`, `ideas.json`, `TONO.md` | F0 | las 4 configs validan; APEX importado (M1); calcular migrado con sus 762 ideas como hechos; Assistify con ≥ 40 hechos con `archivo:línea` y ≥ 30 guiones que pasan `revisar --estricto` |
| F6 workflows | G | `.github/workflows/fabrica.yml`, `mantenimiento.yml`, `nucleo/limpiar.mjs` | F1 | `dry_run` de la matriz completa; un tic vacío < 30 s; concurrencia por cuenta probada con dos dispatch simultáneos; fusión con 8 vueltas |
| F7 medición y Kairo | H | `nucleo/puntaje.mjs`, `nucleo/meta/medir.mjs` (lo toma de A al cerrar F1), `kairo/herramientas/reels-prueba.mjs` (repo kairo, su worktree) | F1 | foto de 72 h y de historias a 20 h; puntaje con y sin insights sobre el estado real de @apex.stack; sección de Kairo por cuenta leyendo el repo público |
| F8 ideas y guiones | I | `agentes/**`, `.github/workflows/guiones.yml`, `ideas.yml`, revisor de hechos en `nucleo/hechos.mjs` | F1 (`banco.mjs` congelado), F5 | una corrida real por cuenta: guiones nuevos pasan el estricto; una idea con cifra inventada se descarta en el test; `dolores.json` de APEX llega sin PII |
| F9 corte | coordinador | variables de los repos, PR de apagado en apex-demos y calcular | todo lo anterior | M1–M6 cumplidos; calcular en rampa semana 1; Assistify prendida cuando exista su token |

Lo que le toca a Manuel (una vez, con su identidad): crear @calcular.ar y @assistify_app como
cuentas profesionales vinculadas a una página de Facebook y a la app de Meta de APEX, generar
tokens de larga duración con `instagram_content_publish`, `instagram_basic` e
`instagram_manage_insights` (también regenerar los de @apex.stack y @apex.webssites con insights) y
decidir el plan de ElevenLabs. Todo lo demás lo hace la fábrica.

## 13. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Antispam de Meta en @calcular.ar (cuenta nueva a 15 acciones/día) | alta sin rampa | rampa de 5 semanas, bajar escalón ante `2207078`, gap ≥ 55 min, 1 por corrida |
| @apex.stack suma reels de demos a la cuenta | media | D5: el tope cuenta lo que hay en Instagram, no sólo lo propio |
| Reels de prueba no habilitados en cuentas nuevas | media | D6: se apaga sólo el destino `prueba` |
| Historia publicada dos veces (sin caption para deduplicar) | baja | contenedor pusheado antes de `media_publish` + chequeo por duración en `/stories` |
| ElevenLabs se queda sin crédito (hoy al 99 % del ciclo) | alta este mes | presupuesto con prioridad a cacheados; respaldo Gemini sólo en historias; cambio de plan antes del corte |
| Tres keys de ElevenLabs en envkit: la fábrica podría cobrar a una cuenta que nadie mira | media | F3 fija una sola key (`apex_demos`, la que mide este documento) y Kairo muestra su consumo |
| Guion con una cifra o promesa inventada (YMYL en calcular, oferta en APEX) | media | revisor estricto contra `hechos.json`; hechos `manuel:` sólo a mano; cierre y oferta fijos en config |
| PII de leads en un repo público | baja | `dolores.json` sólo con conteos por categoría, generado del lado privado; el revisor rechaza teléfonos, mails y `@usuarios` |
| Crons de un repo público desactivados o atrasados | baja | actividad diaria en `estado`; Kairo detecta estado viejo (> 26 h) y reactiva |
| Los agentes que hoy tocan calcular cambian el contrato mientras se porta | alta | F1 y F2a arrancan cuando esos agentes cierran; se porta desde `main` de calcular, no desde sus ramas |
| Pocos datos para el puntaje (APEX: 2 variantes/día, sin insights) | alta | z por cuenta y destino, bayesiano por tema con k = 3, 20 % de azar; sin insights el informe lo dice y no concluye |
| Variedad insuficiente con 5 creativos/día en calcular | media | 3 layouts por formato y 4 formatos nuevos antes del escalón 4 de la rampa |
