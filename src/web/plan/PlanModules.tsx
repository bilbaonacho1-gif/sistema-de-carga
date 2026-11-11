/**
 * Módulos del panel para el plano: Capas, Calcar un plano, Revisión y Exportar.
 */
import { AlertTriangle, CheckCircle2, FileDown, ImageDown, Info, Lightbulb, Printer, Ruler, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { PlanCheck } from '../../shared/plan/checks'
import { planBounds } from '../../shared/plan/geometry'
import type { RackModuleSize } from '../../shared/plan/layout'
import type { RackPlacement } from '../../shared/plan/types'
import { Button } from '../components/ui'
import { loadImage, useCalco } from './calco'
import { exportDxf, exportPng, printSheet, type SheetData } from './exportPlan'
import { usePlan, type PlanLayer } from './planStore'

/* ------------------------------ Capas ------------------------------ */

const LAYERS: { id: PlanLayer | 'cotas'; label: string }[] = [
  { id: 'racks', label: 'Racks' },
  { id: 'numeros', label: 'Números de fila y pasillos' },
  { id: 'cotas', label: 'Cotas del depósito' },
  { id: 'cotasPropias', label: 'Cotas propias' },
  { id: 'textos', label: 'Textos' },
  { id: 'simbolos', label: 'Símbolos' },
  { id: 'columnas', label: 'Columnas' },
  { id: 'tabiques', label: 'Tabiques' },
  { id: 'portones', label: 'Portones' },
  { id: 'zonas', label: 'Zonas libres' },
  { id: 'areas', label: 'Zonas de racks' },
  { id: 'pasillos', label: 'Pasillos marcados' },
  { id: 'grilla', label: 'Grilla de 1 m' },
  { id: 'calco', label: 'Plano de fondo' },
]

/** Prender y apagar lo que se ve en el plano (como las capas de AutoCAD). No borra nada. */
export function LayersPanel() {
  const { hidden, toggleLayer, showCotas, setShowCotas } = usePlan()
  return (
    <div className="layers">
      <p className="muted small">Apagá lo que no quieras ver. No se borra nada: también sale así al exportar.</p>
      {LAYERS.map((l) => {
        const on = l.id === 'cotas' ? showCotas : !hidden[l.id]
        return (
          <label key={l.id} className="layers__row">
            <input type="checkbox" checked={on} onChange={() => (l.id === 'cotas' ? setShowCotas(!showCotas) : toggleLayer(l.id as PlanLayer))} />
            <span>{l.label}</span>
          </label>
        )
      })}
    </div>
  )
}

/* ------------------------------ Calcar un plano ------------------------------ */

/** Subir la imagen del plano del cliente, ponerla a escala y dibujar encima. */
export function CalcoPanel() {
  const { calco, set, patch } = useCalco()
  const { plan, setTool } = usePlan()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const pick = async (f: File | undefined) => {
    if (!f) return
    setError('')
    try {
      const { src, ratio } = await loadImage(f)
      // arranca del ancho del depósito (o 50 m si todavía no hay), arriba a la izquierda
      const has = plan.outline.points.length >= 3
      const b = has ? planBounds(plan) : { minX: 0, minY: 0, maxX: 50_000, maxY: 30_000 }
      const w = b.maxX - b.minX
      set({ src, x: b.minX, y: b.minY, w, h: w * ratio, opacity: 0.5, moving: false })
    } catch (e) { setError((e as Error).message) }
  }
  return (
    <div className="calco">
      <p className="muted small">Subí una foto o imagen del plano (JPG o PNG; si es PDF, sacale una captura). Queda de fondo y dibujás el contorno encima.</p>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
      <Button size="sm" icon={Upload} onClick={() => input.current?.click()} block>{calco ? 'Cambiar la imagen' : 'Subir imagen del plano'}</Button>
      {error && <p className="note note--amber">{error}</p>}
      {calco && <>
        <Button size="sm" icon={Ruler} onClick={() => setTool('calibrate')} block>Poner a escala (marcar una medida conocida)</Button>
        <label className="calco__row">Transparencia
          <input type="range" min={0.1} max={1} step={0.05} value={calco.opacity} onChange={(e) => patch({ opacity: Number(e.target.value) })} />
        </label>
        <label className="layers__row"><input type="checkbox" checked={calco.moving} onChange={(e) => { patch({ moving: e.target.checked }); setTool('select') }} /> <span>Mover la imagen (arrastrándola)</span></label>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => set(null)}>Quitar la imagen</Button>
      </>}
    </div>
  )
}

/* ------------------------------ Revisión ------------------------------ */

const ICON = { error: AlertTriangle, aviso: Info, consejo: Lightbulb }

/** Lo que conviene revisar del plano (como el control de un proyectista). Tocar un punto lo muestra. */
export function ChecksPanel({ checks }: { checks: PlanCheck[] }) {
  const select = usePlan((s) => s.select)
  if (!checks.length) return <p className="checks__ok"><CheckCircle2 size={16} aria-hidden /> Todo en orden.</p>
  return (
    <ul className="checks">
      {checks.map((c, i) => {
        const Icon = ICON[c.level]
        return (
          <li key={i} className={`checks__i checks__i--${c.level}`}>
            <Icon size={15} aria-hidden />
            {c.target ? <button type="button" onClick={() => select(c.target!)}>{c.text}</button> : <span>{c.text}</span>}
          </li>
        )
      })}
    </ul>
  )
}

/* ------------------------------ Exportar ------------------------------ */

/** Lámina para PDF, imagen y DXF para AutoCAD. */
export function ExportPanel({ racks, size, sheet }: { racks: RackPlacement[]; size?: RackModuleSize; sheet: SheetData }) {
  const { plan, view3d, setView3d, select } = usePlan()
  const [busy, setBusy] = useState('')
  const empty = plan.outline.points.length < 3
  // la imagen y la lámina salen del plano: si está el 3D, se pasa al plano
  const run = async (what: string, fn: () => Promise<unknown> | unknown) => {
    setBusy(what)
    select(null)
    if (view3d) { setView3d(false); await new Promise((r) => setTimeout(r, 300)) }
    try { await fn() } finally { setBusy('') }
  }
  return (
    <div className="export">
      <Button size="sm" icon={Printer} disabled={empty || !!busy} onClick={() => run('pdf', () => printSheet(plan, sheet))} block>
        {busy === 'pdf' ? 'Preparando…' : 'Lámina para PDF / imprimir'}
      </Button>
      <Button size="sm" icon={ImageDown} disabled={empty || !!busy} onClick={() => run('png', () => exportPng(plan))} block>
        {busy === 'png' ? 'Preparando…' : 'Imagen del plano (PNG)'}
      </Button>
      <Button size="sm" icon={FileDown} disabled={empty || !!busy} onClick={() => run('dxf', () => exportDxf(plan, racks, size))} block>
        Archivo para AutoCAD (DXF)
      </Button>
      <p className="muted small">La lámina abre el cuadro de impresión: elegí "Guardar como PDF". El DXF se abre en AutoCAD con una capa por cosa (racks, columnas, cotas…).</p>
    </div>
  )
}
