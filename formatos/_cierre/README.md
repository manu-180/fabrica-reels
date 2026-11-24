# Cierre genérico (`_cierre/`)

El cierre que se pega al final de un reel, portado del de calcular sin nada de marca. Lo usa F4 para
renderizar los clips de `cuentas/<id>/cta/` (paleta × estilo × destino); este módulo sólo arma el proyecto.

```js
import { armarCierre } from './formatos/_cierre/armar.mjs'
await armarCierre({
  tema,                                   // temaDe(...) de la cuenta, con la paleta del clip
  estilo: 'tipografico' | 'buscador',
  salida,                                 // carpeta vacía
  textos: { titular: 'Hacé la cuenta', destacado: 'calcular.ar', corte: 8, ficha: 'Gratis', pista: '¿Cuánto me toca?' },
  captura: { portada, resultado, ancho: 780, marco: { x, y, w, h } },   // opcional
  voz: { wav, palabras },                 // opcional: la frase del cierre con sus tiempos
})                                        // → { duracion_s: 4.9 }
```

- `destacado` se arma letra por letra; desde la letra `corte` va en tinta (".ar"). Sin `corte`, todo en el acento.
- Con voz, cada cosa entra cuando se dice: el destacado cuando suena su primera palabra ("calcular" de
  "calcular punto ar"), la ficha cuando suena su palabra ("gratis"), el enter del buscador al terminar.
  Sin voz, un ritmo fijo. La voz entra a los 0,15 s: el primer cuadro ya está en movimiento.
- `captura`: imágenes reales de la página de la cuenta a 390 px en 2x (ancho 780). `marco` es la zona que se
  marca con el trazo del acento, en px de la captura; la captura se corre para que quede arriba de y 1440.
  Sin captura no hay celular vacío: el logo de la cuenta entra como sello en el centro.
- Specs del render (las de calcular): 1080×1920, 30 fps, 4,9 s, voz y sfx sin música, −16 LUFS. La
  normalización y el pegado al cuerpo son de F4 (`nucleo/render/`).

Probar: `node formatos/_cierre/probar.mjs --cuenta calcular-ar --paleta noche --estilo buscador --titular "Hacé la cuenta" --destacado calcular.ar --corte 8 --ficha Gratis --pista "¿Cuánto me toca?" --portada <inicio.jpg> --captura <aguinaldo.jpg> --marco 74,1139,596,40 --voz <voz.wav> --palabras <voz-palabras.json>`.

Las capturas y la voz del cierre de calcular están en `manu-180/calcular`
(`marketing/reels/scripts/prueba/assets/sitio/` con `capturar.mjs`, y `cta/voz.wav` + `voz-palabras.json`):
traerlas a `cuentas/calcular-ar/cta/` es de F4.
