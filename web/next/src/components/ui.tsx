import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type ButtonVariant = 'primary' | 'ghost' | 'subtle' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:opacity-90 disabled:opacity-45',
  ghost:
    'text-ink-dim hover:text-ink hover:bg-sunken border border-transparent hover:border-line disabled:opacity-45',
  subtle: 'bg-sunken text-ink border border-line hover:border-line-strong disabled:opacity-45',
  danger: 'text-danger bg-danger-soft hover:brightness-110 disabled:opacity-45',
}

// El tamaño se elige aquí y no con clases sueltas en cada llamada: dos
// utilidades de alto en el mismo elemento (h-9 y h-10) no se resuelven por
// orden de escritura, así que el ganador sería impredecible.
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1 px-2 text-[12px]',
  md: 'h-9 gap-1.5 px-3 text-[13px]',
  lg: 'h-10 gap-2 px-4 text-[13.5px]',
  icon: 'size-10 gap-0 p-0 text-[13px]',
}

export function Button({
  variant = 'ghost',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium',
        'transition-[background-color,color,opacity,border-color] duration-150 disabled:cursor-not-allowed',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'anim-spin size-3.5 rounded-full border-[1.5px] border-current border-t-transparent opacity-70',
        className,
      )}
    />
  )
}

/** Píldora seleccionable (tipo, alertas, repetición, presets de fecha). */
export function Chip({
  active,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'h-8 rounded-full border px-3 text-[12.5px] font-medium transition-all duration-150',
        active
          ? 'border-accent/40 bg-accent-soft text-accent-ink'
          : 'border-line text-ink-dim hover:border-line-strong hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-medium tracking-[0.08em] text-ink-faint uppercase">
      {children}
    </div>
  )
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cx('inline-block size-1.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color }}
    />
  )
}
