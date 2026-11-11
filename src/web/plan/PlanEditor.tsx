/**
 * EDITOR DEL PLANO (vista de arriba, SVG en milímetros).
 *  - Seleccionar: arrastrar puntos, columnas, zonas, tabiques y portones. Tocando una pared
 *    aparece su manija del medio: arrastrándola la pared se curva. Doble clic agrega un punto.
 *  - Plano vacío: se crea escribiendo largo × ancho, o se dibuja a mano.
 *  - Contorno: clic punto por punto; se cierra tocando el primero (o Enter). Después del primer punto se
 *    puede escribir el largo de cada pared y Enter: va hacia donde apunta el mouse (como en AutoCAD).
 *  - Tabique: clic en cada extremo (encadena el siguiente; Esc termina).
 *  - Columna / Portón / Zona: clic donde va.
 *  - Zona de racks / Pasillo: arrastrar de punta a punta (un clic solo pone una de medida estándar).
 *  - Racks (si están a la vista): se arrastran igual; Supr los borra.
 * Rueda o pellizco: zoom. Arrastrar el fondo: mover. Ctrl+Z / Ctrl+Y: deshacer / rehacer.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { drawnRect, itemsOutside, setEdgeLength, setTotal, moveVertex, newId, pointAtLength, removeItem, removeVertex, sagFromPoint, setOutline, splitEdge, updateRect } from '../../shared/plan/edit'
import { rectanglePlan } from '../../shared/plan/geometry'
import { metrosNum, parseMetros } from '../../shared/units'
import './plan-extra.css'
import { apex, arcOf, edgeLength, edges, nearestOnEdge, planBounds, pointOnEdge, tangentOnEdge, type Edge } from '../../shared/plan/geometry'
import type { Plan, PlanPoint, PlanSelection } from '../../shared/plan/types'
import type { RackModuleSize, RackPlacement } from '../../shared/plan/layout'
import { freezeRacks, moveRack, moveRackWithin, moveRacksBy, rackSelection, racksInBox, removeRacks, selectedRackIds } from '../../shared/plan/racks'
import { PlanCotas } from './PlanCotas'
import { Legend, PlanRackNotes, ScaleBar } from './PlanNotes'
import { PlanAnnotations } from './PlanAnnotations'
import { scaleCalco, useCalco } from './calco'
import { nearestSnap, snapPoints, type SnapPoint } from '../../shared/plan/snap'
import { copySelection, moveSelection, pasteClip, type Clip } from '../../shared/plan/clipboard'
import { clearances, snapRack, type Guide } from '../../shared/plan/guides'
import { resizeRect, type Side } from '../../shared/plan/transform'
import { ObjectBar, patchRect, type RectKind } from './ObjectBar'
import { fitPlacement } from '../../shared/plan/racks'
import { outlinePolygon } from '../../shared/plan/geometry'
import { placementRect } from '../../shared/plan/layout'
import { PlanRacks } from './PlanRacks'
import { usePlan } from './planStore'

type VB = { x: number; y: number; w: number; h: number }
type Drag =
  | { type: 'pan'; cx: number; cy: number; vb: VB; moved: boolean }
  | { type: 'racks'; ids: string[]; start: PlanPoint; done: PlanPoint; started: boolean; clicked: string }
  | { type: 'box'; a: PlanPoint }
  | { type: 'anno'; kind: 'text' | 'symbol' | 'dim'; id: string; start: PlanPoint; started: boolean }
  | { type: 'calco'; start: PlanPoint; x: number; y: number }
  | { type: 'rackdraw'; a: PlanPoint }
  | { type: 'rside'; kind: RectKind; id: string; sides: Side[]; started: boolean }
  | { type: 'vertex'; index: number; started: boolean }
  | { type: 'sag'; index: number; started: boolean }
  | { type: 'column' | 'zone'; id: string; dx: number; dy: number; started: boolean }
  | { type: 'wall'; id: string; dx: number; dy: number; started: boolean }
  | { type: 'wall-end'; id: string; end: 'a' | 'b'; started: boolean }
  | { type: 'door'; id: string; started: boolean }
  | { type: 'rack'; id: string; dx: number; dy: number; started: boolean }
  | { type: 'area' | 'aisle'; id: string; dx: number; dy: number; started: boolean }
  | { type: 'resize'; kind: 'area' | 'aisle'; id: string; started: boolean }
  | { type: 'draw'; kind: 'area' | 'aisle'; a: PlanPoint }

const RED = '#be1e30'
/** Lo copiado con Ctrl+C (queda mientras la página está abierta). */
let clipboard: Clip | null = null
let pasteCount = 0
const BLUE = '#2f6fb8'
const meters = (mm: number) => `${(Math.round(mm / 10) / 100 + 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} m`

/** Recorrido SVG de una pared (recta o arco). */
function edgeD(e: Edge, move = true): string {
  const arc = arcOf(e)
  const start = move ? `M ${e.a.x} ${e.a.y} ` : ''
  if (!arc) return `${start}L ${e.b.x} ${e.b.y}`
  return `${start}A ${arc.radius} ${arc.radius} 0 ${Math.abs(arc.sweep) > Math.PI ? 1 : 0} ${arc.sweep > 0 ? 1 : 0} ${e.b.x} ${e.b.y}`
}

export function outlineD(plan: Plan): string {
  const es = edges(plan.outline)
  if (!es.length) return ''
  return `M ${es[0].a.x} ${es[0].a.y} ${es.map((e) => edgeD(e, false)).join(' ')} Z`
}

function fitView(plan: Plan, aspect: number): VB {
  // plano vacío: una vista de unos 50 × 30 m para empezar a dibujar
  const b = plan.outline.points.length < 3 ? { minX: 0, minY: 0, maxX: 50_000, maxY: 30_000 } : planBounds(plan)
  // margen para las cotas, que van por afuera del depósito
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.2 + 1500
  let w = b.maxX - b.minX + pad * 2
  let h = b.maxY - b.minY + pad * 2
  if (w / h > aspect) h = w / aspect
  else w = h * aspect
  return { x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minY + b.maxY) / 2 - h / 2, w, h }
}

/** Racks a dibujar sobre el plano (de la distribución automática o ubicados a mano). */
export interface PlanRackLayer { racks: RackPlacement[]; size: RackModuleSize; issues?: Record<string, string> }

