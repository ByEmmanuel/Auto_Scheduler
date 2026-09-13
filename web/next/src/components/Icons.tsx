/** Iconos en línea (stroke 1.5, grid de 24) para no arrastrar una librería. */
type IconProps = { className?: string }

const base = 'shrink-0'

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${base} ${className ?? 'size-4'}`}
    >
      {children}
    </svg>
  )
}

export const IconSync = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
    <path d="M3 21v-5h5" />
  </Svg>
)

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
)

export const IconHistory = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 2" />
  </Svg>
)

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12.5l5 5L20 6.5" />
  </Svg>
)

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Svg>
)

export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-8.5 8.5" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
)

export const IconNote = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4z" />
  </Svg>
)

export const IconGrip = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconCalendar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
)

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 9a6 6 0 1 0-12 0c0 4-1.5 5.5-2 6h16c-.5-.5-2-2-2-6z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Svg>
)

export const IconRepeat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9a4 4 0 0 1 4-4h9" />
    <path d="M14 2l3 3-3 3" />
    <path d="M20 15a4 4 0 0 1-4 4H7" />
    <path d="M10 22l-3-3 3-3" />
  </Svg>
)

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 8v5M12 16.5v.5" />
    <circle cx="12" cy="12" r="9" />
  </Svg>
)

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
)

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </Svg>
)

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
)

export const IconInbox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 13.5h4l1.5 3h6l1.5-3h4" />
    <path d="M5.6 5.6h12.8l2.1 7.9v3a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-3z" />
  </Svg>
)

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9h11a5 5 0 0 1 0 10h-6" />
    <path d="M8 5L4 9l4 4" />
  </Svg>
)

export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
)

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
)
