# Voces por cuenta (audición del 23/11/2026)

Audición hecha sin gastar caracteres de ElevenLabs: al ciclo le quedaban 872 de 84.239 (762 al
cerrar) y se reinicia el 28/11. Se leyó `GET /v1/voices` (las 42 voces de la cuenta) y
`GET /v1/shared-voices` con idioma español y acento argentino (103 voces) y con inglés americano y
uso social media, advertisement y conversational (300 voces). De 25 candidatas se bajó el
`preview_url` y se midió con faster-whisper (palabras por minuto, pausas de más de 0,3 s) y con
`ebur128`. Se miró además que tengan `es-AR` (o `en-US`) verificado para `eleven_multilingual_v2`,
el uso de los últimos 7 días (una voz que nadie usa puede desaparecer) y el aviso de baja
(`notice_period`).

Límite honesto: cada preview lee un texto distinto, así que las ppm sirven para descartar extremos,
no para comparar finos. La elección final se confirma oyendo el **mismo guion** con las tres
candidatas, después del 28/11 (abajo, ~620 caracteres por cuenta).

## Resumen

| Cuenta | Voz | voice_id | Estado |
|---|---|---|---|
| @calcular.ar | Mauricio | `jIgvw3W75cbd6IP0JYwL` | propuesta, falta la prueba con guion |
| @assistify_app | Sofía | `h60rOzgfLmYsntfqgGu2` | propuesta, falta la prueba con guion |
| @apex.stack | Malena | `p7AwDmKvTdoHTBuueGvP` | confirmada, sigue |
| @apex.webssites | Zara | `jqcCZkN6Knx8BJ5TBdYR` | confirmada, sigue |

Ajustes para las cuatro: los de Manuel (stability 0,45, similarity 0,8, style 0,3), pausas de
0,85 tras el hook, 0,8 entre oraciones, 0,9 antes del cierre y 0,25 en las comas.

## @calcular.ar

Público: trabajadores y dueños de pymes que hacen cuentas de plata (aguinaldo, liquidación,
vacaciones). Tiene que sonar a alguien que sabe y no te vende humo, y no puede sonar a APEX (Malena).

| Candidata | voice_id | Medido | Por qué sí, por qué no |
|---|---|---|---|
| **Mauricio** | `jIgvw3W75cbd6IP0JYwL` | 138 ppm, pausas de 0,4 a 0,6 s | Hombre adulto, rioplatense, cálido y seguro, hecho para publicidad. Es la que mejor suena a "te explico tu plata con calma". Activa (2,3 M caracteres en 7 días), `es-AR` verificado, aviso de baja de 730 días. Lee un poco lento: con oraciones cortas queda en 145 a 155 ppm |
| Tomás | `QK4xDwo9ESPHA4JNUpX3` | 168 ppm | La rioplatense masculina más usada (49 mil clones). Joven y conversacional: más cercana, menos autoridad para hablar de una liquidación. Aviso de baja de 180 días, el más corto |
| Franco (publicidad) | `jbWMqMKDKL7X0v1DXTHH` | 139 ppm | Adulto y confiado, pero tira a locutor de radio: justo lo que el reel no quiere |
| Agus (la base del diseño) | `vgekQLm3GYiKMHUnPVvY` | 181 ppm | Descartado: joven y de humor, rápido para un tema de plata |

## @assistify_app

Público: docentes y dueños de institutos. Cálida, clara, que acompañe sin apurar. Distinta de
Malena (el diseño proponía "Malena con stability 0,55": se descarta porque las marcas no tienen
que sonar iguales).

| Candidata | voice_id | Medido | Por qué sí, por qué no |
|---|---|---|---|
| **Sofía** | `h60rOzgfLmYsntfqgGu2` | 155 ppm, pausas de 0,36 y 0,46 s | Mujer adulta, rioplatense, natural y "sin sobreactuación" (así se describe y así suena el preview). Justo en el ritmo de la regla de reels. Muy usada (9,7 M caracteres en 7 días) y ya está en la biblioteca de la cuenta (figura como "Delfina") |
| Argie | `arMlPrYpUo1XH5F2zM6R` | 143 ppm | Cálida y clara, pensada para explicar: la más "docente". Más narradora que vendedora y con menos uso (1 M en 7 días) |
| Marina | `RO0BdeZ6XxVXOfbdD4H0` | 160 ppm | Cálida de podcast. Uso bajo (0,6 M en 7 días) y una pausa de 1,1 s en el preview: hay que ver si se arrastra |

## @apex.stack

Malena se queda. La validó Manuel con la prueba v3a (8/10), es la rioplatense más usada de toda la
biblioteca (27,9 M caracteres en 7 días: no va a desaparecer) y los reels que ya venden suenan con
ella. Cambiarla sería cambiar la voz de una marca que convierte, y eso es decisión de negocio.

| Candidata | voice_id | Por qué no la reemplaza |
|---|---|---|
| **Malena** | `p7AwDmKvTdoHTBuueGvP` | Se queda |
| Valeria | `9oPKasc15pfAbMr7N6Gs` | La otra gigante (125 mil clones), pero más de influencer ("¡Pará, pará!"): menos confianza para vender una web |
| Cande | `yFykvY9iSJewrANOC0cU` | "Amiga de Buenos Aires", relajada: buena para UGC, floja para el cierre de venta |

## @apex.webssites

Zara se queda: es la que ya usan los reels en inglés, su preview da 159 ppm (dentro de la regla) y
suena a persona, no a locutora.

| Candidata | voice_id | Medido | Por qué no la reemplaza |
|---|---|---|---|
| **Zara** | `jqcCZkN6Knx8BJ5TBdYR` | 159 ppm | Se queda |
| Lara | `vChnJZ1Cu89g2XXumPfT` | 201 ppm | La más usada para social, pero rápida: hay que frenarla |
| Justin Case | `DtQLDxHbTiQTpVVanTy1` | 151 ppm | Hombre, confiable, de anuncio: la alternativa si se quiere probar una voz masculina |

## La prueba que falta (después del 28/11)

Con el mismo guion por cuenta y las tres candidatas, ~620 caracteres cada una:

```
envkit run -p apex_demos --only ELEVENLABS_API_KEY -- node nucleo/voz/audicion.mjs \
  --cuenta cuentas/calcular-ar/cuenta.json \
  --voces jIgvw3W75cbd6IP0JYwL,QK4xDwo9ESPHA4JNUpX3,jbWMqMKDKL7X0v1DXTHH \
  --hook "Tu aguinaldo no sale del último sueldo." \
  --cuerpo "Sale del mejor sueldo del semestre, no del último que cobraste. Si te dieron un aumento en marzo, ese cuenta. Hacé la cuenta con tus números, gratis, en calcular punto ar." \
  --salida salida/audicion-calcular --pagar
```

Sin `--pagar` sólo dice cuánto cuesta. Para Assistify, las voces
`h60rOzgfLmYsntfqgGu2,arMlPrYpUo1XH5F2zM6R,RO0BdeZ6XxVXOfbdD4H0` con un guion de su banco. Se elige
con el panel `founder-consumer` del público de la cuenta y la regla de `edicion-reels` (145 a 165
ppm, pausas de 0,8 a 0,9 s medidas con `silencedetect`). El `voice_id` elegido va a su
`cuenta.json` (F5).

Nunca una voz clonada de una persona real: en la cuenta están "Fede Garbarino", "Fede Garbarino v2"
y "Juan Pamies", y no se usan.