export function PlanEditor({ fitRequest, rackLayer }: { fitRequest: number; rackLayer?: PlanRackLayer }) {
  const { plan, tool, selection, draft, snap, snapStep, showCotas, commit, begin, live, select, setDraft, setTool } = usePlan()
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [vb, setVb] = useState<VB>(() => fitView(plan, 4 / 3))
  const [cursor, setCursor] = useState<PlanPoint | null>(null)
  const cursorRef = useRef<PlanPoint | null>(null)
  /** Largo escrito con el teclado mientras se dibuja una pared (texto en metros). */
  const [typed, setTypedState] = useState('')
  const typedRef = useRef('')
  const setTyped = (t: string) => { typedRef.current = t; setTypedState(t) }
  /** Zona de racks o pasillo que se está dibujando (de a hasta b). */
  /** Medida que se está escribiendo sobre el plano (tocando una cota). */
  const [inline, setInline] = useState<{ edit: { kind: 'edge'; index: number } | { kind: 'total'; axis: 'x' | 'y' }; at: PlanPoint; text: string } | null>(null)
  const inlineCancel = useRef(false)
  /** Medir: de a hasta b (b fijo después del segundo clic). */
  const [measure, setMeasure] = useState<{ a: PlanPoint; b?: PlanPoint } | null>(null)
  /** Cota que se está poniendo (primer punto) o calibración del calco. */
  const [twoPoint, setTwoPoint] = useState<PlanPoint | null>(null)
  /** Texto nuevo que se está escribiendo sobre el plano. */
  const [textInput, setTextInput] = useState<{ at: PlanPoint; text: string } | null>(null)
  const textCancel = useRef(false)
  /** Calibrar el calco: los dos puntos marcados y la medida real que se escribe. */
  const [calib, setCalib] = useState<{ a: PlanPoint; b: PlanPoint; text: string } | null>(null)
  /** Punto de imán bajo el cursor (se marca con un cuadradito). */
  const [hoverSnap, setHoverSnap] = useState<SnapPoint | null>(null)
  /** Guías de alineación y pasillo mientras se mueve o se dibuja un rack. */
  const [guides, setGuides] = useState<Guide[]>([])
  /** Fila de racks que se está dibujando (de a hasta b). */
  const [rackDraft, setRackDraft] = useState<{ a: PlanPoint; b: PlanPoint } | null>(null)
  const rackDrawPair = usePlan((st) => st.rackDrawPair)
  const { osnap, hidden, symbolKind, focusRack } = usePlan()
  const calco = useCalco((st) => st.calco)
  // al cambiar de herramienta se descarta lo que estaba a medio hacer
  useEffect(() => { setMeasure(null); setTwoPoint(null); setCalib(null); setHoverSnap(null) }, [tool])
  /** Recuadro para elegir varios racks (Shift + arrastrar). */
  const [boxDraft, setBoxDraft] = useState<{ a: PlanPoint; b: PlanPoint } | null>(null)
  const selectedSet = useMemo(() => new Set(selectedRackIds(selection)), [selection])
  const [rectDraft, setRectDraft] = useState<{ kind: 'area' | 'aisle'; a: PlanPoint; b: PlanPoint } | null>(null)
  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; vb: VB; mid: PlanPoint } | null>(null)
  // los racks a la vista, para copiarlos al plano en la primera edición a mano
  const layerRef = useRef(rackLayer)
  layerRef.current = rackLayer
  const scale = vb.w / Math.max(1, size.w)   // mm por pixel
  const px = (n: number) => n * scale

  /* ---- tamaño del área y encuadre ---- */
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let first = true
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width < 10 || height < 10) return
      setSize({ w: width, h: height })
      // la primera vez se encuadra el plano completo con la forma real del área
      if (first) { first = false; setVb(fitView(usePlan.getState().plan, width / height)) }
      else setVb((v) => ({ ...v, h: v.w * (height / width) }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  /** Botones + y −: acercan o alejan desde el centro de la vista. */
  const zoomBy = (k: number) => setVb((v) => {
    const w = Math.min(600_000, Math.max(1500, v.w * k))
    const f = w / v.w
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2
    return { x: cx - (v.w * f) / 2, y: cy - (v.h * f) / 2, w, h: v.h * f }
  })
  const fit = useCallback(() => setVb(fitView(usePlan.getState().plan, size.w / size.h)), [size.w, size.h])
  useEffect(() => { fit() }, [fitRequest]) // eslint-disable-line react-hooks/exhaustive-deps -- encuadra al pedirlo
  // al exportar se pide encuadrar el plano entero
  useEffect(() => {
    const on = () => fit()
    window.addEventListener('plan-fit', on)
    return () => window.removeEventListener('plan-fit', on)
  }, [fit])

  /* ---- coordenadas ---- */
  const toPlan = (clientX: number, clientY: number): PlanPoint => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = clientX; pt.y = clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }
  const sn = (v: number, free = false) => (snap && !free ? Math.round(v / snapStep) * snapStep : Math.round(v))
  const snapPt = (p: PlanPoint, free = false): PlanPoint => ({ x: sn(p.x, free), y: sn(p.y, free) })
  /** Puntos de imán a objetos (esquinas, puntas, medios, centros). */
  // sólo hacen falta mientras se dibuja, mide o acota (así arrastrar racks en depósitos grandes no se traba)
  const snapPts = useMemo(() => (osnap && tool !== 'select' ? snapPoints(plan, rackLayer?.racks) : []), [osnap, tool, plan, rackLayer?.racks])
  /** El punto del clic: pegado a un objeto cercano si hay imán a objetos, si no, a la grilla. */
  const objSnap = (raw: PlanPoint, free = false): SnapPoint | null => (osnap && !free ? nearestSnap(snapPts, raw, px(12)) : null)
  const smartPt = (raw: PlanPoint, free = false): PlanPoint => {
    const o = objSnap(raw, free)
    return o ? { x: Math.round(o.x), y: Math.round(o.y) } : snapPt(raw, free)
  }
  /**
   * La fila de racks que sale de arrastrar de a hasta b: a lo largo del lado más largo, con todos los
   * módulos que entran en ese largo (al menos uno), simple o doble. Se alinea con las otras filas.
   */
  const rackFromDrag = (a: PlanPoint, b: PlanPoint) => {
    const layer = layerRef.current
    if (!layer) return null
    const sz = layer.size
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
    const L = Math.abs(horizontal ? b.x - a.x : b.y - a.y)
    const modules = Math.max(1, Math.floor((L - sz.upright) / (sz.width + sz.upright)))
    const base = fitPlacement({ id: 'nuevo', x: 0, y: 0, orientation: horizontal ? 'x' : 'y', modules, length: 0, depth: 0, pair: rackDrawPair }, sz)
    const x0 = horizontal ? Math.min(a.x, b.x) : a.x, y0 = horizontal ? a.y : Math.min(a.y, b.y)
    const box = placementRect({ ...base, x: x0, y: y0 })
    const others = layer.racks.map(placementRect)
    const g = snapRack(box, others, usePlan.getState().layout.aisle, px(10))
    return { rack: { ...base, x: g.x, y: g.y }, guides: g.guides }
  }
  /** Mientras se dibuja: a 90° del punto anterior si está casi alineado. */
  const ortho = (p: PlanPoint, prev?: PlanPoint): PlanPoint => {
    if (!prev || !snap) return p
    const dx = p.x - prev.x, dy = p.y - prev.y
    if (Math.abs(dy) < Math.abs(dx) * 0.08) return { x: p.x, y: prev.y }
    if (Math.abs(dx) < Math.abs(dy) * 0.08) return { x: prev.x, y: p.y }
    return p
  }

  /* ---- zoom con la rueda (tiene que ser no pasivo para frenar el scroll de la página) ---- */
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = toPlan(e.clientX, e.clientY)
      const k = Math.exp(e.deltaY * 0.0015)
      setVb((v) => {
        const w = Math.min(600_000, Math.max(1500, v.w * k))
        const f = w / v.w
        return { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w, h: v.h * f }
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  /* ---- teclado ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      const s = usePlan.getState()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return }
      // dibujando: los números son el largo de la pared; Enter la pone
      const drawing = (s.tool === 'outline' || s.tool === 'wall') && s.draft.length > 0
      if (drawing && !e.ctrlKey && !e.metaKey && /^[\d.,]$/.test(e.key)) { e.preventDefault(); setTyped(typedRef.current + e.key); return }
      if (drawing && e.key === 'Backspace' && typedRef.current) { e.preventDefault(); setTyped(typedRef.current.slice(0, -1)); return }
      if (drawing && e.key === 'Enter' && typedRef.current) { e.preventDefault(); placeTyped(); return }
      if (e.key === 'Escape') {
        setTyped(''); setMeasure(null); setTwoPoint(null); setCalib(null)
        if (s.draft.length) s.setDraft([]); else if (s.tool === 'calibrate' || s.tool === 'measure' || s.tool === 'dim' || s.tool === 'rackdraw') s.setTool('select'); else s.select(null)
        return
      }
      // copiar, pegar, duplicar
      const racks = layerRef.current?.racks ?? []
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'c' && s.selection) { const c = copySelection(s.plan, s.selection, racks); if (c) { clipboard = c; pasteCount = 0; e.preventDefault() } return }
      if (mod && (e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'd')) {
        if (e.key.toLowerCase() === 'd') { if (!s.selection) return; clipboard = copySelection(s.plan, s.selection, racks); pasteCount = 0 }
        if (!clipboard) return
        e.preventDefault()
        pasteCount++
        const off = 1000 * pasteCount
        let sel: PlanSelection = null
        s.commit((p) => { const r = pasteClip(p, clipboard!, off, off, racks); sel = r.selection; return r.plan })
        s.select(sel)
        return
      }
      // flechas: mover lo seleccionado (de a un paso del imán; con Shift, diez)
      if (s.selection && s.selection.kind !== 'edge' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        const step = (s.snap ? s.snapStep : 100) * (e.shiftKey ? 10 : 1)
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const sel = s.selection
        s.commit((p) => moveSelection(p, sel, dx, dy, racks))
        return
      }
      if (e.key === 'Enter' && s.tool === 'outline' && s.draft.length >= 3) { closeOutline(s.draft); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = s.selection
        if (!sel) return
        e.preventDefault()
        if (sel.kind === 'vertex') s.commit((p) => removeVertex(p, sel.index))
        else if (sel.kind === 'rack' || sel.kind === 'racks') s.commit((p) => removeRacks(freezeRacks(p, layerRef.current?.racks ?? []), selectedRackIds(sel)))
        else if (sel.kind !== 'edge') s.commit((p) => removeItem(p, sel.kind, sel.id))
        s.select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- lee el estado al momento

  /** Pone el punto siguiente a la distancia escrita. */
  const placeTyped = () => {
    const L = parseMetros(typedRef.current)
    setTyped('')
    const s = usePlan.getState()
    const last = s.draft[s.draft.length - 1]
    if (!last || !(L >= 50)) return
    const p = pointAtLength(last, cursorRef.current, s.draft[s.draft.length - 2], L, s.snap)
    // si el punto nuevo queda fuera de la vista, se aleja para que se vea todo lo dibujado
    setVb((v) => {
      const pad = Math.max(v.w, v.h) * 0.08
      if (p.x > v.x + pad && p.x < v.x + v.w - pad && p.y > v.y + pad && p.y < v.y + v.h - pad) return v
      const pts = [...s.draft, p]
      const x0 = Math.min(...pts.map((q) => q.x)), x1 = Math.max(...pts.map((q) => q.x))
      const y0 = Math.min(...pts.map((q) => q.y)), y1 = Math.max(...pts.map((q) => q.y))
      const m = Math.max(x1 - x0, y1 - y0) * 0.35 + 3000
      let w = x1 - x0 + 2 * m, h = y1 - y0 + 2 * m
      const aspect = v.w / v.h
      if (w / h > aspect) h = w / aspect; else w = h * aspect
      return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }
    })
    if (s.tool === 'outline') {
      const first = s.draft[0]
      if (s.draft.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) < 50) closeOutline(s.draft)
      else s.setDraft([...s.draft, p])
    } else {
      const id = newId('w')
      s.commit((pl) => ({ ...pl, walls: [...pl.walls, { id, a: last, b: p, thickness: 150 }] }))
      s.setDraft([p])
    }
  }

  /** Depósito rectangular a partir de las medidas escritas. */
  const createRect = (L: number, W: number) => {
    commit((p) => rectanglePlan(L, W, p))
    select(null)
    setVb(fitView(usePlan.getState().plan, size.w / size.h))
  }

  const closeOutline = (pts: PlanPoint[]) => {
    commit((p) => setOutline(p, pts))
    setDraft([])
    setTool('select')
  }

  /* ---- clics según la herramienta ---- */
  const onBackgroundDown = (e: React.PointerEvent<SVGSVGElement>) => {
    svgRef.current!.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), vb, mid: toPlan((a.x + b.x) / 2, (a.y + b.y) / 2) }
      drag.current = null
      return
    }
    const raw = toPlan(e.clientX, e.clientY)
    // Shift + arrastrar el fondo: recuadro para elegir varios racks
    if (tool === 'select' && (e.shiftKey || usePlan.getState().multi) && rackLayer) {
      drag.current = { type: 'box', a: raw }
      setBoxDraft({ a: raw, b: raw })
      return
    }
    // mover el plano de fondo (calco)
    const cal = useCalco.getState().calco
    if (tool === 'select' && cal?.moving && raw.x >= cal.x && raw.x <= cal.x + cal.w && raw.y >= cal.y && raw.y <= cal.y + cal.h) {
      drag.current = { type: 'calco', start: raw, x: cal.x, y: cal.y }
      return
    }
    if (e.button === 1 || tool === 'select') {
      drag.current = { type: 'pan', cx: e.clientX, cy: e.clientY, vb, moved: false }
      return
    }
    const last = draft[draft.length - 1]
    const snapped = objSnap(raw, e.altKey)
    const p = snapped ? { x: Math.round(snapped.x), y: Math.round(snapped.y) } : ortho(snapPt(raw, e.altKey), last)
    switch (tool) {
      case 'outline': {
        const first = draft[0]
        if (first && draft.length >= 3 && Math.hypot(raw.x - first.x, raw.y - first.y) < px(14)) closeOutline(draft)
        else setDraft([...draft, p])
        break
      }
      case 'wall':
        if (!last) setDraft([p])
        else if (Math.hypot(p.x - last.x, p.y - last.y) > 50) {
          const id = newId('w')
          commit((pl) => ({ ...pl, walls: [...pl.walls, { id, a: last, b: p, thickness: 150 }] }))
          setDraft([p])
        }
        break
      case 'column': {
        const id = newId('c')
        commit((pl) => ({ ...pl, columns: [...pl.columns, { id, x: p.x, y: p.y, shape: 'rect', w: 400, d: 400 }] }))
        select({ kind: 'column', id })
        break
      }
      case 'zone': {
        const id = newId('z')
        commit((pl) => ({ ...pl, zones: [...pl.zones, { id, x: p.x - 2000, y: p.y - 1500, w: 4000, d: 3000, name: 'Zona libre' }] }))
        setTool('select')
        select({ kind: 'zone', id })
        break
      }
      case 'area':
      case 'aisle':
        drag.current = { type: 'draw', kind: tool, a: p }
        setRectDraft({ kind: tool, a: p, b: p })
        break
      case 'rackdraw':
        drag.current = { type: 'rackdraw', a: p }
        setRackDraft({ a: p, b: p })
        break
      case 'measure':
        // primer clic: desde; segundo: hasta (queda fija); tercero: empieza otra medición
        if (!measure || measure.b) setMeasure({ a: p })
        else setMeasure({ a: measure.a, b: p })
        break
      case 'dim':
        if (!twoPoint) setTwoPoint(p)
        else if (Math.hypot(p.x - twoPoint.x, p.y - twoPoint.y) > 50) {
          const id = newId('k')
          const a = twoPoint
          commit((pl) => ({ ...pl, dims: [...(pl.dims ?? []), { id, a, b: p, offset: -Math.max(800, px(28)) }] }))
          setTwoPoint(null)
        }
        break
      case 'calibrate':
        if (!twoPoint) setTwoPoint(raw)
        else { e.preventDefault(); setCalib({ a: twoPoint, b: raw, text: '' }); setTwoPoint(null) }
        break
      case 'text':
        // sin esto, el clic le saca el foco al cuadro de texto apenas aparece
        e.preventDefault()
        setTextInput({ at: p, text: '' })
        break
      case 'symbol': {
        const id = newId('s')
        commit((pl) => ({ ...pl, symbols: [...(pl.symbols ?? []), { id, x: p.x, y: p.y, kind: symbolKind }] }))
        break
      }
      case 'door': {
        const near = edges(plan.outline).map((ed) => ({ ed, ...nearestOnEdge(ed, raw) })).sort((a, b) => a.distance - b.distance)[0]
        if (near && near.distance < Math.max(1500, px(30))) {
          const id = newId('d')
          commit((pl) => ({ ...pl, doors: [...pl.doors, { id, edge: near.ed.index, t: near.t, width: 4000, height: 4500 }] }))
          select({ kind: 'door', id })
        }
        break
      }
    }
  }

  const startDrag = (e: React.PointerEvent, d: Drag) => {
    if (tool !== 'select') return
    e.stopPropagation()
    svgRef.current!.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    drag.current = d
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const k = pinch.current.d / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      const v0 = pinch.current.vb, m = pinch.current.mid
      setVb({ x: m.x - (m.x - v0.x) * k, y: m.y - (m.y - v0.y) * k, w: v0.w * k, h: v0.h * k })
      return
    }
    const raw = toPlan(e.clientX, e.clientY)
    setCursor(raw)
    cursorRef.current = raw
    const d = drag.current
    if (tool !== 'select' || d?.type === 'wall-end') setHoverSnap(objSnap(raw, e.altKey))
    else if (hoverSnap) setHoverSnap(null)
    if (!d) return
    if (d.type === 'box') { setBoxDraft({ a: d.a, b: raw }); return }
    if (d.type === 'rackdraw') {
      const b = snapPt(raw, e.altKey)
      setRackDraft({ a: d.a, b })
      setGuides(rackFromDrag(d.a, b)?.guides ?? [])
      return
    }
    if (d.type === 'calco') { useCalco.getState().patch({ x: Math.round(d.x + raw.x - d.start.x), y: Math.round(d.y + raw.y - d.start.y) }); return }
    if (d.type === 'anno') {
      const dx = sn(raw.x - d.start.x, e.altKey), dy = sn(raw.y - d.start.y, e.altKey)
      if (!dx && !dy) return
      if (!d.started) { begin(); d.started = true }
      d.start = { x: d.start.x + dx, y: d.start.y + dy }
      const sel = { kind: d.kind, id: d.id } as PlanSelection
      live((pl) => moveSelection(pl, sel, dx, dy, []))
      return
    }
    if (d.type === 'racks') {
      // varios racks juntos: se aplica sólo lo que falta del movimiento (si alguno no entra, frenan)
      const layer = layerRef.current
      if (!layer) return
      const tx = sn(raw.x - d.start.x, e.altKey), ty = sn(raw.y - d.start.y, e.altKey)
      const stepX = tx - d.done.x, stepY = ty - d.done.y
      if (!stepX && !stepY) return
      if (!d.started) { begin(); d.started = true }
      const base = freezeRacks(usePlan.getState().plan, layer.racks)
      const next = moveRacksBy(base, d.ids, stepX, stepY, layer.size)
      if (next === base) return
      const a = base.racks!.find((r) => r.id === d.ids[0])!, b = next.racks!.find((r) => r.id === d.ids[0])!
      d.done = { x: d.done.x + (b.x - a.x), y: d.done.y + (b.y - a.y) }
      live(() => next)
      return
    }
    if (d.type === 'pan') {
      const dx = (e.clientX - d.cx) * scale, dy = (e.clientY - d.cy) * scale
      if (Math.abs(e.clientX - d.cx) + Math.abs(e.clientY - d.cy) > 3) d.moved = true
      setVb({ ...d.vb, x: d.vb.x - dx, y: d.vb.y - dy })
      return
    }
    if (d.type === 'draw') { setRectDraft({ kind: d.kind, a: d.a, b: snapPt(raw, e.altKey) }); return }
    if (!d.started) { begin(); d.started = true }
    const p = snapPt(raw, e.altKey)
    switch (d.type) {
      case 'vertex': live((pl) => moveVertex(pl, d.index, p)); break
      case 'sag': live((pl) => ({ ...pl, outline: { ...pl.outline, sags: pl.outline.sags.map((s, j) => (j === d.index ? sagFromPoint(pl, d.index, raw) : s)) } })); break
      case 'column': live((pl) => ({ ...pl, columns: pl.columns.map((c) => (c.id === d.id ? { ...c, x: sn(raw.x - d.dx, e.altKey), y: sn(raw.y - d.dy, e.altKey) } : c)) })); break
      case 'zone': live((pl) => ({ ...pl, zones: pl.zones.map((z) => (z.id === d.id ? { ...z, x: sn(raw.x - d.dx, e.altKey), y: sn(raw.y - d.dy, e.altKey) } : z)) })); break
      case 'wall': live((pl) => ({
        ...pl, walls: pl.walls.map((w) => {
          if (w.id !== d.id) return w
          const nx = sn(raw.x - d.dx, e.altKey), ny = sn(raw.y - d.dy, e.altKey)
          const ox = nx - w.a.x, oy = ny - w.a.y
          return { ...w, a: { x: nx, y: ny }, b: { x: w.b.x + ox, y: w.b.y + oy } }
        }),
      })); break
      case 'wall-end': { const q = smartPt(raw, e.altKey); live((pl) => ({ ...pl, walls: pl.walls.map((w) => (w.id === d.id ? { ...w, [d.end]: q } : w)) })); break }
      case 'area': case 'aisle': {
        const id = d.id, kind = d.type, dx = d.dx, dy = d.dy
        live((pl) => updateRect(pl, kind, id, () => ({ x: sn(raw.x - dx, e.altKey), y: sn(raw.y - dy, e.altKey) })))
        break
      }
      case 'rside': {
        const { kind, id, sides } = d
        live((pl) => patchRect(pl, kind, id, (r) => resizeRect(r, sides, p)))
        break
      }
      case 'resize': {
        const id = d.id, kind = d.kind
        live((pl) => updateRect(pl, kind, id, (r) => ({ w: Math.max(500, p.x - r.x), d: Math.max(500, p.y - r.y) })))
        break
      }
      case 'rack': {
        const layer = layerRef.current
        let nx = sn(raw.x - d.dx, e.altKey), ny = sn(raw.y - d.dy, e.altKey)
        // guías: se alinea con las otras filas y se pega dejando el pasillo justo (Alt: libre)
        const me = layer?.racks.find((r) => r.id === d.id)
        if (layer && me && !e.altKey) {
          const b = placementRect({ ...me, x: nx, y: ny })
          const g = snapRack(b, layer.racks.filter((r) => r.id !== d.id).map(placementRect), usePlan.getState().layout.aisle, px(10))
          nx = g.x; ny = g.y
          setGuides(g.guides)
        }
        // no se deja entrar en zonas libres ni pasillos, ni salir de la zona de racks
        live((pl) => layer ? moveRackWithin(freezeRacks(pl, layer.racks), d.id, nx, ny, layer.size) : moveRack(pl, d.id, nx, ny))
        break
      }
      case 'door': live((pl) => ({
        ...pl, doors: pl.doors.map((dr) => {
          if (dr.id !== d.id) return dr
          return { ...dr, t: nearestOnEdge(edges(pl.outline)[dr.edge], raw).t }
        }),
      })); break
    }
  }

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const d = drag.current
    if (d?.type === 'pan' && !d.moved && tool === 'select') select(null)
    if (guides.length) setGuides([])
    // con varios elegidos, tocar uno (sin arrastrar) lo abre para editarlo por separado
    if (d?.type === 'racks' && !d.started) usePlan.getState().setFocusRack(d.clicked)
    if (d?.type === 'rackdraw') {
      const b = snapPt(toPlan(e.clientX, e.clientY), e.altKey)
      const layer = layerRef.current
      // un clic sin arrastrar: una fila de 5 módulos desde ahí
      const far = Math.hypot(b.x - d.a.x, b.y - d.a.y) > 800
      const made = layer && rackFromDrag(d.a, far ? b : { x: d.a.x + 5 * (layer.size.width + layer.size.upright) + layer.size.upright, y: d.a.y })
      if (layer && made) {
        const id = newId('r')
        commit((pl) => { const base = freezeRacks(pl, layer.racks); return { ...base, racks: [...(base.racks ?? []), { ...made.rack, id }] } })
        select({ kind: 'rack', id })
      }
      setRackDraft(null)
    }
    if (d?.type === 'box') {
      const b = toPlan(e.clientX, e.clientY)
      const ids = racksInBox(layerRef.current?.racks ?? [], d.a.x, d.a.y, b.x, b.y)
      const prev = selectedRackIds(usePlan.getState().selection)
      select(rackSelection([...new Set([...prev, ...ids])]))
      setBoxDraft(null)
    }
    if (d?.type === 'draw') {
      const s = usePlan.getState()
      const r = drawnRect(d.kind, d.a, snapPt(toPlan(e.clientX, e.clientY), e.altKey), s.plan, s.layout.aisle)
      const id = newId(d.kind === 'area' ? 'a' : 'p')
      if (d.kind === 'area') commit((pl) => ({ ...pl, rackAreas: [...(pl.rackAreas ?? []), { id, ...r, name: `Zona ${String.fromCharCode(65 + Math.min(25, (pl.rackAreas ?? []).length))}` }] }))
      else commit((pl) => ({ ...pl, aisles: [...(pl.aisles ?? []), { id, ...r }] }))
      setRectDraft(null)
      setTool('select')
      select({ kind: d.kind, id })
    }
    drag.current = null
  }

  /* ---- grilla: cuadros de 1 m (con una línea más marcada cada 5 m); de lejos, cuadros de 10 m ---- */
  const grid = useMemo(() => {
    const step = [1000, 10_000, 100_000].find((s) => s / scale >= 7) ?? 1_000_000
    const major = step * 5
    const lines: { k: string; x1: number; y1: number; x2: number; y2: number; major: boolean }[] = []
    for (let x = Math.floor(vb.x / step) * step; x <= vb.x + vb.w; x += step)
      lines.push({ k: `x${x}`, x1: x, y1: vb.y, x2: x, y2: vb.y + vb.h, major: Math.abs(x % major) < 1e-6 })
    for (let y = Math.floor(vb.y / step) * step; y <= vb.y + vb.h; y += step)
      lines.push({ k: `y${y}`, x1: vb.x, y1: y, x2: vb.x + vb.w, y2: y, major: Math.abs(y % major) < 1e-6 })
    return { lines, step }
  }, [vb, scale])

  const es = edges(plan.outline)
  const outside = useMemo(() => itemsOutside(plan), [plan])
  const centroid = useMemo(() => {
    const pts = plan.outline.points
    return { x: pts.reduce((n, p) => n + p.x, 0) / pts.length, y: pts.reduce((n, p) => n + p.y, 0) / pts.length }
  }, [plan.outline.points])
  /** Un punto corrido hacia el centro del depósito (para rótulos que no se encimen con las medidas). */
  const inward = (c: PlanPoint, pixels: number): PlanPoint => {
    const dir = { x: centroid.x - c.x, y: centroid.y - c.y }
    const L = Math.hypot(dir.x, dir.y) || 1
    return { x: c.x + (dir.x / L) * px(pixels), y: c.y + (dir.y / L) * px(pixels) }
  }
  const isSel = (kind: string, key: string | number) => selection && selection.kind === kind && ('id' in selection ? selection.id : 'index' in selection ? selection.index : undefined) === key

  const label = (at: PlanPoint, text: string, key: string, color = '#1f2328') => (
    <text key={key} x={at.x} y={at.y} fontSize={px(12)} textAnchor="middle" dominantBaseline="middle" fill={color}
      stroke="#fff" strokeWidth={px(4)} style={{ paintOrder: 'stroke', fontFamily: 'var(--f-mono)', fontWeight: 600, pointerEvents: 'none' }}>{text}</text>
  )

  // vista previa de lo que se está dibujando
  const last = draft[draft.length - 1]
  const typedLen = typed ? parseMetros(typed) : NaN
  const preview = last && (tool === 'outline' || tool === 'wall')
    ? typedLen > 0 ? pointAtLength(last, cursor, draft[draft.length - 2], typedLen, snap) : cursor ? ortho(snapPt(cursor), last) : null
    : null
  const empty = plan.outline.points.length < 3

  return (
    <div ref={wrapRef} className={`plan-editor plan-editor--${tool}`}>
      <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} width="100%" height="100%"
        onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={(e) => {
          if (tool !== 'select') return
          const raw = toPlan(e.clientX, e.clientY)
          const near = es.map((ed) => ({ ed, ...nearestOnEdge(ed, raw) })).sort((a, b) => a.distance - b.distance)[0]
          if (near && near.distance < px(14)) { commit((p) => splitEdge(p, near.ed.index)); select({ kind: 'vertex', index: near.ed.index + 1 }) }
        }}>
        <defs>
          <pattern id="plan-hatch" width={px(10)} height={px(10)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={px(10)} stroke={RED} strokeWidth={px(1.5)} strokeOpacity="0.45" />
          </pattern>
          <pattern id="plan-aisle" width={px(12)} height={px(12)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={px(12)} height={px(12)} fill="#fff6cc" />
            <line x1="0" y1="0" x2="0" y2={px(12)} stroke="#e8b400" strokeWidth={px(3)} strokeOpacity="0.55" />
          </pattern>
        </defs>

        {/* piso del depósito y, encima, la grilla de 1 m (así los cuadros se ven también adentro) */}
        {es.length >= 3 && <path d={outlineD(plan)} fill="#fff" stroke="none" />}
        {/* plano de fondo para calcar */}
        {calco && !hidden.calco && <image href={calco.src} x={calco.x} y={calco.y} width={calco.w} height={calco.h} preserveAspectRatio="none"
          opacity={calco.opacity} pointerEvents="none" style={{ outline: calco.moving ? `${px(2)}px dashed ${BLUE}` : undefined }} />}
        {!hidden.grilla && <g>{grid.lines.map(({ k, major, ...l }) => <line key={k} {...l} stroke={major ? '#c3c8cf' : '#dde0e5'} strokeWidth={px(major ? 1.2 : 1)} />)}</g>}

        {/* piso y paredes */}
        {es.length >= 3 && <>
          {!hidden.zonas && plan.zones.map((z) => (
            <g key={z.id} onPointerDown={(e) => { select({ kind: 'zone', id: z.id }); const p = toPlan(e.clientX, e.clientY); startDrag(e, { type: 'zone', id: z.id, dx: p.x - z.x, dy: p.y - z.y, started: false }) }}>
              <rect x={z.x} y={z.y} width={z.w} height={z.d} fill="url(#plan-hatch)" stroke={isSel('zone', z.id) ? RED : '#c98a93'} strokeWidth={px(isSel('zone', z.id) ? 2.5 : 1.2)} strokeDasharray={`${px(6)} ${px(4)}`} />
              {label({ x: z.x + z.w / 2, y: z.y + z.d / 2 }, z.name, `zl${z.id}`, RED)}
            </g>
          ))}
          {es.map((e) => (
            <g key={`e${e.index}`}>
              <path d={edgeD(e)} fill="none" stroke={isSel('edge', e.index) ? RED : '#2b2e33'} strokeWidth={Math.max(plan.wallThickness, px(2))} strokeLinecap="square" />
              {tool === 'select' && <path d={edgeD(e)} fill="none" stroke="transparent" strokeWidth={px(16)} style={{ cursor: 'pointer' }}
                onPointerDown={(ev) => { ev.stopPropagation(); select({ kind: 'edge', index: e.index }) }} />}
            </g>
          ))}
        </>}

        {/* zonas de racks: sólo el borde y el nombre se agarran (adentro se puede seguir moviendo el plano) */}
        {!hidden.areas && (plan.rackAreas ?? []).map((z) => {
          const sel = isSel('area', z.id)
          const grab = (e: React.PointerEvent) => { select({ kind: 'area', id: z.id }); const p = toPlan(e.clientX, e.clientY); startDrag(e, { type: 'area', id: z.id, dx: p.x - z.x, dy: p.y - z.y, started: false }) }
          return (
            <g key={z.id}>
              <rect x={z.x} y={z.y} width={z.w} height={z.d} fill={BLUE} fillOpacity={sel ? 0.1 : 0.05} stroke={BLUE} strokeWidth={px(sel ? 2.5 : 1.5)}
                strokeDasharray={`${px(10)} ${px(5)}`} pointerEvents="none" />
              {tool === 'select' && <rect x={z.x} y={z.y} width={z.w} height={z.d} fill="none" stroke="transparent" strokeWidth={px(12)} pointerEvents="stroke" style={{ cursor: 'move' }} onPointerDown={grab} />}
              <text x={z.x + px(2)} y={z.y - px(7)} fontSize={px(12)} fill={BLUE} stroke="#fff" strokeWidth={px(4)}
                style={{ paintOrder: 'stroke', fontFamily: 'var(--f-mono)', fontWeight: 700, cursor: tool === 'select' ? 'move' : undefined }}
                onPointerDown={grab}>{`${z.name.toUpperCase()} · ${meters(z.w)} × ${meters(z.d)}`}</text>
            </g>
          )
        })}
        {/* pasillos marcados */}
        {!hidden.pasillos && (plan.aisles ?? []).map((a) => {
          const sel = isSel('aisle', a.id)
          const vertical = a.d > a.w
          return (
            <g key={a.id} style={{ cursor: tool === 'select' ? 'move' : undefined }}
              onPointerDown={(e) => { select({ kind: 'aisle', id: a.id }); const p = toPlan(e.clientX, e.clientY); startDrag(e, { type: 'aisle', id: a.id, dx: p.x - a.x, dy: p.y - a.y, started: false }) }}>
              <rect x={a.x} y={a.y} width={a.w} height={a.d} fill="url(#plan-aisle)" stroke={sel ? '#8a6500' : '#d9a400'} strokeWidth={px(sel ? 2.5 : 1.2)} />
              <text x={a.x + a.w / 2} y={a.y + a.d / 2} fontSize={px(11)} textAnchor="middle" dominantBaseline="middle" fill="#6f4800"
                stroke="#fff6cc" strokeWidth={px(4)} transform={vertical ? `rotate(-90 ${a.x + a.w / 2} ${a.y + a.d / 2})` : undefined}
                style={{ paintOrder: 'stroke', fontFamily: 'var(--f-mono)', fontWeight: 700, pointerEvents: 'none' }}>{`PASILLO ${meters(Math.min(a.w, a.d))}`}</text>
            </g>
          )
        })}

        {/* racks ubicados */}
        {rackLayer && !hidden.racks && <PlanRacks racks={rackLayer.racks} size={rackLayer.size} px={px} issues={rackLayer.issues} view={vb}
          selected={selectedSet}
          onDown={tool === 'select' ? (e, r) => {
            const p = toPlan(e.clientX, e.clientY)
            const current = selectedRackIds(usePlan.getState().selection)
            // Shift / Ctrl + clic: suma o saca este rack de la selección
            if (e.shiftKey || e.ctrlKey || e.metaKey || usePlan.getState().multi) {
              e.stopPropagation()
              select(rackSelection(current.includes(r.id) ? current.filter((x) => x !== r.id) : [...current, r.id]))
              return
            }
            // si es uno de varios elegidos, se mueven todos juntos
            if (current.length > 1 && current.includes(r.id)) { startDrag(e, { type: 'racks', ids: current, start: p, done: { x: 0, y: 0 }, started: false, clicked: r.id }); return }
            select({ kind: 'rack', id: r.id })
            startDrag(e, { type: 'rack', id: r.id, dx: p.x - r.x, dy: p.y - r.y, started: false })
          } : undefined} />}
        {rackLayer && selection?.kind === 'racks' && focusRack && selection.ids.includes(focusRack) && (() => {
          const r = rackLayer.racks.find((x) => x.id === focusRack)
          if (!r) return null
          const b = placementRect(r)
          return <rect className="no-export" x={b.x - px(6)} y={b.y - px(6)} width={b.w + px(12)} height={b.h + px(12)} fill="none" stroke={BLUE} strokeWidth={px(2.5)} strokeDasharray={`${px(8)} ${px(4)}`} pointerEvents="none" />
        })()}
        {rackLayer && showCotas && !hidden.numeros && !hidden.racks && <PlanRackNotes racks={rackLayer.racks} px={px} />}

        {/* tabiques */}
        {!hidden.tabiques && plan.walls.map((w) => (
          <g key={w.id}>
            <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={isSel('wall', w.id) || outside.has(w.id) ? RED : '#4b5058'} strokeWidth={Math.max(w.thickness, px(2))} strokeLinecap="square"
              strokeDasharray={outside.has(w.id) ? `${px(8)} ${px(5)}` : undefined} />
            {tool === 'select' && <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="transparent" strokeWidth={px(14)} style={{ cursor: 'move' }}
              onPointerDown={(e) => { select({ kind: 'wall', id: w.id }); const p = toPlan(e.clientX, e.clientY); startDrag(e, { type: 'wall', id: w.id, dx: p.x - w.a.x, dy: p.y - w.a.y, started: false }) }} />}
            {label({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 - px(12) }, meters(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)), `wl${w.id}`, '#4b5058')}
            {isSel('wall', w.id) && (['a', 'b'] as const).map((end) => (
              <circle key={end} cx={w[end].x} cy={w[end].y} r={px(6)} fill="#fff" stroke={RED} strokeWidth={px(2)} style={{ cursor: 'grab' }}
                onPointerDown={(e) => startDrag(e, { type: 'wall-end', id: w.id, end, started: false })} />
            ))}
          </g>
        ))}

        {/* portones */}
        {!hidden.portones && plan.doors.map((d) => {
          const e = es[d.edge]
          if (!e) return null
          const c = pointOnEdge(e, d.t), t = tangentOnEdge(e, d.t)
          const a = { x: c.x - t.x * d.width / 2, y: c.y - t.y * d.width / 2 }, b = { x: c.x + t.x * d.width / 2, y: c.y + t.y * d.width / 2 }
          return (
            <g key={d.id} onPointerDown={(ev) => { select({ kind: 'door', id: d.id }); startDrag(ev, { type: 'door', id: d.id, started: false }) }} style={{ cursor: 'ew-resize' }}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={isSel('door', d.id) ? RED : '#e0a100'} strokeWidth={Math.max(plan.wallThickness * 1.6, px(6))} />
              {label(inward(c, 52), `PORTÓN ${meters(d.width)}`, `dl${d.id}`, '#6f4800')}
            </g>
          )
        })}

        {/* columnas */}
        {!hidden.columnas && plan.columns.map((c) => {
          const sel = isSel('column', c.id)
          const props = {
            fill: sel ? RED : outside.has(c.id) ? '#fff' : '#3b3f45', stroke: sel || outside.has(c.id) ? RED : 'none', strokeWidth: px(2),
            strokeDasharray: outside.has(c.id) ? `${px(4)} ${px(3)}` : undefined, style: { cursor: tool === 'select' ? 'move' : undefined },
            onPointerDown: (e: React.PointerEvent) => { select({ kind: 'column', id: c.id }); const p = toPlan(e.clientX, e.clientY); startDrag(e, { type: 'column', id: c.id, dx: p.x - c.x, dy: p.y - c.y, started: false }) },
          }
          const minR = px(4)
          return c.shape === 'round'
            ? <circle key={c.id} cx={c.x} cy={c.y} r={Math.max(c.w / 2, minR)} {...props} />
            : <rect key={c.id} x={c.x - Math.max(c.w / 2, minR)} y={c.y - Math.max(c.d / 2, minR)} width={Math.max(c.w, minR * 2)} height={Math.max(c.d, minR * 2)} {...props} />
        })}

        {/* anotaciones: cotas propias, textos y símbolos */}
        <PlanAnnotations texts={plan.texts ?? []} symbols={plan.symbols ?? []} dims={plan.dims ?? []} px={px}
          selectedId={selection && 'id' in selection ? selection.id : undefined}
          showTexts={!hidden.textos} showSymbols={!hidden.simbolos} showDims={!hidden.cotasPropias}
          onDown={tool === 'select' ? (e, kind, id) => { select({ kind, id }); startDrag(e, { type: 'anno', kind, id, start: toPlan(e.clientX, e.clientY), started: false }) } : undefined} />

        {/* cotas (o, si están apagadas, el largo de cada pared) */}
        {showCotas && tool !== 'outline' && !empty && (
          <PlanCotas plan={plan} px={px} column={selection?.kind === 'column' ? plan.columns.find((c) => c.id === selection.id) : null}
            onEditEdge={tool === 'select' ? (index, at) => {
              const e = edges(plan.outline)[index]
              select({ kind: 'edge', index })
              setInline({ edit: { kind: 'edge', index }, at, text: metrosNum(Math.round(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y))) })
            } : undefined}
            onEditTotal={tool === 'select' ? (axis, at) => {
              const vs = plan.outline.points.map((q) => q[axis])
              setInline({ edit: { kind: 'total', axis }, at, text: metrosNum(Math.max(...vs) - Math.min(...vs)) })
            } : undefined} />
        )}
        {!showCotas && tool !== 'outline' && es.map((e) => {
          const m = apex(e)
          const dir = { x: m.x - centroid.x, y: m.y - centroid.y }
          const L = Math.hypot(dir.x, dir.y) || 1
          const at = { x: m.x + (dir.x / L) * px(16), y: m.y + (dir.y / L) * px(16) }
          return label(at, meters(edgeLength(e)), `el${e.index}`)
        })}

        {/* manijas en los 4 lados y las 4 esquinas de la zona o el pasillo elegido: se estira desde cualquiera */}
        {tool === 'select' && (selection?.kind === 'area' || selection?.kind === 'aisle' || selection?.kind === 'zone') && (() => {
          const kind = selection.kind
          const r = kind === 'area' ? plan.rackAreas?.find((x) => x.id === selection.id) : kind === 'aisle' ? plan.aisles?.find((x) => x.id === selection.id) : plan.zones.find((x) => x.id === selection.id)
          if (!r) return null
          const color = kind === 'area' ? BLUE : kind === 'aisle' ? '#8a6500' : RED
          const hs: { sides: Side[]; x: number; y: number; cur: string }[] = [
            { sides: ['l', 't'], x: r.x, y: r.y, cur: 'nwse-resize' }, { sides: ['t'], x: r.x + r.w / 2, y: r.y, cur: 'ns-resize' },
            { sides: ['r', 't'], x: r.x + r.w, y: r.y, cur: 'nesw-resize' }, { sides: ['r'], x: r.x + r.w, y: r.y + r.d / 2, cur: 'ew-resize' },
            { sides: ['r', 'b'], x: r.x + r.w, y: r.y + r.d, cur: 'nwse-resize' }, { sides: ['b'], x: r.x + r.w / 2, y: r.y + r.d, cur: 'ns-resize' },
            { sides: ['l', 'b'], x: r.x, y: r.y + r.d, cur: 'nesw-resize' }, { sides: ['l'], x: r.x, y: r.y + r.d / 2, cur: 'ew-resize' },
          ]
          return (
            <g className="no-export">
              {hs.map((h, i) => (
                <rect key={i} x={h.x - px(6)} y={h.y - px(6)} width={px(12)} height={px(12)} rx={px(2.5)} fill="#fff" stroke={color} strokeWidth={px(2.2)}
                  style={{ cursor: h.cur }} onPointerDown={(e) => startDrag(e, { type: 'rside', kind, id: r.id, sides: h.sides, started: false })} />
              ))}
            </g>
          )
        })()}

        {/* manijas (sólo con Seleccionar) */}
        {tool === 'select' && selection?.kind === 'edge' && es[selection.index] && (() => {
          const e = es[selection.index]
          const m = apex(e)
          return (
            <g className="no-export">
              <circle cx={m.x} cy={m.y} r={px(8)} fill={RED} stroke="#fff" strokeWidth={px(2)} style={{ cursor: 'grab' }}
                onPointerDown={(ev) => startDrag(ev, { type: 'sag', index: e.index, started: false })} />
              {label({ x: m.x, y: m.y - px(20) }, 'arrastrá para curvar', 'hint-sag', RED)}
            </g>
          )
        })()}
        {tool === 'select' && plan.outline.points.map((p, i) => (
          <rect key={`v${i}`} className="no-export" x={p.x - px(6)} y={p.y - px(6)} width={px(12)} height={px(12)} rx={px(2)}
            fill={isSel('vertex', i) ? RED : '#fff'} stroke={RED} strokeWidth={px(2)} style={{ cursor: 'grab' }}
            onPointerDown={(e) => { select({ kind: 'vertex', index: i }); startDrag(e, { type: 'vertex', index: i, started: false }) }} />
        ))}

        {/* dibujo en curso */}
        {draft.length > 0 && <>
          <polyline points={[...draft, ...(preview ? [preview] : [])].map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={RED} strokeWidth={px(2.5)} strokeDasharray={`${px(8)} ${px(5)}`} />
          {draft.map((p, i) => <circle key={`d${i}`} cx={p.x} cy={p.y} r={px(i === 0 && tool === 'outline' ? 8 : 5)} fill={i === 0 && tool === 'outline' ? RED : '#fff'} stroke={RED} strokeWidth={px(2)} />)}
          {preview && label({ x: (last.x + preview.x) / 2, y: (last.y + preview.y) / 2 - px(14) }, typed ? `${typed} m ⏎` : meters(Math.hypot(preview.x - last.x, preview.y - last.y)), 'draft-len', RED)}
        </>}
        {rectDraft && (Math.abs(rectDraft.b.x - rectDraft.a.x) > 0 || Math.abs(rectDraft.b.y - rectDraft.a.y) > 0) && (() => {
          const r = drawnRect(rectDraft.kind, rectDraft.a, rectDraft.b, plan, usePlan.getState().layout.aisle)
          const color = rectDraft.kind === 'area' ? BLUE : '#8a6500'
          return (
            <g pointerEvents="none">
              <rect x={r.x} y={r.y} width={r.w} height={r.d} fill={rectDraft.kind === 'area' ? BLUE : 'url(#plan-aisle)'} fillOpacity={rectDraft.kind === 'area' ? 0.08 : 0.9}
                stroke={color} strokeWidth={px(2)} strokeDasharray={`${px(8)} ${px(5)}`} />
              {label({ x: r.x + r.w / 2, y: r.y - px(14) }, `${meters(r.w)} × ${meters(r.d)}`, 'rect-draft', color)}
            </g>
          )
        })()}
        {boxDraft && <rect x={Math.min(boxDraft.a.x, boxDraft.b.x)} y={Math.min(boxDraft.a.y, boxDraft.b.y)} width={Math.abs(boxDraft.b.x - boxDraft.a.x)} height={Math.abs(boxDraft.b.y - boxDraft.a.y)}
          fill={RED} fillOpacity={0.06} stroke={RED} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} pointerEvents="none" />}
        {/* fila de racks que se está dibujando */}
        {rackDraft && (() => {
          const m = rackFromDrag(rackDraft.a, rackDraft.b)
          if (!m) return null
          const b = placementRect(m.rack)
          return (
            <g pointerEvents="none">
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#fdebd3" fillOpacity={0.8} stroke="#e07b1f" strokeWidth={px(2)} strokeDasharray={`${px(8)} ${px(5)}`} />
              {label({ x: b.x + b.w / 2, y: b.y - px(16) }, `${m.rack.modules} ${m.rack.modules === 1 ? 'módulo' : 'módulos'} · ${meters(m.rack.length)}${m.rack.pair ? ' · doble' : ''}`, 'rackdraft', '#9a4a0c')}
            </g>
          )
        })()}
        {/* distancias del rack elegido a lo que tiene alrededor, y guías al moverlo */}
        {rackLayer && tool === 'select' && selection?.kind === 'rack' && (() => {
          const me = rackLayer.racks.find((r) => r.id === selection.id)
          if (!me) return null
          const poly = outlinePolygon(plan.outline, 200)
          const gs = clearances(placementRect(me), poly, rackLayer.racks.filter((r) => r.id !== me.id).map(placementRect))
          return <GuideLines guides={gs} px={px} color="#0f8a8a" />
        })()}
        {guides.length > 0 && <GuideLines guides={guides} px={px} color="#c2189a" />}

        {/* medir */}
        {tool === 'measure' && measure && (() => {
          const a = measure.a, b = measure.b ?? (cursor ? smartPt(cursor) : a)
          const L = Math.hypot(b.x - a.x, b.y - a.y)
          return (
            <g pointerEvents="none">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0f8a8a" strokeWidth={px(2.5)} strokeDasharray={measure.b ? undefined : `${px(8)} ${px(5)}`} />
              {[a, b].map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={px(4)} fill="#fff" stroke="#0f8a8a" strokeWidth={px(2)} />)}
              {L > 0 && label({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - px(16) }, `${meters(L)}  ·  ↔ ${meters(Math.abs(b.x - a.x))}  ↕ ${meters(Math.abs(b.y - a.y))}`, 'measure', '#0b6b6b')}
            </g>
          )
        })()}
        {/* cota o calibración en curso: del primer punto al cursor */}
        {(tool === 'dim' || tool === 'calibrate') && twoPoint && cursor && (() => {
          const b = tool === 'dim' ? smartPt(cursor) : cursor
          return (
            <g pointerEvents="none">
              <line x1={twoPoint.x} y1={twoPoint.y} x2={b.x} y2={b.y} stroke={tool === 'dim' ? '#1f5f8b' : BLUE} strokeWidth={px(2)} strokeDasharray={`${px(8)} ${px(5)}`} />
              <circle cx={twoPoint.x} cy={twoPoint.y} r={px(4)} fill="#fff" stroke={BLUE} strokeWidth={px(2)} />
              {label({ x: (twoPoint.x + b.x) / 2, y: (twoPoint.y + b.y) / 2 - px(14) }, meters(Math.hypot(b.x - twoPoint.x, b.y - twoPoint.y)), 'two-point', '#1f5f8b')}
            </g>
          )
        })()}
        {calib && <line x1={calib.a.x} y1={calib.a.y} x2={calib.b.x} y2={calib.b.y} stroke={BLUE} strokeWidth={px(3)} pointerEvents="none" />}
        {/* imán a objetos: cuadradito naranja en el punto donde se pega */}
        {hoverSnap && <g pointerEvents="none">
          <rect x={hoverSnap.x - px(6)} y={hoverSnap.y - px(6)} width={px(12)} height={px(12)} fill="none" stroke="#e07b1f" strokeWidth={px(2.2)} />
          {label({ x: hoverSnap.x, y: hoverSnap.y + px(16) }, hoverSnap.kind, 'snap-kind', '#b85c0a')}
        </g>}
        {cursor && tool !== 'select' && !hoverSnap && <circle cx={snapPt(cursor).x} cy={snapPt(cursor).y} r={px(3)} fill={RED} pointerEvents="none" />}
      </svg>
      {empty && draft.length === 0 && tool !== 'outline' && <StartCard onCreate={createRect} onDraw={() => setTool('outline')} />}
      {TOOL_HINT[tool] && (
        <div className="plan-editor__hint" role="status">{TOOL_HINT[tool](!!twoPoint, !!measure?.b)}</div>
      )}
      {(tool === 'outline' || tool === 'wall') && (
        <div className="plan-editor__hint" role="status">
          {draft.length === 0
            ? tool === 'outline' ? 'Hacé clic donde va la primera esquina del depósito.' : 'Hacé clic donde empieza el tabique.'
            : typed
              ? <>Largo <strong>{typed} m</strong> · Enter para ponerlo · apuntá con el mouse para la dirección</>
              : <>Escribí el largo de la pared (ej. <strong>40</strong>) y Enter, o hacé clic.{tool === 'outline' && draft.length >= 3 ? ' Enter solo o tocar el primer punto cierra el depósito.' : ''} Esc cancela.</>}
        </div>
      )}
      {inline && (
        <input className="cota-input" autoFocus inputMode="decimal" value={inline.text} aria-label="Medida en metros"
          style={{ left: ((inline.at.x - vb.x) / vb.w) * size.w, top: ((inline.at.y - vb.y) / vb.h) * size.h }}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setInline({ ...inline, text: e.target.value.replace(/[^\d.,]/g, '') })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { inlineCancel.current = true; setInline(null) }
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          onBlur={() => {
            const v = parseMetros(inline.text)
            if (inlineCancel.current) { inlineCancel.current = false; return }
            if (v >= 100) {
              const ed = inline.edit
              commit((p) => ed.kind === 'edge' ? setEdgeLength(p, ed.index, v) : setTotal(p, ed.axis, v))
            }
            setInline(null)
          }} />
      )}
      {!empty && <Legend plan={plan} racks={!!rackLayer?.racks.length} issues={!!rackLayer?.issues && Object.keys(rackLayer.issues).length > 0} />}
      {!empty && <ScaleBar mmPerPx={scale} />}
      {textInput && (
        <input className="cota-input cota-input--text" autoFocus value={textInput.text} placeholder="Escribí el texto" aria-label="Texto"
          style={{ left: ((textInput.at.x - vb.x) / vb.w) * size.w, top: ((textInput.at.y - vb.y) / vb.h) * size.h }}
          onChange={(e) => setTextInput({ ...textInput, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { textCancel.current = true; setTextInput(null) }
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          onBlur={() => {
            const t = textInput.text.trim()
            if (t && !textCancel.current) { const id = newId('t'); commit((pl) => ({ ...pl, texts: [...(pl.texts ?? []), { id, x: textInput.at.x, y: textInput.at.y, text: t, size: Math.round(Math.max(400, px(14)) / 50) * 50 }] })); setTool('select'); select({ kind: 'text', id }) }
            textCancel.current = false
            setTextInput(null)
          }} />
      )}
      {calib && (
        <div className="calib-ask" style={{ left: (((calib.a.x + calib.b.x) / 2 - vb.x) / vb.w) * size.w, top: (((calib.a.y + calib.b.y) / 2 - vb.y) / vb.h) * size.h }}>
          <span>¿Cuánto mide esa distancia en la realidad?</span>
          <input autoFocus inputMode="decimal" placeholder="ej. 40" value={calib.text} aria-label="Distancia real en metros"
            onChange={(e) => setCalib({ ...calib, text: e.target.value.replace(/[^\d.,]/g, '') })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setCalib(null); setTool('select') }
              if (e.key === 'Enter') {
                const real = parseMetros(calib.text)
                const cur = useCalco.getState().calco
                if (cur && real > 0) useCalco.getState().set(scaleCalco(cur, calib.a, calib.b, real))
                setCalib(null); setTool('select')
              }
            }} />
          <small>m · Enter</small>
        </div>
      )}
      {tool === 'select' && <ObjectBar vb={vb} size={size} layer={rackLayer} onFit={fit} />}
      <div className="zoom-btns" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(1 / 1.5)} aria-label="Acercar" title="Acercar">+</button>
        <button type="button" onClick={() => zoomBy(1.5)} aria-label="Alejar" title="Alejar">−</button>
      </div>
      <div className="plan-editor__coords" aria-hidden>
        <span className="plan-editor__square" />{` cuadro = ${meters(grid.step)}`}
        {cursor ? ` · x ${meters(snapPt(cursor).x)} · y ${meters(snapPt(cursor).y)}` : snap ? ` · imán ${meters(snapStep)} (Alt: libre)` : ''}
      </div>
    </div>
  )
}

