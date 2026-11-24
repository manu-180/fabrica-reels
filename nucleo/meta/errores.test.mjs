import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clasificarErrorMeta, motivoPausa } from './errores.mjs'

test('clasificarErrorMeta: la tabla del diseño § 8.4', () => {
  assert.equal(clasificarErrorMeta({ codigo: 190, message: 'Error validating access token' }), 'token')
  assert.equal(clasificarErrorMeta({ codigo: 102 }), 'token')
  assert.equal(clasificarErrorMeta({ codigo: 9, subcodigo: 2207078, message: 'User is performing too many actions' }), 'antispam')
  for (const codigo of [4, 17, 32, 341, 613]) assert.equal(clasificarErrorMeta({ codigo }), 'antispam', String(codigo))
  assert.equal(clasificarErrorMeta({ codigo: 9, subcodigo: 2207042, message: 'reached the maximum number of posts' }), 'cupo')
  assert.equal(clasificarErrorMeta({ codigo: 9, subcodigo: 2207051, message: 'We restrict certain activity to protect our community' }), 'bloqueo')
  assert.equal(clasificarErrorMeta({ codigo: 9, subcodigo: 2207050 }), 'bloqueo')
  assert.equal(clasificarErrorMeta({ codigo: 368, message: 'temporarily blocked for policies violations' }), 'bloqueo')
  assert.equal(clasificarErrorMeta({ codigo: 4, message: 'This action was blocked as spam' }), 'bloqueo')
  assert.equal(clasificarErrorMeta({ codigo: 10, message: 'Application does not have permission for this action' }), 'permiso')
  assert.equal(clasificarErrorMeta({ codigo: 200, message: 'Permissions error' }), 'permiso')
  assert.equal(clasificarErrorMeta({ http: 500, transitorio: true }), 'transitorio')
  assert.equal(clasificarErrorMeta({ codigo: 2, transitorio: true }), 'transitorio')
  assert.equal(clasificarErrorMeta({ codigo: 1 }), 'transitorio')
  assert.equal(clasificarErrorMeta({ codigo: 100, subcodigo: 2207026, message: 'unsupported video format' }), 'publicacion')
  assert.equal(clasificarErrorMeta({ codigo: 9007, subcodigo: 2207027, message: 'Media ID is not available' }), 'transitorio')
  assert.equal(clasificarErrorMeta({ codigo: 100, message: 'The media is not ready for publishing, please wait for a moment' }), 'transitorio')
  assert.equal(clasificarErrorMeta({ codigo: 100, message: 'The video has not finished processing' }), 'transitorio')
})

test('clasificarErrorMeta: un permiso o trial_params rechazado en una prueba apaga sólo el destino', () => {
  assert.equal(clasificarErrorMeta({ codigo: 100, message: 'Invalid parameter: trial_params is not supported for this user' }, { destino: 'prueba' }), 'permiso-trial')
  assert.equal(clasificarErrorMeta({ codigo: 10, message: 'Application does not have permission for this action' }, { destino: 'prueba' }), 'permiso-trial')
  assert.equal(clasificarErrorMeta({ codigo: 10, message: 'Application does not have permission for this action' }, { destino: 'normal' }), 'permiso')
  assert.equal(clasificarErrorMeta({ codigo: 100, message: 'Invalid parameter: trial_params' }), 'permiso')
  assert.equal(clasificarErrorMeta({ codigo: 190 }, { destino: 'prueba' }), 'token')
})

test('motivoPausa nombra el secreto de la cuenta', () => {
  assert.match(motivoPausa('token', 'Session has expired', { ig_token: 'IG_CALCULAR_TOKEN' }), /IG_CALCULAR_TOKEN/)
  assert.match(motivoPausa('bloqueo', 'restrict', { ig_token: 'X' }), /a mano/)
})
