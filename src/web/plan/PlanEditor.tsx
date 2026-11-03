/**
 * EDITOR DEL PLANO (vista de arriba, SVG en milímetros).
 *  - Seleccionar: arrastrar puntos, columnas, zonas, tabiques y portones. Tocando una pared
 *    aparece su manija del medio: arrastrándola la pared se curva. Doble clic agrega un punto.
 *  - Contorno: clic punto por punto; se cierra tocando el primero (o Enter).
 *  - Tabique: clic en cada extremo (encadena el siguiente; Esc termina).
 *  - Columna / Portón / Zona: clic donde va.
 *  - Racks (si están a la vista): se arrastran igual; Supr los borra.
 * Rueda o pellizco: zoom. Arrastrar el fondo: mover. Ctrl+Z / Ctrl+Y: deshacer / rehacer.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { itemsOutside, moveVertex, newId, removeItem, removeVertex, sagFromPoint, setOutline, splitEdge } from '../../shared/plan/edit'
import { apex, arcOf, edgeLength, edges, nearestOnEdge, planBounds, pointOnEdge, tangentOnEdge, type Edge } from '../../shared/plan/geometry'
import type { Plan, PlanPoint } from '../../shared/plan/types'
import type { RackModuleSize, RackPlacement } from '../../shared/plan/layout'
import { freezeRacks, moveRack } from '../../shared/plan/racks'
import { PlanCotas } from './PlanCotas'
import { PlanRacks } from './PlanRacks'
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

function fitView(plan: Plan, aspect: number): VB {
  const b = planBounds(plan)
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
  const { plan, tool, selection, draft, snap, showCotas, commit, begin, live, select, setDraft, setTool } = usePlan()
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [vb, setVb] = useState<VB>(() => fitView(plan, 4 / 3))
  const [cursor, setCursor] = useState<PlanPoint | null>(null)
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
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = s.selection
        if (!sel) return
        e.preventDefault()
        if (sel.kind === 'vertex') s.commit((p) => removeVertex(p, sel.index))
        else if (sel.kind === 'rack') s.commit((p) => removeItem(freezeRacks(p, layerRef.current?.racks ?? []), 'rack', sel.id))
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
    if (e.button === 1 || tool === 'select') {
      drag.current = { type: 'pan', cx: e.clientX, cy: e.clientY, vb, moved: false }
      return
    }
    const last = draft[draft.length - 1]
    const p = ortho(snapPt(raw, e.altKey), last)
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
      case 'rack': live((pl) => moveRack(freezeRacks(pl, layerRef.current?.racks ?? []), d.id, sn(raw.x - d.dx, e.altKey), sn(raw.y - d.dy, e.altKey))); break
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
          {es.map((e) => (
            <g key={`e${e.index}`}>
              <path d={edgeD(e)} fill="none" stroke={isSel('edge', e.index) ? RED : '#2b2e33'} strokeWidth={Math.max(plan.wallThickness, px(2))} strokeLinecap="square" />
              {tool === 'select' && <path d={edgeD(e)} fill="none" stroke="transparent" strokeWidth={px(16)} style={{ cursor: 'pointer' }}
                onPointerDown={(ev) => { ev.stopPropagation(); select({ kind: 'edge', index: e.index }) }} />}
            </g>
          ))}
        </>}

        {/* racks ubicados */}
        {rackLayer && <PlanRacks racks={rackLayer.racks} size={rackLayer.size} px={px} issues={rackLayer.issues}
          selectedId={selection?.kind === 'rack' ? selection.id : undefined}
          onDown={tool === 'select' ? (e, r) => { select({ kind: 'rack', id: r.id }); const p = toPlan(e.clientX, e.clientY); startDrag(e, { type: 'rack', id: r.id, dx: p.x - r.x, dy: p.y - r.y, started: false }) } : undefined} />}

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

        {/* cotas (o, si están apagadas, el largo de cada pared) */}
        {showCotas && tool !== 'outline' && (
          <PlanCotas plan={plan} px={px} column={selection?.kind === 'column' ? plan.columns.find((c) => c.id === selection.id) : null} />
        )}
        {!showCotas && tool !== 'outline' && es.map((e) => {
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
      <div className="plan-editor__coords" aria-hidden>{cursor ? `x ${meters(cursor.x)} · y ${meters(cursor.y)}` : 'Grilla con imán de 10 cm · Alt para mover libre'}</div>
    </div>
  )
}
