# fabrica-reels

Fábrica de reels de Instagram para @apex.stack, @apex.webssites, @calcular.ar y @assistify_app.
Antes de tocar nada: `docs/decisiones/fabrica.md` (el diseño) y `docs/CONTRATO.md` (las firmas).

- Repo público a propósito: Actions no cobra minutos. Nunca un secreto, un lead ni un dato de un
  cliente en el repo; los secretos van en GitHub Secrets.
- El estado y los guiones automáticos viven en la rama huérfana `estado`. Nada de los workflows
  commitea a `main`.
- Nunca video de gente generado con IA: todo es motion graphics con HyperFrames.
- Toda cifra de un guion sale de `cuentas/<id>/hechos.json` (o de las ideas con su `archivo:línea`);
  el revisor estricto descarta el resto.
- Tests: `node --test "nucleo/**/*.test.mjs" "formatos/**/*.test.mjs"`.
