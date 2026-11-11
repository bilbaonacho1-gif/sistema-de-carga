/**
 * EXPORTAR EL PLANO: imagen (PNG), lámina para imprimir o guardar en PDF (con rótulo) y DXF para
 * AutoCAD. La imagen y la lámina salen del mismo dibujo que se ve en pantalla, encuadrado entero.
 */
import { planToDxf } from '../../shared/plan/dxf'
import { planBounds } from '../../shared/plan/geometry'
import type { RackModuleSize } from '../../shared/plan/layout'
import type { Plan, RackPlacement } from '../../shared/plan/types'
import { rackNames } from './PlanNotes'

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** Pide al editor que encuadre el plano entero y espera a que se dibuje. */
async function fitAndWait(): Promise<void> {
  window.dispatchEvent(new CustomEvent('plan-fit'))
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))))
}

/** El dibujo del plano como SVG suelto (sin depender de la página), encuadrado al depósito. */
export async function planSvg(plan: Plan): Promise<{ svg: string; w: number; h: number } | null> {
  if (!document.querySelector('.plan-editor svg')) return null
  await fitAndWait()
  const src = document.querySelector('.plan-editor svg') as SVGSVGElement | null
  if (!src) return null
  const b = planBounds(plan)
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.1 + 1500
  const vb = { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + 2 * pad, h: b.maxY - b.minY + 2 * pad }
  const clone = src.cloneNode(true) as SVGSVGElement
  // las manijas de edición no van en el plano exportado
  clone.querySelectorAll('.no-export').forEach((n) => n.remove())
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`)
  const w = 2400, h = Math.round((w * vb.h) / vb.w)
  clone.setAttribute('width', String(w)); clone.setAttribute('height', String(h))
  // fondo blanco
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('x', String(vb.x)); bg.setAttribute('y', String(vb.y)); bg.setAttribute('width', String(vb.w)); bg.setAttribute('height', String(vb.h)); bg.setAttribute('fill', '#fff')
  clone.insertBefore(bg, clone.firstChild)
  const svg = new XMLSerializer().serializeToString(clone)
    .replace(/var\(--f-mono\)/g, 'ui-monospace, Menlo, Consolas, monospace')
    .replace(/var\(--f-body\)/g, 'Arial, Helvetica, sans-serif')
    .replace(/var\(--f-display\)/g, 'Arial, Helvetica, sans-serif')
  return { svg, w, h }
}

export async function exportPng(plan: Plan): Promise<boolean> {
  const r = await planSvg(plan)
  if (!r) return false
  const img = new Image()
  const url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }))
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('svg')); img.src = url })
  const c = document.createElement('canvas')
  c.width = r.w; c.height = r.h
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(img, 0, 0)
  URL.revokeObjectURL(url)
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'))
  if (blob) download(blob, 'plano-deposito.png')
  return !!blob
}

export function exportDxf(plan: Plan, racks: RackPlacement[], size?: RackModuleSize) {
  const text = planToDxf(plan, racks, size, rackNames(racks))
  // DXF R12 en Windows-1252 (así AutoCAD muestra bien las tildes y la ñ)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); bytes[i] = c < 256 ? c : 63 }
  download(new Blob([bytes], { type: 'application/dxf' }), 'plano-deposito.dxf')
}

export interface SheetData { title: string; rows: [string, string][]; note: string }

/**
 * Lámina para imprimir o guardar como PDF: el plano grande con un rótulo (como los planos de AutoCAD).
 * Se arma en la página y se abre el diálogo de impresión; ahí se elige "Guardar como PDF".
 */
export async function printSheet(plan: Plan, data: SheetData): Promise<boolean> {
  const r = await planSvg(plan)
  if (!r) return false
  const sheet = document.createElement('div')
  sheet.id = 'print-sheet'
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  const svg = r.svg.replace(/ width="\d+" height="\d+"/, ' width="100%" height="100%" preserveAspectRatio="xMidYMid meet"')
  sheet.innerHTML = `
    <div class="ps-plan">${svg}</div>
    <div class="ps-block">
      <div class="ps-brand">SISTEMAS DE CARGA S.A.</div>
      <div class="ps-title">${esc(data.title)}</div>
      <table>${data.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      <div class="ps-note">${esc(data.note)}</div>
    </div>`
  document.body.appendChild(sheet)
  const done = () => { sheet.remove(); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  await new Promise((ok) => setTimeout(ok, 50))
  window.print()
  // por si el navegador no avisa al terminar
  setTimeout(done, 60_000)
  return true
}
