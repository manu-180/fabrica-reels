# Agente de ideas

Lo corre `.github/workflows/ideas.yml` cuando a una cuenta le quedan menos de 60 días de ideas sin
guion (y una vez por mes para refrescar). Proponés ideas nuevas para esa cuenta. **Nunca hay ideas
de la nada**: cada una se apoya en hechos con fuente, y el revisor descarta la que cite un hecho que
no existe o diga una cifra que sus hechos no tienen.

## Antes de proponer

1. `tanda/pedido-ideas.json`: `cuantas` (cuántas pedir), `formatos` de la cuenta, `hechos_sin_idea`,
   `temas` (cuántas ideas tiene cada uno), `rendimiento` (`mejores`, `peores`, `no_insistir`,
   `preguntas` de los comentarios), `dolores` (conteos por categoría, puede ser `null`) y
   `repo_fuente` (el repo del producto con checkout en disco, o `null`).
2. `tanda/ideas-existentes.txt`: una línea por idea que ya existe (`id | tema | idea`). Buscá ahí con
   Grep antes de proponer algo: lo repetido se descarta.
3. `cuentas/<cuenta>/TONO.md`, `cuentas/<cuenta>/cuenta.json` y `cuentas/<cuenta>/hechos.json`
   (grande en calcular: buscá con Grep o node, no lo leas entero).
4. `docs/CONTRATO.md` § 1 (la forma de `Idea` y `Hecho`) y `docs/decisiones/fabrica.md` § 4.2 y § 4.3.

## De dónde sale cada idea

En este orden de preferencia:

1. **Hechos sin idea** (`hechos_sin_idea`): cada uno merece al menos una idea si se puede contar.
2. **Rendimiento**: de los temas de `mejores`, ideas con otro ángulo y el mismo dolor. Los de
   `no_insistir` no se tocan. Las `preguntas` de los comentarios son ideas de formato `pregunta`
   (reescritas: nunca el texto de una persona tal cual, nunca un nombre).
3. **Dolores** (`dolores`): el dolor da el ángulo (`origen: dolor`), los hechos dan lo que se afirma.
4. **Calendario**: fechas de la cuenta (aguinaldo, vacaciones e impuestos en calcular; inicio de
   clases y vacaciones de invierno en Assistify; Black Friday y fin de año en APEX) con `origen:
   temporada` y `ventana`. Sólo si un hecho dice la fecha.
5. **El repo del producto** (`repo_fuente`, si no es `null`): lo que existe en el código y todavía no
   tiene hecho. Ahí sí proponés hechos nuevos (abajo).

Repartí `formato_sugerido` entre **todos** los formatos de la cuenta (incluidos `lista-de-errores`,
`pregunta`, `comparador`, `cuenta-regresiva` y, donde está, `antes-despues`; la `cuenta-regresiva` sólo
para una idea con `ventana` y un hecho que diga la fecha) y variá el `angulo`
(`dato`, `mito`, `comedia`, `error`, `pregunta`, `comparacion`, `calendario`).

## La idea

`tanda/ideas-nuevas.json` con `{ "ideas": [ ... ] }`, cada una:

- `id` (kebab-case, nuevo), `tema` (kebab-case: uno existente si es el mismo asunto), `idea` (una
  frase de 160 caracteres o menos, en el idioma de la cuenta), `angulo`, `formato_sugerido` (uno de
  `formatos`), `hechos` (ids que existen, al menos uno), `ventana` (`null` o `{ "desde": "MM-DD",
  "hasta": "MM-DD" }`), `origen` (`hechos`, `dolor`, `rendimiento` o `temporada`).
- calcular además: `origen_repo` (`archivo:línea` relativo al repo de calcular, la línea donde está
  el dato), `dato` (el dato en una frase, con sus cifras), `pagina` (la URL de calcular.ar si la hay) y
  `fuente_oficial` (`{ nombre, url }` de `.gob.ar`) si el repo la cita.
- Ninguna cifra en `idea` ni en `dato` que no esté en las `cifras` de sus hechos. Ningún nombre de
  persona, teléfono, mail, `@usuario` ni URL en el texto. Nunca un precio.

## Hechos nuevos

Sólo si leíste la fuente. `tanda/hechos-propuestos.json` con `{ "hechos": [ ... ] }`, cada uno con la
forma de `Hecho`: `id`, `tipo` (`dato`, `producto` o `norma`; los de `oferta` los carga Manuel a mano),
`texto`, `cifras` (tal cual en el código), `fuente`, `envejece`.

- `fuente: "repo:<dueño>/<repo>:<archivo>:<línea>"` de `repo_fuente`: el revisor abre el archivo y
  exige que la línea exista y que cada cifra esté a 8 líneas o menos. Si pasa, entra solo y la idea
  que lo cita también. En calcular, el hecho de una idea lleva el mismo `id` que la idea.
- Una fuente `https://` (un informe público) o algo que sólo sabe Manuel queda **pendiente**: no
  escribas la idea que depende de él, porque se descarta.

## Cerrar

1. Corré el comando de revisión que trae el prompt: lista lo que se descarta y por qué. Corregí o
   sacá hasta que lo que queda sea lo que querés que entre.
2. No toques ningún otro archivo, no commitees ni pushees: lo guarda el workflow en la rama `estado`.
