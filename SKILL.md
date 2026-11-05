---
name: light-ripple
description: >-
  Generate a beautiful animated full-screen WebGL shader background (glowing
  concentric arcs / light rays sliced by a diagonal grid) using a Three.js
  fragment shader. Use this skill whenever the user asks to make, add, build, or
  create a "light ripple", "light ripple background", "ripple background",
  "shader animation", "animated shader background", "three.js shader
  background", "GLSL background", "glowing rays / arcs background", "animated
  hero background", or any flowing, glowing, prism / light-ray / ripple animated backdrop
  for a website, landing page, or app — even if they don't say "shader" exactly.
  Targets shadcn + Next.js + TypeScript projects. Prefer this skill over a static
  CSS gradient when the user wants an animated/glowing hero background.
---

# Light Ripple Shader Background

Generate a polished, animated full-screen background from a Three.js fragment
shader — glowing concentric arcs of light, dispersed into color and sliced by a
diagonal grid pattern. The whole effect is the GLSL shader, so it looks identical
to the source every time. This file is self-contained: component, presets, setup,
and license are all below.

The only dependency is **`three`** (Three.js), which is **MIT-licensed** — free
for any use, including commercial; just keep its license file in `node_modules`
(npm does this automatically). Install it as a normal dependency; never vendor a
modified copy under your own license.

## Step 1 — Ask a few quick questions

Keep it light: **three questions, then build.** Skip any the user already
answered in their request.

1. **Which look?** Offer the presets by name + vibe (see the table), or "custom
   color" — if custom, ask for one accent color (hex), which becomes a tint.
2. **How fast?** `calm` (slow drift), `balanced` (default), or `fast` (energetic).
3. **Where does it go, and what's on top?** Full-screen hero vs. a section
   backdrop; and the headline / overlay text (or use a placeholder).

If the user says "just pick something," default to **Spectrum, balanced,
full-screen hero** with placeholder text and proceed — don't stall.

## Step 2 — Check the project setup

This skill targets **shadcn + Tailwind CSS + TypeScript**. Confirm those exist
before writing files; if not, use the commands in the Setup section below. If
there's no project and the user just wants to *see* the shader, use the no-build
HTML preview in the Setup section.

Put the component at **`components/ui/shader-animation.tsx`** — shadcn projects
keep reusable UI primitives in `components/ui`, and the `@/components/ui/...`
alias points there, so imports just work. If the project uses a different
components path, use that instead.

## Step 3 — Pick a preset

Each preset is just a set of props for the component below. Two color styles
exist: **Spectrum** uses `dispersion` (RGB channels offset → natural blue/white/
amber rainbow); the **tinted** presets pass a `tint` `[r,g,b]` (0–1) for a
monochrome glow. The background is near-black, so **white overlay text always
reads well.**

| Preset       | Props |
|--------------|-------|
| **Spectrum** (default) | `dispersion={0.01}` (no tint) — the original blue/white/amber. |
| **Wide Spectrum** | `dispersion={0.02}` — bolder rainbow separation. |
| **Ice** (cyan)    | `tint={[0.3, 0.8, 1.0]}` `brightness={1.1}` |
| **Solar** (gold)  | `tint={[1.0, 0.7, 0.25]}` |
| **Plasma** (magenta) | `tint={[1.0, 0.3, 0.9]}` |
| **Matrix** (green) | `tint={[0.35, 1.0, 0.45]}` |
| **Noir** (silver) | `tint={[0.85, 0.88, 1.0]}` `brightness={0.95}` — subtle/minimal. |

**Custom color:** convert the user's accent hex to `[r,g,b]` in 0–1 and pass it
as `tint`. Example: `#ff4da6` → `tint={[1.0, 0.30, 0.65]}`.

## Step 4 — Apply the speed dial

Pass `speed` based on the chosen energy:

| Energy     | `speed` |
|------------|---------|
| `calm`     | 0.5     |
| `balanced` | 1       |
| `fast`     | 1.8     |

For a *denser/bolder* look, raise `lineWidth` (e.g. `0.003`); for finer lines,
lower it (e.g. `0.0015`). `brightness` scales overall intensity.

## Step 5 — Generate the component

Write this to `components/ui/shader-animation.tsx`. It's a parameterized version
of the original shader — same visual, with props wired to uniforms.

