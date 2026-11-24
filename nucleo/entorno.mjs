// @ts-check

// npx baja dependencias de terceros en cada corrida y el render corre su código: nada de eso tiene que
// ver una credencial. FABRICA_GIT_TOKEN es la que pushea a la rama `estado` (la usa sólo correr.mjs al
// guardar), y los IG_* publican en las cuentas.
export const SECRETOS = [
  'BLOB_READ_WRITE_TOKEN', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY', 'FABRICA_GIT_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN',
  'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'KAIRO_GITHUB_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN', 'REPOS_LECTURA_TOKEN', 'ANTHROPIC_API_KEY',
]
// Por si un secreto nuevo entra al job sin sumarse a la lista: cualquier nombre con forma de credencial también sale.
const CON_FORMA_DE_SECRETO = /^IG_|TOKEN|SECRET|PASSWORD|CREDENTIAL|_KEY$|API_KEY/i

/**
 * El entorno para un proceso de terceros (npx hyperframes, ffmpeg): sin ningún secreto.
 * @param {Record<string, string | undefined>} [env] @param {{ secretos?: Record<string, string | null | undefined> } | null} [cuenta]
 * @returns {Record<string, string>}
 */
export function entornoSinSecretos(env = process.env, cuenta = null) {
  const propios = new Set(Object.values(cuenta?.secretos ?? {}).filter((x) => typeof x === 'string'))
  /** @type {Record<string, string>} */
  const limpio = { HYPERFRAMES_NO_TELEMETRY: '1' }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || SECRETOS.includes(k) || propios.has(k) || CON_FORMA_DE_SECRETO.test(k)) continue
    limpio[k] = v
  }
  return limpio
}