/** Guías y distancias: línea de alineación punteada, o tramo con su medida. */
function GuideLines({ guides, px, color }: { guides: Guide[]; px: (n: number) => number; color: string }) {
  return (
    <g pointerEvents="none" className="no-export">
      {guides.map((g, i) => {
        const mid = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 }
        const vertical = Math.abs(g.b.x - g.a.x) < Math.abs(g.b.y - g.a.y)
        const t = px(4)
        return (
          <g key={i}>
            <line x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={color} strokeWidth={px(1.5)} strokeDasharray={g.kind === 'align' ? `${px(6)} ${px(4)}` : undefined} />
            {g.kind === 'gap' && <>
              {[g.a, g.b].map((p, k) => <line key={k} x1={p.x - (vertical ? t : 0)} y1={p.y - (vertical ? 0 : t)} x2={p.x + (vertical ? t : 0)} y2={p.y + (vertical ? 0 : t)} stroke={color} strokeWidth={px(1.5)} />)}
              {g.value !== undefined && <text x={mid.x + (vertical ? px(6) : 0)} y={mid.y - (vertical ? 0 : px(7))} fontSize={px(11)} textAnchor={vertical ? 'start' : 'middle'} dominantBaseline="middle"
                fill={color} stroke="#fff" strokeWidth={px(3)} style={{ paintOrder: 'stroke', fontFamily: 'var(--f-mono)', fontWeight: 700 }}>{meters(g.value)}</text>}
            </>}
          </g>
        )
      })}
    </g>
  )
}

