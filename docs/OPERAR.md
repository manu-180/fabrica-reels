# Operar la fábrica

Cómo se prende, se apaga y se prueba cada cuenta. El porqué está en `docs/decisiones/fabrica.md`
(§ 8 y § 9); las firmas, en `docs/CONTRATO.md`.

## Qué corre y cuándo

| Workflow | Cuándo (hora de Buenos Aires) | Qué hace |
|---|---|---|
| `fabrica.yml` producir | 17:05 y 19:05 (lo de mañana), 5:05 (reintento) | `planear` y, para cada cuenta con algo que producir, un job en la cola `producir-<id>` |
| `fabrica.yml` tic | cada 30 min, de 8:17 a 23:47 | `planear` y, para cada cuenta con algo vencido o para medir, un job en la cola `publicar-<id>` |
| `mantenimiento.yml` | 4:05 | borra de Blob los videos de más de 21 días, corre los tests, avisa si una cuenta prendida no movió su estado en 26 h y reprende `fabrica.yml` si GitHub lo apagó |

Un tic sin nada que hacer termina en el job `planear` (sólo node, sin instalar nada). Producir y
publicar de una misma cuenta van en colas distintas: un tic nunca reemplaza a una producción que
espera. El estado de cada cuenta vive en `cuentas/<id>/estado.json` de la rama `estado` (huérfana,
nunca se mergea) y se pushea después de cada paso que toca Meta, con autor manu-180 noreply y sin
force push.

## Historias de APEX (mientras publica apex-demos)

El job `historias` de `fabrica.yml` (`nucleo/espejo.mjs`) sube como historia reels ya publicados de
@apex.stack y @apex.webssites: hasta `por_dia` de `cuentas/<id>/espejo.json`, primero lo del último día
de la grilla, después una sola prueba, después lo atrasado. Lo que salió queda en
`cuentas/<id>/espejo-estado.json` (rama `estado`). Se apaga solo cuando la cuenta pasa a `modo: "real"`
con su `FABRICA_ACTIVA_<ID>=1`; también lo frenan `FABRICA_PAUSADA` y `FABRICA_PAUSADA_<ID>`.

## Reels de prueba rechazados

Meta los habilita recién con un mínimo de seguidores (error 10/2207081; el 27/11 sólo @apex.stack
llegaba). La fábrica apaga el destino `prueba` de la cuenta y lo vuelve a probar a los 7 días.

## Prender y apagar una cuenta

Una cuenta corre de verdad sólo si se cumplen las dos cosas:

1. `cuentas/<id>/cuenta.json` tiene `"activa": true` (está lista: voz, marca, guiones). Es config del
   repo: se cambia con un commit.
2. La variable del repo `FABRICA_ACTIVA_<ID>=1` (el id en mayúscula y con `_`: `apex-stack` →
   `FABRICA_ACTIVA_APEX_STACK`). Es el interruptor de operación: se cambia sin commit.

```
gh variable set FABRICA_ACTIVA_APEX_STACK --body 1 -R manu-180/fabrica-reels
gh variable delete FABRICA_ACTIVA_APEX_STACK -R manu-180/fabrica-reels
```

Para frenar sin apagar (sigue midiendo lo ya publicado):

| Variable | Efecto |
|---|---|
| `FABRICA_PAUSADA=1` | ninguna cuenta produce ni publica |
| `FABRICA_PAUSADA_<ID>=1` | esa cuenta no produce ni publica |

Una pausa que puso la fábrica sola (token vencido, bloqueo, antispam) está en el estado: se levanta
con `"pausado": null` en `cuentas/<id>/estado.json` de la rama `estado`, o sola si tiene
`pausado_hasta`. Con `"modo": "sombra"` en `cuenta.json` la cuenta produce (sube a Blob y guarda
estado) pero no publica; los mp4 de cada producción quedan como artefacto `fabrica-<id>-sombra`
(`<creativo>/<indice>-<reel|historia>.mp4`) 3 días en la corrida de producir.

