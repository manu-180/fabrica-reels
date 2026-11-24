import assert from 'node:assert/strict'
import { test } from 'node:test'
import { entornoSinSecretos } from './entorno.mjs'
import { cuentaWeb } from './__fixtures__/ayuda.mjs'

test('entornoSinSecretos: el render y npx no ven ninguna credencial, FABRICA_GIT_TOKEN incluida', () => {
  const env = { PATH: '/usr/bin', HOME: '/h', RUNNER_TEMP: '/t', FABRICA_GIT_TOKEN: 'ghs', GITHUB_TOKEN: 'g', BLOB_READ_WRITE_TOKEN: 'b', ELEVENLABS_API_KEY: 'e', IG_PRUEBA_WEB_TOKEN: 'i', IG_CALCULAR_USER_ID: '1', OTRO_SECRET: 's', NPM_CONFIG_CACHE: '/c' }
  const limpio = entornoSinSecretos(env, cuentaWeb())
  assert.deepEqual(Object.keys(limpio).sort(), ['HOME', 'HYPERFRAMES_NO_TELEMETRY', 'NPM_CONFIG_CACHE', 'PATH', 'RUNNER_TEMP'])
})
