# Render (F4)

Lo que `producir` espera de F4 (`docs/CONTRATO.md` § 5 bis): `renderizarCuerpo` y `armarFinal`, en
`index.mjs`. Todo proceso de terceros (npx, HyperFrames, ffmpeg) se lanza con el `env` que llega, que
es `entornoSinSecretos(...)`: nunca con `process.env`.

| Archivo | Qué hace |
|---|---|
| `hyperframes.mjs` | `hyperframes@0.8.140` con las tres capturas que no se traban en Actions, en orden, y tope de 15 min por intento |
| `variar.mjs` | el final de una variante: ejes de la firma (zoom, encuadre, velocidad ≤ 4 %, color, textura sobre 4:2:0), cierre pegado con corte limpio, música con ducking, −14 LUFS en dos pasadas y h264 High 4.1 |
| `medios.mjs` | `sondear`, `medirAudio` (LUFS y pico verdadero), `revisarSalida` (Meta + High 4.1 + 1080x1920 + ≤ 15 MB + faststart), `revisarAudio` (−14 ± 1 LUFS, pico ≤ −1,5 dBTP) |
| `cierre.mjs` | el cierre de cada reel: el clip de `cta/clips.json` o, si la cuenta pide `por_reel`, uno propio con la página de su tema (si falla, va el clip) |
| `cierres.mjs` | CLI: renderiza los clips de una cuenta y graba la voz del cierre |
| `capturar.mjs` | CLI: capturas del sitio de una cuenta para el celular del cierre (montos en pesos difuminados) |

## El cierre de cada cuenta: `cuentas/<id>/cta/`

- `cierre.json`: `{ reel, historia }`, cada uno `{ estilos, textos: { titular, destacado, corte?, ficha?, pista? },
  voz: { wav, palabras } | null, sitio?, portada?, por_reel? }` (null = ese destino no se genera acá).
- `clips.json`: los clips que elige `firmaPara` (`<paleta>-<estilo>` y `historia-<paleta>-<estilo>`).
- `voz.wav` + `voz-palabras.json`: la frase del cierre, grabada una vez. Nunca se regenera en el pipeline.
- `sitio/sitio.json` + `<clave>.jpg`: `{ base, temas, capturas: { clave: { ruta, resultado } } }`.

| Cuenta | Reel | Historia |
|---|---|---|
| calcular-ar | clips de calcular (home) y, por reel, la calculadora del tema (`paginaDe`: `pagina` de la idea, si no `temas` por la clave) | el del reel |
| apex-stack | los 10 clips "Comentá WEB" de apex-demos, copiados tal cual (copy de venta: no se regeneran acá) | "Respondé con WEB", sin voz |
| apex-webssites | "Comment WEB" tipográfico | "Reply with WEB", sin voz |
| assistify | buscador y tipográfico con la home de assistify.lat | el del reel |

## Regenerar

```bash
node nucleo/render/cierres.mjs --cuenta assistify [--destino reel|historia] [--paleta noche] [--estilo buscador]   # ~30 s por clip
envkit run -p apex_demos --only ELEVENLABS_API_KEY -- node nucleo/render/cierres.mjs --cuenta apex-webssites --voz   # sólo si cambia la frase
node nucleo/render/capturar.mjs --cuenta calcular-ar [aguinaldo ...]   # Chrome del sistema o CHROME=
```

`--voz --proveedor gemini` graba con el respaldo de la cuenta (lo que tienen hoy apex-webssites y
assistify, hasta que haya crédito de ElevenLabs para sus voces).