Las variables del repo se ven en el log de cada corrida (el repo es público): nunca algo sensible
en una variable.

## Correr a mano

Actions → Fábrica → Run workflow, o:

```
gh workflow run fabrica.yml -R manu-180/fabrica-reels -f cuenta=apex-stack -f accion=publicar -f ahora=true
```

| Entrada | Qué hace |
|---|---|
| `cuenta` | sólo esa cuenta; vacío = todas |
| `accion` | `todo`, `producir`, `publicar` o `medir` |
| `guion` | produce ese guion (clave de `cuentas/<id>/guiones/`) aunque hoy ya haya creativos |
| `dry_run` | produce sin subir videos, sin Instagram y sin guardar el estado; los mp4 quedan como artefacto `fabrica-<id>-seco` 3 días. No mira `activa` ni `FABRICA_ACTIVA_*`. Paga voz (usa la caché de Blob si hay token) |
| `sin_elevenlabs` | sólo con `dry_run`: el paso Producir no recibe la key de ElevenLabs, así que lo que no está en la caché sale con la voz de respaldo (Gemini) y no se paga ElevenLabs |
| `ahora` | publica ya la próxima de hoy, sin esperar su horario; el antispam se respeta igual |

Fuera de `main` sólo corre `dry_run`. Las cuentas de prueba de `nucleo/__fixtures__/cuentas/`
(`prueba-ar`, `prueba-web`) se pueden pedir por `cuenta` y sólo con `dry_run`:

```
gh workflow run fabrica.yml -R manu-180/fabrica-reels -f cuenta=prueba-ar -f dry_run=true
```

Si `dry_run` dice que el día ya está producido, pasá un `guion`.

## Secretos

Compartidos (los usa el paso Producir; `mantenimiento.yml` sólo el de Blob):

| Secreto | Para qué |
|---|---|
| `ELEVENLABS_API_KEY` | voz |
| `GEMINI_API_KEY` | voz de respaldo |
| `BLOB_READ_WRITE_TOKEN` | store `fabrica-reels`: videos para Instagram y caché de voz |

Por cuenta: los **nombres** salen de `secretos` en `cuentas/<id>/cuenta.json` y el workflow los lee
con `secrets[nombre]` sólo en los pasos Publicar y Medir de esa cuenta. Producir y el render nunca
los ven.

| Cuenta | `ig_user` | `ig_token` | `ig_insights` (opcional) |
|---|---|---|---|
| apex-stack | `IG_APEX_STACK_USER_ID` | `IG_APEX_STACK_TOKEN` | `IG_APEX_STACK_INSIGHTS_TOKEN` |
| apex-webssites | `IG_APEX_WEBSSITES_USER_ID` | `IG_APEX_WEBSSITES_TOKEN` | `IG_APEX_WEBSSITES_INSIGHTS_TOKEN` |
| calcular-ar | `IG_CALCULAR_USER_ID` | `IG_CALCULAR_TOKEN` | — |
| assistify | `IG_ASSISTIFY_USER_ID` | `IG_ASSISTIFY_TOKEN` | — |

La tabla copia los `cuenta.json` de hoy; lo que manda es `cuenta.json`. Si se cambia un nombre ahí, se carga
el secreto con el nombre nuevo. Sin `ig_insights`, medir usa `ig_token`.

```
gh secret set IG_APEX_STACK_TOKEN -R manu-180/fabrica-reels
```

El push del estado usa el `GITHUB_TOKEN` de la corrida, que no queda escrito en `.git/config`: sólo
existe en los pasos que pushean.

## Prender una cuenta nueva, en orden

1. Secretos `ig_user` e `ig_token` cargados con los nombres de su `cuenta.json`.
2. `dry_run` de la cuenta y revisar los mp4 del artefacto.
3. `"activa": true` (y `"modo": "sombra"` si conviene ver unos días sin publicar) en `cuenta.json`.
4. `FABRICA_ACTIVA_<ID>=1`.
5. Al día siguiente, en la rama `estado`, `cuentas/<id>/estado.json` con los creativos del día.
