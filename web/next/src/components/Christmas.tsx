import { memo, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { christmasProgress } from '../lib/season'

/** Adornos de la etapa navideña. Ninguno recibe clics ni lo leen los lectores de pantalla. */

const EMOJIS = ['🎄', '🎁', '⛄', '🔔', '⭐', '🦌', '🍪', '🕯️', '❄️', '🎅', '🧦', '🍭']

/**
 * Emoji pequeño para tarjetas, columnas y títulos. Con `seed` sale siempre el
 * mismo para esa tarea, así no cambia al recargar. Se muestra solo por CSS con
 * la clase `xmas`, para no pasar el estado del tema por todos los componentes.
 */
export function XmasEmoji({
  seed = '',
  emoji,
  className,
}: {
  seed?: string
  emoji?: string
  className?: string
}) {
  const hash = [...seed].reduce((sum, ch) => (sum * 31 + ch.codePointAt(0)!) >>> 0, 7)
  return (
    <span aria-hidden className={`as-xmas-emoji ${className ?? ''}`}>
      {emoji ?? EMOJIS[hash % EMOJIS.length]}
    </span>
  )
}

/** Rojo, verde, dorado y azul hielo. */
const BULB_COLORS = ['#ff5a5f', '#4ade80', '#ffd166', '#7fb4ff']
const BULB_PITCH = 44
/** Suficientes para una ventana de 2800 px; lo que sobra lo recorta el contenedor. */
const BULBS = Array.from({ length: 64 }, (_, i) => i)

/** Tira de focos colgada del borde inferior de la barra. */
export function Garland() {
  return (
    <div
      aria-hidden
      className="as-garland pointer-events-none absolute inset-x-0 top-full h-[22px] overflow-hidden"
    >
      {BULBS.map((i) => (
        <span
          key={i}
          className="as-bulb"
          style={
            {
              left: BULB_PITCH / 2 + i * BULB_PITCH,
              '--bulb': BULB_COLORS[i % BULB_COLORS.length],
              // Desfase fijo pero irregular: que no parpadeen todos a la vez.
              animationDelay: `${-((i * 1.7) % 4)}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

export function SantaHat({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={`pointer-events-none ${className ?? ''}`}>
      <path d="M6 23C7 12 13 5 21 6c4 .5 6 4 7 9-2-2-4-3-6-3 1 4 2 7 2 11Z" fill="#e5383b" />
      <rect x="4" y="21" width="23" height="6" rx="3" fill="#fff" />
      <circle cx="28" cy="16" r="3" fill="#fff" />
    </svg>
  )
}

export function ChristmasTree({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 48" aria-hidden className={`pointer-events-none ${className ?? ''}`}>
      <rect x="17.5" y="40" width="5" height="6" rx="1" fill="#8a5a3c" />
      <path d="M20 16 34 41H6Z" fill="#14713f" />
      <path d="M20 11 31 31H9Z" fill="#1a8a4c" />
      <path d="M20 6 27 21H13Z" fill="#23a55d" />
      <path d="m20 1 1.3 3 3.2.2-2.5 2 .8 3.1L20 7.6l-2.8 1.7.8-3.1-2.5-2 3.2-.2Z" fill="#ffd166" />
      {[
        [15, 18, '#ff5a5f'],
        [24, 24, '#ffd166'],
        [14, 31, '#7fb4ff'],
        [26, 35, '#ff5a5f'],
        [20, 29, '#fff'],
      ].map(([cx, cy, fill], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r="1.6"
          fill={String(fill)}
          className="as-bulb-dot"
          style={{ animationDelay: `${-i * 0.9}s` }}
        />
      ))}
    </svg>
  )
}

/** Radio en px alrededor del cursor en el que los copos se apartan. */
const POINTER_RADIUS = 90

/**
 * Trineo que cruza la pantalla una vez, como premio por terminar una tarea. Va
 * debajo de los diálogos, no recibe clics y con movimiento reducido no se ve.
 */
export function SleighFlight({ onDone }: { onDone: () => void }) {
  return (
    <div
      aria-hidden
      onAnimationEnd={onDone}
      className="as-sleigh pointer-events-none fixed top-20 left-0 z-40 w-[300px]"
    >
      <svg viewBox="0 0 300 70" className="block w-full">
        <g fill="#fff" opacity=".9">
          <circle cx="4" cy="46" r="1.2" />
          <circle cx="16" cy="38" r="1.6" />
          <circle cx="28" cy="48" r="1" />
          <circle cx="40" cy="42" r="1.4" />
        </g>
        {/* Trineo con Santa */}
        <path d="M52 46h42c6 0 10-5 12-13l5 1c-2 11-8 18-17 18H50c-5 0-7-3-6-7Z" fill="#e5383b" />
        <path d="M46 57h56c5 0 8-2 10-6" fill="none" stroke="#ffd166" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="72" cy="31" r="10" fill="#e5383b" />
        <circle cx="76" cy="20" r="6" fill="#ffd9b8" />
        <path d="M69 18c1-8 8-11 13-7l6 7-3 1-4-3Z" fill="#e5383b" />
        <circle cx="88" cy="19" r="2" fill="#fff" />
        <path d="M70 19h12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        {/* Riendas y renos */}
        <path d="M84 30Q140 34 172 26M172 26q40 2 62-4" fill="none" stroke="#ffd166" strokeWidth="1" />
        {[0, 62].map((x) => (
          <g key={x} transform={`translate(${x} 0)`} fill="#b98a5e">
            <ellipse cx="172" cy="36" rx="19" ry="7.5" />
            <path d="M186 32l9-13 6 3-8 15Z" />
            <ellipse cx="200" cy="20" rx="7" ry="4.5" />
            <path d="M158 40l-7 12M165 42l-3 13M180 42l5 13M186 39l9 10" stroke="#b98a5e" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M197 16l-4-9M193 10l-5-2M197 10l4-4" fill="none" stroke="#e7cfae" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="207" cy="20" r="2" fill={x ? '#ff5a5f' : '#2b1d14'} />
          </g>
        ))}
      </svg>
    </div>
  )
}

interface Flake {
  x: number
  y: number
  /** Radio en px; los grandes parecen más cerca y por eso caen más rápido. */
  size: number
  speed: number
  sway: number
  alpha: number
  crystal: boolean
  spin: number
}

function newFlake(width: number, height: number): Flake {
  const depth = Math.random()
  const crystal = Math.random() < 0.15
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    size: crystal ? 5 + depth * 3 : 0.8 + depth * 1.4,
    speed: 14 + depth * 26,
    sway: Math.random() * Math.PI * 2,
    alpha: 0.3 + depth * 0.4,
    crystal,
    spin: Math.random() * Math.PI,
  }
}

/** Copo de seis brazos pintado una sola vez: dibujarlo línea a línea en cada cuadro no vale la pena. */
function crystalSprite(): HTMLCanvasElement {
  const size = 48
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = size
  const ctx = sprite.getContext('2d')!
  ctx.translate(size / 2, size / 2)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  for (let arm = 0; arm < 6; arm++) {
    ctx.rotate(Math.PI / 3)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, -21)
    ctx.moveTo(0, -13)
    ctx.lineTo(-6, -19)
    ctx.moveTo(0, -13)
    ctx.lineTo(6, -19)
    ctx.stroke()
  }
  return sprite
}

/**
 * Nieve en un solo lienzo 2D. Va en un componente memoizado y sin props: los
 * re-renders del tablero no lo tocan, y requestAnimationFrame ya se detiene
 * solo con la pestaña oculta. Con movimiento reducido queda un cuadro fijo.
 */
export const Snowfall = memo(function Snowfall() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const sprite = crystalSprite()
    let width = 0
    let height = 0
    let flakes: Flake[] = []
    // Los copos se apartan del cursor. Fuera de la ventana no empuja nada.
    let pointerX = -1000
    let pointerY = -1000
    const onPointer = (e: PointerEvent) => {
      pointerX = e.clientX
      pointerY = e.clientY
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#fff'
      for (const f of flakes) {
        ctx.globalAlpha = f.alpha
        if (f.crystal) {
          ctx.save()
          ctx.translate(f.x, f.y)
          ctx.rotate(f.spin)
          ctx.drawImage(sprite, -f.size, -f.size, f.size * 2, f.size * 2)
          ctx.restore()
        } else {
          ctx.beginPath()
          ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.min(80, Math.round((width * height) / 16_000))
      flakes = flakes.slice(0, count)
      while (flakes.length < count) flakes.push(newFlake(width, height))
      if (reduced) draw()
    }
    resize()
    window.addEventListener('resize', resize)

    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      // Tope por si la pestaña estuvo oculta: que no salten todos de golpe.
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      for (const f of flakes) {
        f.y += f.speed * dt
        f.sway += dt * 0.7
        f.x += Math.sin(f.sway) * 10 * dt
        f.spin += dt * 0.3
        const dx = f.x - pointerX
        const dy = f.y - pointerY
        const distance = Math.hypot(dx, dy)
        if (distance < POINTER_RADIUS && distance > 0) {
          const push = (1 - distance / POINTER_RADIUS) * 90 * dt
          f.x += (dx / distance) * push
          f.y += (dy / distance) * push
        }
        if (f.y > height + 10) {
          f.y = -10
          f.x = Math.random() * width
        }
      }
      draw()
    }
    if (!reduced) frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointer)
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-20 size-full" />
      {/* La nieve que ya cayó: sube conforme se acerca Navidad, sin tapar
          ningún botón. */}
      <div
        aria-hidden
        className="as-snowdrift pointer-events-none fixed inset-x-0 bottom-0 z-20"
        style={{ height: 10 + christmasProgress() * 12 }}
      />
    </>
  )
})
