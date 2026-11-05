import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ShaderAnimation } from './components/ShaderAnimation'
import './index.css'

// Preset "Spectrum" a velocidad balanced; con movimiento reducido, cuadro fijo.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Fuera de <App/> a propósito: así los re-renders del tablero (arrastrar,
        escribir, sincronizar) nunca tocan el lienzo WebGL. */}
    <ShaderAnimation
      speed={reducedMotion ? 0 : 1}
      dispersion={0.01}
      className="pointer-events-none fixed inset-0 z-0"
    />
    <div className="relative z-10">
      <App />
    </div>
  </StrictMode>,
)
