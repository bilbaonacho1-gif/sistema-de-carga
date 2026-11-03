/**
 * EDITOR DEL PLANO (vista de arriba, SVG en milímetros).
 *  - Seleccionar: arrastrar puntos, columnas, zonas, tabiques y portones. Tocando una pared
 *    aparece su manija del medio: arrastrándola la pared se curva. Doble clic agrega un punto.
 *  - Contorno: clic punto por punto; se cierra tocando el primero (o Enter).
 *  - Tabique: clic en cada extremo (encadena el siguiente; Esc termina).
 *  - Columna / Portón / Zona: clic donde va.
 * Rueda o pellizco: zoom. Arrastrar el fondo: mover. Ctrl+Z / Ctrl+Y: deshacer / rehacer.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { itemsOutside, moveVertex, newId, removeItem, removeVertex, sagFromPoint, setOutline, splitEdge } from '../../shared/plan/edit'
import { apex, arcOf, edgeLength, edges, nearestOnEdge, planBounds, pointInPolygon, pointOnEdge, tangentOnEdge, type Edge } from '../../shared/plan/geometry'
import { addRack, footprint, localBox, rackConflicts, removeRack, repeatRack, rotateRack, rowBands, structureFor, toPlanPoint, type ConflictReason, type RowBand } from '../../shared/plan/racks'
import type { RackStructure } from '../../shared/rack/types'
import type { Plan, PlanPoint, PlanRack } from '../../shared/plan/types'
import { useDesigner } from '../pages/designer/designerStore'
import { usePlan } from './planStore'

type VB = { x: number; y: number; w: number; h: number }
type Drag =
  | { type: 'pan'; cx: number; cy: number; vb: VB; moved: boolean }
  | { type: 'vertex'; index: number; started: boolean }
  | { type: 'sag'; index: number; started: boolean }
  | { type: 'column' | 'zone'; id: string; dx: number; dy: number; started: boolean }
  | { type: 'wall'; id: string; dx: number; dy: number; started: boolean }
  | { type: 'wall-end'; id: string; end: 'a' | 'b'; started: boolean }
  | { type: 'door'; id: string; started: boolean }
  | { type: 'rack'; id: string; dx: number; dy: number; started: boolean }

const RED = '#be1e30'
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

const rackFootprint = footprint

function fitView(plan: Plan, aspect: number): VB {
  const b = planBounds(plan)
  for (const r of plan.racks ?? []) {
    const f = rackFootprint(r)
    b.minX = Math.min(b.minX, f.minX); b.minY = Math.min(b.minY, f.minY); b.maxX = Math.max(b.maxX, f.maxX); b.maxY = Math.max(b.maxY, f.maxY)
  }
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.12 + 1000
  let w = b.maxX - b.minX + pad * 2
  let h = b.maxY - b.minY + pad * 2
  if (w / h > aspect) h = w / aspect
  else w = h * aspect
  return { x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minY + b.maxY) / 2 - h / 2, w, h }
}

export function PlanEditor({ fitRequest }: { fitRequest: number }) {
  const { plan, tool, selection, draft, snap, commit, begin, live, select, setDraft, setTool } = usePlan()
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [vb, setVb] = useState<VB>(() => fitView(plan, 4 / 3))
  const [cursor, setCursor] = useState<PlanPoint | null>(null)
  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; vb: VB; mid: PlanPoint } | null>(null)
  const [ghostRot, setGhostRot] = useState(0)
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
  const fit = useCallback(() => setVb(fitView(usePlan.getState().plan, size.w / size.h)), [size.w, size.h])
  useEffect(() => { fit() }, [fitRequest]) // eslint-disable-line react-hooks/exhaustive-deps -- encuadra al pedirlo

  /* ---- coordenadas ---- */
  const toPlan = (clientX: number, clientY: number): PlanPoint => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = clientX; pt.y = clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }
  const sn = (v: number, free = false) => (snap && !free ? Math.round(v / 100) * 100 : Math.round(v))
  const snapPt = (p: PlanPoint, free = false): PlanPoint => ({ x: sn(p.x, free), y: sn(p.y, free) })
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
      if (e.key === 'Escape') { if (s.draft.length) s.setDraft([]); else s.select(null); return }
      if (e.key === 'Enter' && s.tool === 'outline' && s.draft.length >= 3) { closeOutline(s.draft); return }
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
        if (s.tool === 'rack') { setGhostRot((r) => (r + 90) % 360); return }
        const sel = s.selection
        if (sel?.kind === 'rack') {
          const rack = s.plan.racks?.find((x) => x.id === sel.id)
          if (rack) s.commit((p) => rotateRack(p, sel.id, rack.rotation + (e.shiftKey ? -90 : 90)))
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        const sel = s.selection
        if (sel?.kind !== 'rack') return
        e.preventDefault()
        const rack = s.plan.racks?.find((x) => x.id === sel.id)
        if (!rack) return
        let ids: string[] = []
        s.commit((p) => { const r = repeatRack(p, sel.id, 1, 'across', rack.config.layout.aisleWidth); ids = r.ids; return r.plan })
        if (ids[0]) s.select({ kind: 'rack', id: ids[0] })
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = s.selection
        if (!sel) return
        e.preventDefault()
        if (sel.kind === 'vertex') s.commit((p) => removeVertex(p, sel.index))
        else if (sel.kind === 'rack') s.commit((p) => removeRack(p, sel.id))
        else if (sel.kind !== 'edge') s.commit((p) => removeItem(p, sel.kind, sel.id))
        s.select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- lee el estado al momento

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
    // los racks se dibujan juntos en un solo trazo: cuál se tocó se averigua con la geometría
    if (tool === 'select' && e.button === 0) {
      const hit = rackAt(raw)
      if (hit) {
        select({ kind: 'rack', id: hit.id })
        drag.current = { type: 'rack', id: hit.id, dx: raw.x - hit.x, dy: raw.y - hit.y, started: false }
        return
      }
    }
    if (e.button === 1 || tool === 'select') {
      drag.current = { type: 'pan', cx: e.clientX, cy: e.clientY, vb, moved: false }
      return
    }
    const last = draft[draft.length - 1]
    const p = ortho(snapPt(raw, e.altKey), last)
    switch (tool) {
      case 'rack': {
        let id = ''
        commit((pl) => { const r = addRack(pl, useDesigner.getState().config, snapPt(raw, e.altKey), ghostRot); id = r.id; return r.plan })
        select({ kind: 'rack', id })
        break
      }
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
    const d = drag.current
    if (!d) return
    if (d.type === 'pan') {
      const dx = (e.clientX - d.cx) * scale, dy = (e.clientY - d.cy) * scale
      if (Math.abs(e.clientX - d.cx) + Math.abs(e.clientY - d.cy) > 3) d.moved = true
      setVb({ ...d.vb, x: d.vb.x - dx, y: d.vb.y - dy })
      return
    }
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
      case 'wall-end': live((pl) => ({ ...pl, walls: pl.walls.map((w) => (w.id === d.id ? { ...w, [d.end]: p } : w)) })); break
      case 'rack': live((pl) => ({ ...pl, racks: (pl.racks ?? []).map((r) => (r.id === d.id ? { ...r, x: sn(raw.x - d.dx, e.altKey), y: sn(raw.y - d.dy, e.altKey) } : r)) })); break
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
    drag.current = null
  }

  /* ---- grilla adaptada al zoom ---- */
  const grid = useMemo(() => {
    const steps = [100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000]
    const step = steps.find((s) => s / scale >= 16) ?? 100_000
    const major = step * (step === 250 || step === 2500 || step === 25_000 ? 4 : 5)
    const lines: { k: string; x1: number; y1: number; x2: number; y2: number; major: boolean }[] = []
    for (let x = Math.floor(vb.x / step) * step; x <= vb.x + vb.w; x += step)
      lines.push({ k: `x${x}`, x1: x, y1: vb.y, x2: x, y2: vb.y + vb.h, major: Math.abs(x % major) < 1e-6 })
    for (let y = Math.floor(vb.y / step) * step; y <= vb.y + vb.h; y += step)
      lines.push({ k: `y${y}`, x1: vb.x, y1: y, x2: vb.x + vb.w, y2: y, major: Math.abs(y % major) < 1e-6 })
    return lines
  }, [vb, scale])

  const es = edges(plan.outline)
  const outside = useMemo(() => itemsOutside(plan), [plan])
  const conflicts = useMemo(() => rackConflicts(plan), [plan])
  const racks = plan.racks ?? []
  // sólo se dibujan los racks que caen en pantalla; el detalle de módulos aparece al acercarse
  const detail = scale < 60
  const visibleRacks = useMemo(() => {
    const m = vb.w * 0.05
    return racks.filter((r) => { const f = rackFootprint(r); return f.maxX >= vb.x - m && f.minX <= vb.x + vb.w + m && f.maxY >= vb.y - m && f.minY <= vb.y + vb.h + m })
  }, [racks, vb])
  /** El rack que está debajo de un punto (el de arriba de todo si hay varios). */
  function rackAt(p: PlanPoint): PlanRack | null {
    for (let i = racks.length - 1; i >= 0; i--) {
      const f = rackFootprint(racks[i])
      if (p.x < f.minX || p.x > f.maxX || p.y < f.minY || p.y > f.maxY) continue
      if (pointInPolygon(p, f.corners)) return racks[i]
    }
    return null
  }
  const selectedRack = selection?.kind === 'rack' ? racks.find((r) => r.id === selection.id) ?? null : null
  const ghost = useMemo<PlanRack | null>(() => {
    if (tool !== 'rack' || !cursor) return null
    const config = useDesigner.getState().config
    const b = localBox(structureFor(config))
    const c = toPlanPoint({ x: 0, y: 0, rotation: ghostRot }, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2)
    const at = snapPt(cursor)
    return { id: 'ghost', x: at.x - c.x, y: at.y - c.y, rotation: ghostRot, config }
  }, [tool, cursor, ghostRot]) // eslint-disable-line react-hooks/exhaustive-deps -- snapPt depende de snap
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
  const isSel = (kind: string, key: string | number) => selection && selection.kind === kind && ('id' in selection ? selection.id : selection.index) === key

  const label = (at: PlanPoint, text: string, key: string, color = '#1f2328') => (
    <text key={key} x={at.x} y={at.y} fontSize={px(12)} textAnchor="middle" dominantBaseline="middle" fill={color}
      stroke="#fff" strokeWidth={px(4)} style={{ paintOrder: 'stroke', fontFamily: 'var(--f-mono)', fontWeight: 600, pointerEvents: 'none' }}>{text}</text>
  )

  // vista previa de lo que se está dibujando
  const last = draft[draft.length - 1]
  const preview = cursor && last && (tool === 'outline' || tool === 'wall') ? ortho(snapPt(cursor), last) : null

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
        </defs>

        {/* grilla */}
        <g>{grid.map(({ k, major, ...l }) => <line key={k} {...l} stroke={major ? '#cfd3d8' : '#e6e8eb'} strokeWidth={px(major ? 1 : 0.6)} />)}</g>

        {/* piso y paredes */}
        {es.length >= 3 && <>
          <path d={outlineD(plan)} fill="#fff" stroke="none" />
          {plan.zones.map((z) => (
            <g key={z.id} onPointerDown={(e) => { select({ kind: 'zone', id: z.id }); const p = toPlan(e.clientX, e.clientY); startDrag(e, { type: 'zone', id: z.id, dx: p.x - z.x, dy: p.y - z.y, started: false }) }}>
              <rect x={z.x} y={z.y} width={z.w} height={z.d} fill="url(#plan-hatch)" stroke={isSel('zone', z.id) ? RED : '#c98a93'} strokeWidth={px(isSel('zone', z.id) ? 2.5 : 1.2)} strokeDasharray={`${px(6)} ${px(4)}`} />
              {label({ x: z.x + z.w / 2, y: z.y + z.d / 2 }, z.name, `zl${z.id}`, RED)}
            </g>
          ))}
          <g>
            <RacksLayer racks={visibleRacks} conflicts={conflicts} skipId={selectedRack?.id ?? null} detail={detail} />
            {selectedRack && <RackShape rack={selectedRack} selected conflict={conflicts.has(selectedRack.id)} detail={detail} />}
            {ghost && <RackShape rack={ghost} selected={false} conflict={false} detail={detail} ghost />}
          </g>
          {es.map((e) => (
            <g key={`e${e.index}`}>
              <path d={edgeD(e)} fill="none" stroke={isSel('edge', e.index) ? RED : '#2b2e33'} strokeWidth={Math.max(plan.wallThickness, px(2))} strokeLinecap="square" />
              {tool === 'select' && <path d={edgeD(e)} fill="none" stroke="transparent" strokeWidth={px(16)} style={{ cursor: 'pointer' }}
                onPointerDown={(ev) => { ev.stopPropagation(); select({ kind: 'edge', index: e.index }) }} />}
            </g>
          ))}
        </>}

        {/* tabiques */}
        {plan.walls.map((w) => (
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
        {plan.doors.map((d) => {
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
        {plan.columns.map((c) => {
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

        {/* número de cada rack (al acercarse) */}
        {detail && visibleRacks.length <= 400 && visibleRacks.map((r) => {
          const n = racks.indexOf(r) + 1
          return label(rackFootprint(r).center, `R${n}`, `rl${r.id}`, conflicts.has(r.id) ? RED : '#7a1420')
        })}

        {/* medidas de cada pared */}
        {tool !== 'outline' && es.map((e) => {
          const m = apex(e)
          const dir = { x: m.x - centroid.x, y: m.y - centroid.y }
          const L = Math.hypot(dir.x, dir.y) || 1
          const at = { x: m.x + (dir.x / L) * px(16), y: m.y + (dir.y / L) * px(16) }
          return label(at, meters(edgeLength(e)), `el${e.index}`)
        })}

        {/* manijas (sólo con Seleccionar) */}
        {tool === 'select' && selection?.kind === 'edge' && es[selection.index] && (() => {
          const e = es[selection.index]
          const m = apex(e)
          return (
            <g>
              <circle cx={m.x} cy={m.y} r={px(8)} fill={RED} stroke="#fff" strokeWidth={px(2)} style={{ cursor: 'grab' }}
                onPointerDown={(ev) => startDrag(ev, { type: 'sag', index: e.index, started: false })} />
              {label({ x: m.x, y: m.y - px(20) }, 'arrastrá para curvar', 'hint-sag', RED)}
            </g>
          )
        })()}
        {tool === 'select' && plan.outline.points.map((p, i) => (
          <rect key={`v${i}`} x={p.x - px(6)} y={p.y - px(6)} width={px(12)} height={px(12)} rx={px(2)}
            fill={isSel('vertex', i) ? RED : '#fff'} stroke={RED} strokeWidth={px(2)} style={{ cursor: 'grab' }}
            onPointerDown={(e) => { select({ kind: 'vertex', index: i }); startDrag(e, { type: 'vertex', index: i, started: false }) }} />
        ))}

        {/* dibujo en curso */}
        {draft.length > 0 && <>
          <polyline points={[...draft, ...(preview ? [preview] : [])].map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={RED} strokeWidth={px(2.5)} strokeDasharray={`${px(8)} ${px(5)}`} />
          {draft.map((p, i) => <circle key={`d${i}`} cx={p.x} cy={p.y} r={px(i === 0 && tool === 'outline' ? 8 : 5)} fill={i === 0 && tool === 'outline' ? RED : '#fff'} stroke={RED} strokeWidth={px(2)} />)}
          {preview && label({ x: (last.x + preview.x) / 2, y: (last.y + preview.y) / 2 - px(14) }, meters(Math.hypot(preview.x - last.x, preview.y - last.y)), 'draft-len', RED)}
        </>}
        {cursor && tool !== 'select' && <circle cx={snapPt(cursor).x} cy={snapPt(cursor).y} r={px(3)} fill={RED} pointerEvents="none" />}
      </svg>
      <div className="plan-editor__coords" aria-hidden>{cursor ? `x ${meters(cursor.x)} · y ${meters(cursor.y)}` : 'Grilla con imán de 10 cm · Alt para mover libre'}{tool === 'rack' ? ' · R para girar' : ''}</div>
    </div>
  )
}

/**
 * Un rack en el plano: cada fila como una banda y, al acercarse, la división de módulos.
 * Se dibuja en sus coordenadas locales dentro de translate + rotate; los trazos no escalan
 * con el zoom (vector-effect), así no hace falta redibujarlo al acercar o alejar.
 */
const RackShape = memo(function RackShape({ rack, selected, conflict, detail, onDown, ghost }: {
  rack: PlanRack; selected: boolean; conflict: boolean; detail: boolean; ghost?: boolean; onDown?: (e: React.PointerEvent, r: PlanRack) => void
}) {
  const s = structureFor(rack.config)
  const bands = rowBands(s)
  const stroke = conflict ? RED : selected ? '#7a1420' : ghost ? RED : '#a3283a'
  const fill = conflict ? 'rgba(190,30,48,.22)' : selected ? '#f3b8c0' : ghost ? 'rgba(190,30,48,.12)' : '#f8dde1'
  return (
    <g transform={`translate(${rack.x} ${rack.y}) rotate(${rack.rotation})`} onPointerDown={onDown ? (e) => onDown(e, rack) : undefined}
      style={{ cursor: onDown ? 'move' : undefined, pointerEvents: ghost ? 'none' : undefined }} opacity={ghost ? 0.8 : 1}>
      {/* zona de clic de todo el rack (incluye la separación entre filas espalda con espalda) */}
      <rect x={0} y={Math.min(...bands.map((b) => b.v0))} width={s.totalWidth} height={Math.max(...bands.map((b) => b.v1)) - Math.min(...bands.map((b) => b.v0))} fill="transparent" />
      {bands.map((b) => (
        <rect key={b.index} x={0} y={b.v0} width={s.totalWidth} height={b.v1 - b.v0} fill={fill} stroke={stroke}
          strokeWidth={selected ? 2.5 : 1.2} vectorEffect="non-scaling-stroke" strokeDasharray={conflict || ghost ? '6 4' : undefined} />
      ))}
      {detail && bands.map((b) => b.frames.slice(1, -1).map((fx) => (
        <line key={`${b.index}-${fx}`} x1={fx} y1={b.v0} x2={fx} y2={b.v1} stroke={stroke} strokeWidth={0.8} strokeOpacity={0.7} vectorEffect="non-scaling-stroke" />
      )))}
      {/* frente de la primera fila: una línea más marcada indica hacia dónde mira el rack */}
      <line x1={0} y1={bands[0].v1} x2={s.totalWidth} y2={bands[0].v1} stroke={stroke} strokeWidth={selected ? 3.5 : 2} vectorEffect="non-scaling-stroke" />
    </g>
  )
})

/**
 * Todos los racks quietos en pocos trazos (uno para los normales, otro para los que tienen problemas,
 * los frentes y las divisiones de módulos). Con miles de racks el navegador dibuja 4 elementos en vez
 * de miles, y el arrastre sigue fluido. El rack elegido se dibuja aparte, encima.
 */
const bandsCache = new WeakMap<RackStructure, RowBand[]>()
const bandsOf = (s: RackStructure) => { let b = bandsCache.get(s); if (!b) bandsCache.set(s, (b = rowBands(s))); return b }

const RacksLayer = memo(function RacksLayer({ racks, conflicts, skipId, detail }: {
  racks: PlanRack[]; conflicts: Map<string, Set<ConflictReason>>; skipId: string | null; detail: boolean
}) {
  const d = useMemo(() => {
    const normal: string[] = [], bad: string[] = [], fronts: string[] = [], mods: string[] = []
    for (const r of racks) {
      if (r.id === skipId) continue
      const s = structureFor(r.config)
      const t = (r.rotation * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t)
      const P = (u: number, v: number) => `${Math.round(r.x + u * c - v * sn)} ${Math.round(r.y + u * sn + v * c)}`
      const W = s.totalWidth
      const out = conflicts.has(r.id) ? bad : normal
      const bands = bandsOf(s)
      for (const b of bands) {
        out.push(`M${P(0, b.v0)}L${P(W, b.v0)}L${P(W, b.v1)}L${P(0, b.v1)}Z`)
        if (detail) for (let i = 1; i < b.frames.length - 1; i++) mods.push(`M${P(b.frames[i], b.v0)}L${P(b.frames[i], b.v1)}`)
      }
      fronts.push(`M${P(0, bands[0].v1)}L${P(W, bands[0].v1)}`)
    }
    return { normal: normal.join(''), bad: bad.join(''), fronts: fronts.join(''), mods: mods.join('') }
  }, [racks, conflicts, skipId, detail])
  return (
    <g pointerEvents="none">
      {d.normal && <path d={d.normal} fill="#f8dde1" stroke="#a3283a" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
      {d.bad && <path d={d.bad} fill="rgba(190,30,48,.22)" stroke={RED} strokeWidth={1.4} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
      {d.mods && <path d={d.mods} fill="none" stroke="#a3283a" strokeOpacity={0.7} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />}
      {d.fronts && <path d={d.fronts} fill="none" stroke="#a3283a" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    </g>
  )
})
