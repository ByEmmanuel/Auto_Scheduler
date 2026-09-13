import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// La app es la página principal: Flask sirve este index.html en `/`. Aun así
// el build sale en ../static/next con base '/next/' (sus assets se piden bajo
// /next/assets): compilar a ../static con emptyOutDir vaciaría la carpeta y se
// llevaría el dashboard anterior, que sigue en /clasico.
export default defineConfig({
  base: '/next/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../static/next',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // En desarrollo el front corre en :5173 y habla con el Flask de :5050.
    proxy: {
      '/api': 'http://localhost:5050',
    },
  },
})
