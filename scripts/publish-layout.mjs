/**
 * Ordena la carpeta dist/ para publicar (Vercel, Netlify): la dirección principal abre el
 * COTIZADOR y la app de gestión queda en /gestion.
 *   dist/cotizador.html → dist/index.html
 *   dist/index.html     → dist/gestion.html
 * Los archivos de assets/ se referencian con rutas absolutas, así que no hay que tocarlos.
 */
import { existsSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dist = (f) => fileURLToPath(new URL(`../dist/${f}`, import.meta.url))
if (!existsSync(dist('cotizador.html'))) {
  console.error('Falta dist/cotizador.html: corré antes "vite build".')
  process.exit(1)
}
renameSync(dist('index.html'), dist('gestion.html'))
renameSync(dist('cotizador.html'), dist('index.html'))
console.log('Publicación: / = cotizador · /gestion = app de gestión')
