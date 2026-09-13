import type { TaskSource } from '../types'

/**
 * Etiqueta de origen que se muestra en la tarjeta y en el detalle.
 *
 * `calendar` son las notas que el usuario escribió directamente en Google
 * Calendar (normalmente desde el celular) y que el tablero importa al abrirse:
 * conviene distinguirlas de las manuales creadas aquí, porque quien manda
 * sobre ellas es Calendar (si se borran allá, desaparecen de aquí).
 */
export function sourceLabel(source: TaskSource): string {
  if (source === 'classroom') return 'Classroom'
  if (source === 'calendar') return 'Calendar'
  return 'Manual'
}
