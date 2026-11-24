// Doble de un formato para los tests del núcleo: arma un proyecto vacío y dice cuánto dura.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const layouts = ["telefono","hoja"].map((id) => ({ id, apto: () => true }))

export function validar(guion) {
  return guion?.contenido?.rechazar ? ['el formato de prueba rechaza este guion'] : []
}

export async function armar({ guion, hook, salida, diseno, tema }) {
  if (guion?.contenido?.romper) throw new Error('el formato de prueba no lo pudo armar')
  mkdirSync(salida, { recursive: true })
  writeFileSync(join(salida, 'index.html'), JSON.stringify({ clave: guion.clave, hook, diseno, tema }))
  return { duracion_s: 20 }
}
