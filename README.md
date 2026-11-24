# Fábrica de reels

Una sola fábrica de reels de Instagram en motion graphics (HyperFrames, voz de ElevenLabs, ffmpeg)
para cuatro cuentas: @apex.stack, @apex.webssites, @calcular.ar y @assistify_app. Cada cuenta trae
su configuración en `cuentas/<id>/cuenta.json`: cuántos reels por día, dónde se publican (reel de
prueba, reel normal, historia), idioma, voz y marca.

Corre en GitHub Actions. El estado de cada cuenta vive en la rama `estado`, nunca en `main`.

- Diseño y porqué de cada decisión: `docs/decisiones/fabrica.md`.
- Contrato entre las piezas: `docs/CONTRATO.md`.
