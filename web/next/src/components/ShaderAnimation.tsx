import { memo, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import {
  Camera,
  Mesh,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'

export interface ShaderAnimationProps {
  /** Multiplicador de velocidad (1 = normal, 0 = cuadro fijo). */
  speed?: number
  /** Grosor de las líneas de luz (por defecto 0.002). */
  lineWidth?: number
  /** Separación cromática del look espectro. Se ignora si hay `tint`. */
  dispersion?: number
  /** Tinte monocromo [r,g,b] en 0–1. Sin él, espectro completo. */
  tint?: readonly [number, number, number] | null
  /** Intensidad global (por defecto 1). */
  brightness?: number
  className?: string
  style?: CSSProperties
}

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

/**
 * Fondo animado "light ripple": arcos concéntricos de luz cortados por una
 * rejilla diagonal, dibujados por un fragment shader de Three.js. Es un
 * lienzo WebGL a pantalla completa, así que debe haber una sola instancia y
 * con props constantes (cada cambio de prop recrea el renderer).
 */
export const ShaderAnimation = memo(function ShaderAnimation({
  speed = 1,
  lineWidth = 0.002,
  dispersion = 0.01,
  tint = null,
  brightness = 1,
  className,
  style,
}: ShaderAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tr, tg, tb] = tint ?? [1, 1, 1]
  const useTint = tint !== null

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const camera = new Camera()
    camera.position.z = 1

    const scene = new Scene()
    const geometry = new PlaneGeometry(2, 2)

    const uniforms = {
      time: { value: 1.0 },
      resolution: { value: new Vector2() },
      uLineWidth: { value: lineWidth },
      uDispersion: { value: dispersion },
      uTint: { value: new Vector3(tr, tg, tb) },
      uUseTint: { value: useTint ? 1.0 : 0.0 },
      uBrightness: { value: brightness },
    }

    const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader })
    scene.add(new Mesh(geometry, material))

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true })
    } catch {
      // Sin WebGL el fondo se queda negro (lo pinta el contenedor) y la app
      // funciona igual.
      geometry.dispose()
      material.dispose()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.style.display = 'block'
    container.appendChild(renderer.domElement)

    const onResize = () => {
      renderer.setSize(container.clientWidth, container.clientHeight)
      uniforms.resolution.value.x = renderer.domElement.width
      uniforms.resolution.value.y = renderer.domElement.height
      if (speed === 0) renderer.render(scene, camera)
    }
    onResize()
    window.addEventListener('resize', onResize)

    let animationId = 0
    const animate = () => {
      animationId = requestAnimationFrame(animate)
      uniforms.time.value += 0.05 * speed
      renderer.render(scene, camera)
    }
    // Con velocidad 0 basta un cuadro fijo: no tiene sentido redibujar la
    // misma imagen 60 veces por segundo.
    if (speed === 0) renderer.render(scene, camera)
    else animate()

    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(animationId)
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      renderer.dispose()
      geometry.dispose()
      material.dispose()
    }
  }, [speed, lineWidth, dispersion, tr, tg, tb, useTint, brightness])

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={className}
      style={{ background: '#000', overflow: 'hidden', ...style }}
    />
  )
})
