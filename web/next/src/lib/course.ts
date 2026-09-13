/**
 * Color estable por materia: se deriva del nombre con un hash simple, así que
 * la misma materia conserva su punto de color entre recargas y entre columnas
 * sin necesidad de guardar nada.
 */
const HUES = [212, 160, 268, 24, 340, 190, 45, 300]

export function courseHue(course: string): number {
  let hash = 0
  for (let i = 0; i < course.length; i++) hash = (hash * 31 + course.charCodeAt(i)) | 0
  return HUES[Math.abs(hash) % HUES.length]
}

export function courseDotColor(course: string): string {
  return `hsl(${courseHue(course)} 62% 58%)`
}
