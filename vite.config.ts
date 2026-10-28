import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Modos de compilación:
 *  - (por defecto: npm run dev / npm run build) "local": el servidor corre dentro del navegador
 *    con SQLite en WebAssembly. `npm run build` deja en dist/ una versión que se puede publicar
 *    en cualquier hosting estático (Vercel, Netlify): cada visitante tiene sus datos en su navegador.
 *  - "server" (npm run build:server / npm run server): la interfaz habla por HTTP con el servidor
 *    Node, así varios dispositivos (PC, celulares) comparten la misma base. Va a dist-server/.
 *  - "single" (npm run build:html): como "local", pero todo en un único archivo .html.
 *  - "cotizador" (npm run build:cotizador): SÓLO el cotizador 3D (cotizador.html), sin login,
 *    pedidos ni almacén, en un único archivo .html. En desarrollo: http://localhost:5174/cotizador.html
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __API_MODE__: JSON.stringify(mode === 'server' ? 'http' : 'local'),
  },
  server: {
    port: 5174,
    // la carpeta está en OneDrive: se revisan los cambios por sondeo
    watch: { usePolling: true, interval: 250 },
    proxy: { '/api': 'http://localhost:8787' },
  },
  // la vista previa de la compilación para servidor también le pasa /api al servidor Node
  preview: { proxy: { '/api': 'http://localhost:8787' } },
  build: {
    chunkSizeWarningLimit: 4000,
    // la compilación para publicar (Vercel, Netlify) lleva las dos páginas: la app y el cotizador suelto
    ...((mode === 'production' || mode === 'development') && { rolldownOptions: { input: { app: 'index.html', cotizador: 'cotizador.html' } } }),
    ...(mode === 'server' && { outDir: 'dist-server' }),
    ...(mode === 'single' && {
      outDir: 'dist-single',
      assetsInlineLimit: 100_000_000,
      // las pantallas que se cargan aparte (almacén, diseñador) y la base quedan en el mismo archivo
      rolldownOptions: { output: { codeSplitting: false } },
    }),
    ...(mode === 'cotizador' && {
      outDir: 'dist-cotizador',
      assetsInlineLimit: 100_000_000,
      rolldownOptions: { input: 'cotizador.html', output: { codeSplitting: false } },
    }),
  },
}))