/** Qué hacer con cada herramienta nueva (cartel de arriba del plano). */
const TOOL_HINT: Partial<Record<string, (first: boolean, done: boolean) => string>> = {
  measure: (_f, done) => (done ? 'Medición lista. Hacé clic para medir otra cosa; Esc termina.' : 'Medir: clic en un punto y clic en el otro. Se pega a esquinas, puntas y centros.'),
  dim: (first) => (first ? 'Ahora clic en el otro extremo de la cota.' : 'Cota: clic en un extremo y clic en el otro. Queda dibujada en el plano.'),
  text: () => 'Texto: clic donde va, escribilo y Enter.',
  symbol: () => 'Símbolo: clic donde va cada uno. Elegí cuál en el panel Herramientas.',
  rackdraw: () => 'Fila de racks: arrastrá de punta a punta y salen todos los módulos que entran (un clic solo: 5 módulos). Se alinea con las otras filas dejando el pasillo justo. Esc termina.',
  calibrate: (first) => (first ? 'Ahora clic en el otro punto de esa medida conocida.' : 'Escala del plano de fondo: clic en dos puntos de una medida que conozcas (por ejemplo, una pared).'),
}

/** Plano vacío: crear el depósito escribiendo largo × ancho, o dibujarlo a mano. */
function StartCard({ onCreate, onDraw }: { onCreate(L: number, W: number): void; onDraw(): void }) {
  const [L, setL] = useState('')
  const [W, setW] = useState('')
  const l = parseMetros(L), w = parseMetros(W)
  const ok = l >= 2000 && w >= 2000 && l <= 2_000_000 && w <= 2_000_000
  const clean = (v: string) => v.replace(/[^\d.,]/g, '')
  return (
    <form className="plan-start" onPointerDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (ok) onCreate(l, w) }}>
      <h2 className="plan-start__t">Empezá tu depósito</h2>
      <p className="plan-start__p">Escribí las medidas del depósito en metros:</p>
      <div className="plan-start__row">
        <label className="plan-start__f"><span>Largo</span><span className="plan-start__in"><input autoFocus inputMode="decimal" placeholder="ej. 40" value={L} onChange={(e) => setL(clean(e.target.value))} aria-label="Largo en metros" /><small>m</small></span></label>
        <span className="plan-start__x" aria-hidden>×</span>
        <label className="plan-start__f"><span>Ancho</span><span className="plan-start__in"><input inputMode="decimal" placeholder="ej. 25" value={W} onChange={(e) => setW(clean(e.target.value))} aria-label="Ancho en metros" /><small>m</small></span></label>
      </div>
      <button type="submit" className="plan-start__go" disabled={!ok}>Crear depósito{ok ? ` de ${meters(l)} × ${meters(w)}` : ''}</button>
      <div className="plan-start__or"><span>o</span></div>
      <button type="button" className="plan-start__draw" onClick={onDraw}>Dibujarlo a mano (forma en L, paredes curvas…)</button>
      <p className="plan-start__small">Hacés clic en cada esquina y escribís el largo de cada pared. Después podés cambiar cualquier medida.</p>
    </form>
  )
}
