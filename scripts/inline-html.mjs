/**
 * Arma UN solo archivo .html con todo adentro (JS, CSS, logo y, en la app de gestión, la
 * base SQLite en WebAssembly). Se abre con doble clic, sin servidor.
 *
 * Uso: node scripts/inline-html.mjs <carpeta compilada> <html de entrada> <archivo de salida>
 *   npm run build:html       → ../sistemas-de-carga-gestion.html  (app de gestión)
 *   npm run build:cotizador  → ../cotizador-3d.html               (sólo el cotizador)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const [distDir = 'dist-single', entry = 'index.html', output = '../sistemas-de-carga-gestion.html'] = process.argv.slice(2)
const root = new URL('../', import.meta.url)
const dist = new URL(`${distDir}/`, root)
const out = fileURLToPath(new URL(output, root))
const read = (path) => readFileSync(new URL(path.replace(/^\//, ''), dist), 'utf8')

let html = read(entry)

// <script type="module" src="/assets/x.js"> → script en línea
// ("</script" dentro del código cortaría la etiqueta: se escribe "<\/script", que en JS es lo mismo)
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) =>
  `<script type="module">${read(src).replace(/<\/script/gi, '<\\/script')}</script>`)

// <link rel="stylesheet" href="/assets/x.css"> → estilos en línea
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) =>
  `<style>${read(href)}</style>`)

// imágenes (logo y favicon) → data: URI, tanto en el HTML como dentro del código
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp' }
html = html.replace(/\/assets\/[\w.-]+\.(png|jpe?g|svg|webp)/g, (path, ext) =>
  `data:${MIME[ext]};base64,${readFileSync(new URL(path.slice(1), dist)).toString('base64')}`)

// lo único que puede quedar afuera son las tipografías de Google (sin internet usa las del sistema)
const leftovers = [...html.matchAll(/(?:src|href)="(\/[^"]*)"|["'(](\/assets\/[^"')]+)/g)].map((m) => m[1] ?? m[2])
if (leftovers.length) {
  console.error('Quedaron referencias a archivos locales:', leftovers)
  process.exit(1)
}

writeFileSync(out, html)
console.log(`Listo: ${out} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`)