```tsx
// components/ui/shader-animation.tsx
"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"

export type ShaderAnimationProps = {
  /** Animation speed multiplier (1 = default). */
  speed?: number
  /** Glow line thickness (default 0.002). */
  lineWidth?: number
  /** Chromatic separation for the full-spectrum look. Ignored when `tint` is set. */
  dispersion?: number
  /** Monochrome tint as [r,g,b] in 0–1. Omit for the full-spectrum default. */
  tint?: [number, number, number] | null
  /** Overall brightness multiplier (default 1). */
  brightness?: number
  className?: string
  style?: React.CSSProperties
}

export function ShaderAnimation({
  speed = 1,
  lineWidth = 0.002,
  dispersion = 0.01,
  tint = null,
  brightness = 1,
  className = "w-full h-screen",
  style,
}: ShaderAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const vertexShader = `
      void main() { gl_Position = vec4(position, 1.0); }
    `

    const fragmentShader = `
      precision highp float;
      uniform vec2 resolution;
      uniform float time;
      uniform float uLineWidth;
      uniform float uDispersion;
      uniform vec3 uTint;
      uniform float uUseTint;
      uniform float uBrightness;

      void main(void) {
        vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
        float t = time * 0.05;
        vec3 color = vec3(0.0);
        for (int j = 0; j < 3; j++) {
          for (int i = 0; i < 5; i++) {
            color[j] += uLineWidth * float(i * i) /
              abs(fract(t - uDispersion * float(j) + float(i) * 0.01) * 5.0
                  - length(uv) + mod(uv.x + uv.y, 0.2));
          }
        }
        float mono = (color.r + color.g + color.b) / 3.0;
        vec3 finalColor = mix(color, mono * uTint, uUseTint);
        gl_FragColor = vec4(finalColor * uBrightness, 1.0);
      }
    `

    const camera = new THREE.Camera()
    camera.position.z = 1

    const scene = new THREE.Scene()
    const geometry = new THREE.PlaneGeometry(2, 2)

    const uniforms = {
      time: { value: 1.0 },
      resolution: { value: new THREE.Vector2() },
      uLineWidth: { value: lineWidth },
      uDispersion: { value: dispersion },
      uTint: { value: new THREE.Vector3(...(tint ?? [1, 1, 1])) },
      uUseTint: { value: tint ? 1.0 : 0.0 },
      uBrightness: { value: brightness },
    }

    const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(renderer.domElement)

    const onResize = () => {
      renderer.setSize(container.clientWidth, container.clientHeight)
      uniforms.resolution.value.x = renderer.domElement.width
      uniforms.resolution.value.y = renderer.domElement.height
    }
    onResize()
    window.addEventListener("resize", onResize)

    let animationId = 0
    const animate = () => {
      animationId = requestAnimationFrame(animate)
      uniforms.time.value += 0.05 * speed
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(animationId)
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      renderer.dispose()
      geometry.dispose()
      material.dispose()
    }
  }, [speed, lineWidth, dispersion, tint, brightness])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ background: "#000", overflow: "hidden", ...style }}
    />
  )
}
```

## Step 6 — Generate the hero/section

The shader is its own dark canvas, so overlay text with `position: absolute` and
`z-10`. White text reads cleanly. Substitute the preset props and the user's
copy; adapt the layout rather than shipping it byte-for-byte.

```tsx
// app/(marketing)/page.tsx — or wherever the hero belongs
import { ShaderAnimation } from "@/components/ui/shader-animation"

export default function Hero() {
  return (
    <div className="relative h-screen w-full overflow-hidden bg-black">
      <ShaderAnimation /* ...preset + speed props... */ />
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 px-8 text-center pointer-events-none">
        <h1 className="text-white text-6xl md:text-8xl font-semibold tracking-tighter">
          {/* user's headline */}
        </h1>
        <p className="max-w-2xl text-white/80 text-lg md:text-xl">
          {/* optional subtext */}
        </p>
      </div>
    </div>
  )
}
```

If buttons are needed, give them `pointer-events-auto` (the overlay wrapper sets
`pointer-events-none` so the page behind stays interactive where there's no UI).

## Step 7 — Install & notes

```bash
npm install three
# or: pnpm add three  /  yarn add three
```

- The component renders WebGL on the client, so it needs the `"use client"`
  directive (already included) for the Next.js App Router.
- `three` is MIT-licensed — no attribution obligation beyond keeping its license
  file (npm handles that). Clean for commercial use.
- TypeScript: types ship with `three`. If your setup complains, `npm i -D @types/three`.

## Prop reference

| Prop | Default | Notes |
|------|---------|-------|
| `speed` | `1` | Animation speed multiplier. `0` freezes it. |
| `lineWidth` | `0.002` | Glow line thickness; higher = bolder/brighter. |
| `dispersion` | `0.01` | RGB channel offset (spectrum look). Ignored if `tint` set. |
| `tint` | `null` | `[r,g,b]` 0–1 for a monochrome glow; `null` = full spectrum. |
| `brightness` | `1` | Overall intensity multiplier. |
| `className` | `"w-full h-screen"` | Sizing for the canvas container. |

**Performance:** it's a real-time fragment shader filling the screen — one
instance per page is ideal. To respect `prefers-reduced-motion`, set `speed={0}`
(renders a still frame). On low-end devices you can cap the pixel ratio by
replacing `window.devicePixelRatio` with `Math.min(window.devicePixelRatio, 2)`.

## Setup details (if the project is missing pieces)

```bash
# No project yet (Next.js + TS + Tailwind):
npx create-next-app@latest my-app --typescript --tailwind --app && cd my-app
# Add shadcn (gives components/ui + the @/ alias):
npx shadcn@latest init
```

**No-build preview (no project required):** to just *see* the look, render the
shader in a single static HTML file via an ESM CDN + import map — map `"three"`
to `https://esm.sh/three`, create the camera/scene/`PlaneGeometry(2,2)`/
`ShaderMaterial` with the fragment shader above, size to the window, and run the
`requestAnimationFrame` loop incrementing `time`. Open the file in a browser.
Preview only; the real integration is the component file above.

## Preset quick-reference

| Preset | Vibe |
|--------|------|
| Spectrum | blue/white/amber rainbow (default) |
| Wide Spectrum | bolder rainbow separation |
| Ice | cool cyan glow |
| Solar | warm gold glow |
| Plasma | vivid magenta |
| Matrix | electric green |
| Noir | subtle silver/white, minimal |
