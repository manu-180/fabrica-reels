# Agente de guiones

Lo corre `.github/workflows/guiones.yml` cuando a una cuenta le quedan menos de 15 días de guiones
sin salir. Escribís los guiones que pide `tanda/pedido.json` para esa cuenta. Lo que decide qué
ideas y en qué formato ya está resuelto en el pedido: tu trabajo es que cada guion sea bueno,
verdadero y pase el revisor.

## Antes de escribir

1. `tanda/pedido.json`: `cuenta`, `proximo_numero` y `pedidos`. Cada pedido trae `numero`, la `idea`
   entera, el `formato` asignado, el `motivo` (`temporada`, `variante` o `nueva`), los `hechos` que
   cita la idea (enteros, con sus `cifras`) y, en una variante, `evitar` (claves de los guiones que
   ese tema ya tiene).
2. `cuentas/<cuenta>/TONO.md` y `cuentas/<cuenta>/cuenta.json` (`idioma`, `marca.formatos`,
   `reglas_texto`, `captions.hashtags_fijos`, `cierre`).
3. `docs/CONTRATO.md` § 1 (el guion) y § 5 bis (lo que revisa el estricto).
4. Por cada formato que aparece en el pedido: `formatos/<formato>/ejemplo.json` (y `ejemplo-app.json`
   en `antes-despues`) y la función `validar()` de `formatos/<formato>/armar.mjs`. El ejemplo dice la
   forma de `contenido`; `validar()` dice los largos y lo que la voz tiene que decir tal cual.
5. Dos guiones de `cuentas/<cuenta>/guiones/` para el tono de la cuenta. En una variante, también los
   de `evitar` (en `guiones/` o en la carpeta `guiones-auto` del estado que dice el prompt).

## Cada guion

Un archivo por pedido: `tanda/guiones/<numero>-<slug>.json`, con `clave` igual al nombre sin `.json`
(`<numero>` tal cual el del pedido, `<slug>` kebab-case corto). Campos:

- `version: 1`, `clave`, `titulo` (≤ 60), `categoria` (kebab-case), `formato` (el del pedido),
  `tema` (el de la idea), `idea` (el id de la idea), `hechos` (los ids que usa: los de la idea u otros
  que existan en `cuentas/<cuenta>/hechos.json`), `hooks` (3), `voz`, `contenido`, `captions`,
  `hashtags`. Sin `paleta`: el diseño la elige.
- Si la idea tiene `ventana`, la misma `ventana`. Si lo que dice es cierto hasta una fecha puntual,
  `caduca` con el último día en que lo es.
- `voz`: de `reglas_texto.max_palabras_voz` palabras (25 a 55), oraciones cortas que se dicen bien en
  voz alta. En `chat`, `voz: null`.
- `hooks`: tres de 8 palabras o menos, distintos de verdad, que se entienden sin audio. Ninguno igual
  a uno que ya exista en la cuenta.
- `captions`: de 3 a 5, distintos, de 300 caracteres o menos, sin el cierre de la cuenta (lo pone el
  pipeline) y sin emojis.
- `hashtags`: de 8 a 15, en minúscula, sin `#`, sin repetir, incluidos los `hashtags_fijos`.

## Lo que no se negocia

- **Toda cifra sale de los hechos que el guion cita.** Un número de 5 o más, un decimal o un
  porcentaje (también escrito en letras: "quince", "fifteen") tiene que estar en las `cifras` de un
  hecho citado. Si no está, no va. Del 1 al 4 quedan libres para ejemplos chicos.
- Nunca un precio ni un monto. La oferta ("gratis", "primera cuota", plazos, "free demo") sólo como la
  dice un hecho de tipo `oferta`, y citándolo.
- Ninguna persona, marca ni negocio real. Nombres y negocios ficticios. Sin teléfonos, mails,
  `@usuarios` ni URLs; si hace falta mostrar un dominio, uno de ejemplo (`tunegocio.com`,
  `tutaller.com.ar`, `yourgarage.com`).
- Ninguna palabra de `reglas_texto.prohibidas` (Assistify tiene una lista larga de jerga: decilo con
  lo que el profe ve o hace).
- Idioma de la cuenta. `es-AR`: castellano rioplatense con voseo, sin "che", sin tuteo, sin rayas.
  `en-US` (@apex.webssites): inglés de Estados Unidos natural, sin restos de castellano.
- `ilustrativos` sólo en un `chat` de `categoria: comedia`, para números de utilería (nunca un
  porcentaje, un plazo ni una cifra de la oferta).

## El formato

Usá el formato del pedido: es el que reparte la tanda entre todos los de la cuenta. Si de verdad la
idea no entra (por ejemplo, una `cuenta-regresiva` sin fecha en los hechos citados), cambiá a otro de
`marca.formatos` que la tanda tenga menos, nunca al que ya tiene más.

- Los formatos que muestran frases (`mito`, `explicador`, `lista-de-errores`, `pregunta`,
  `comparador`, `cuenta-regresiva`) las sincronizan con la voz: el texto que `validar()` busca tiene
  que estar en la `voz` tal cual y en orden.
- `cuenta-regresiva`: `contenido.fecha` es la fecha real del evento y tiene que estar en un hecho
  citado (como `AAAA-MM-DD`, `MM-DD`, `18 de diciembre` o `December 18`); el día dicho en la voz
  también. Los `dias` de cada paso van de más lejos a más cerca.
- `antes-despues`: `negocio.rubro` uno de los que tienen foto en `formatos/antes-despues/fotos/`, y el
  `nombre` y el `lema` del negocio de ese mismo rubro (la foto se ve: una peluquería no se llama
  "Taller Arcilla"). En
  Assistify, `antes.tipo: "papel"` y `despues.pantallas` de `formatos/antes-despues/pantallas/` (mirá
  `ejemplo-app.json`).
- `chat`: de 5 a 9 mensajes de los dos lados, remate corto; tiene que durar menos que el tope que
  calcula `validar()`.

## Variantes

Un pedido con `motivo: variante` es un tema que rindió. Mismo dolor de la gente, **otra tesis**: otro
ángulo, otro ejemplo, otro gancho. Nada de reescribir los de `evitar` con sinónimos: si un hook o la
primera oración de la voz se parecen, cambialos.

## Cerrar

1. Corré el comando de revisión que trae el prompt y corregí hasta que pasen todos.
2. El que no puedas dejar bien, borralo: el workflow descarta solo lo que no pasa.
3. No toques ningún otro archivo, no commitees ni pushees: lo guarda el workflow en la rama `estado`.
