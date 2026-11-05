import { useCallback, useEffect, useState } from 'react'
import { daysFromToday } from './date'

/**
 * Etapa navideña: del 1 de noviembre al 6 de enero (Día de Reyes) se enciende
 * sola. Apagarla con el botón de la barra vale para esa temporada; la siguiente
 * vuelve a empezar encendida.
 */

const OFF_KEY = 'as-xmas-off'

/** Año en que empezó la temporada en curso; null fuera de temporada. */
function currentSeason(now: Date): string | null {
  if (now.getMonth() >= 10) return String(now.getFullYear())
  if (now.getMonth() === 0 && now.getDate() <= 6) return String(now.getFullYear() - 1)
  return null
}

function readOff(): string | null {
  try {
    return localStorage.getItem(OFF_KEY)
  } catch {
    return null
  }
}

/** Frase corta para la barra: la cuenta regresiva y, ya pasada, la felicitación. */
export function christmasGreeting(now = new Date()): string {
  if (now.getMonth() === 0) return '¡Feliz año nuevo!'
  const days = daysFromToday(`${now.getFullYear()}-12-25`)
  if (days > 1) return `faltan ${days} días para Navidad`
  if (days === 1) return 'hoy es Nochebuena'
  if (days === 0) return '¡Feliz Navidad!'
  return '¡Felices fiestas!'
}

/** 0 al empezar la temporada, 1 en Navidad y después. */
export function christmasProgress(now = new Date()): number {
  if (now.getMonth() === 0) return 1
  const total = daysFromKeys(`${now.getFullYear()}-11-01`, `${now.getFullYear()}-12-25`)
  return Math.min(1, Math.max(0, 1 - daysFromToday(`${now.getFullYear()}-12-25`) / total))
}

function daysFromKeys(from: string, to: string): number {
  return Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000)
}

/** 'YYYY-12-25' de la Navidad en curso o siguiente. */
export function christmasKey(now = new Date()): string {
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  return `${year}-12-25`
}

export interface Christmas {
  inSeason: boolean
  active: boolean
  toggle: () => void
}

export function useChristmas(): Christmas {
  const season = currentSeason(new Date())
  const [off, setOff] = useState(readOff)
  const active = season !== null && off !== season

  // Una clase en <html> para que el CSS decore sin pasar props por todo el árbol.
  useEffect(() => {
    document.documentElement.classList.toggle('xmas', active)
  }, [active])

  const toggle = useCallback(() => {
    const next = active ? season : null
    setOff(next)
    try {
      if (next) localStorage.setItem(OFF_KEY, next)
      else localStorage.removeItem(OFF_KEY)
    } catch {
      /* sin almacenamiento: el cambio dura hasta recargar */
    }
  }, [active, season])

  return { inSeason: season !== null, active, toggle }
}
