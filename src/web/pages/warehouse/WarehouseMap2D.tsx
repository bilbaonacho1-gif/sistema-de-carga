/**
 * Plano del almacén visto desde arriba (SVG en milímetros reales).
 * Zoom con la rueda o pellizcando; se mueve arrastrando con el mouse o el dedo.
 * Cada rack muestra sus columnas de posiciones coloreadas por ocupación.
 */
import { Maximize, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { calculateRackStructure } from '../../../shared/rack/calculateRackStructure'
import type { RackPosition, RackSummary, WarehouseMap } from '../../../shared/types'
import { fmt } from '../../lib/format'

interface Props {
  map: WarehouseMap
  positions: RackPosition[]
  selectedRack: number | null
  selectedAisle: string | null
  selectedZone: string | null
  onRack(id: number): void
  onAisle(aisle: string): void
  onZone(code: string): void
}

interface Box { x: number; y: number; w: number; h: number }

export function WarehouseMap2D({ map, positions, selectedRack, selectedAisle, selectedZone, onRack, onAisle, onZone }: Props) {
  const { warehouse: wh } = map
  const wrap = useRef<HTMLDivElement>(null)
  const [vb, setVb] = useState<Box>({ x: 0, y: 0, w: wh.lengthMm, h: wh.widthMm })
  const moved = useRef(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ vb: Box; cx: number; cy: number; dist: number } | null>(null)

  /** Encuadra todo el almacén respetando la proporción del contenedor. */
  const fit = useCallback(() => {
    const el = wrap.current
    if (!el) return
    const aspect = el.clientHeight / Math.max(el.clientWidth, 1)
    const margin = 1200
    let w = wh.lengthMm + margin * 2
    let h = w * aspect
    if (h < wh.widthMm + margin * 2) { h = wh.widthMm + margin * 2; w = h / aspect }
    setVb({ x: wh.lengthMm / 2 - w / 2, y: wh.widthMm / 2 - h / 2, w, h })
  }, [wh.lengthMm, wh.widthMm])

  useEffect(() => {
    fit()
    const ro = new ResizeObserver(() => fit())
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [fit])

  const toWorld = (clientX: number, clientY: number, box = vb) => {
    const r = wrap.current!.getBoundingClientRect()
    return { x: box.x + ((clientX - r.left) / r.width) * box.w, y: box.y + ((clientY - r.top) / r.height) * box.h }
  }

  const zoomAt = (factor: number, cx: number, cy: number, box = vb) => {
    const minW = 3000
    const maxW = wh.lengthMm * 3
    const w = Math.min(maxW, Math.max(minW, box.w * factor))
    const k = w / box.w
    const p = toWorld(cx, cy, box)
    return { x: p.x - (p.x - box.x) * k, y: p.y - (p.y - box.y) * k, w, h: box.h * k }
  }

  // rueda: zoom alrededor del cursor (listener no pasivo para poder frenar el scroll)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setVb((b) => zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY, b))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const onPointerDown = (e: RPointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved.current = false
    const pts = [...pointers.current.values()]
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0
    gesture.current = { vb, cx, cy, dist }
  }

  const onPointerMove = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    const pts = [...pointers.current.values()]
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    if (Math.hypot(cx - g.cx, cy - g.cy) > 5 || pts.length > 1) moved.current = true
    if (!moved.current) return
    const r = wrap.current!.getBoundingClientRect()
    let box = { ...g.vb, x: g.vb.x - ((cx - g.cx) / r.width) * g.vb.w, y: g.vb.y - ((cy - g.cy) / r.height) * g.vb.h }
    if (pts.length > 1 && g.dist) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      box = zoomAt(g.dist / dist, cx, cy, box)
    }
    setVb(box)
  }

  const onPointerUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId)
    // al soltar un dedo del pellizco, se reinicia el gesto con el que queda
    if (pointers.current.size) {
      const [p] = [...pointers.current.values()]
      gesture.current = { vb, cx: p.x, cy: p.y, dist: 0 }
    } else gesture.current = null
  }

  /** Si hubo arrastre, el "clic" del final no selecciona nada. */
  const click = (fn: () => void) => () => { if (!moved.current) fn() }

  const byRack = useMemo(() => {
    const m = new Map<number, RackPosition[]>()
    for (const p of positions) m.set(p.rackId, [...(m.get(p.rackId) ?? []), p])
    return m
  }, [positions])

  const aisleRows = useMemo(() => {
    const rows = new Map<string, { x0: number; x1: number; y: number }>()
    for (const r of map.racks) {
      const a = rows.get(r.aisle)
      rows.set(r.aisle, { x0: Math.min(a?.x0 ?? Infinity, r.x), x1: Math.max(a?.x1 ?? -Infinity, r.x + r.lengthMm), y: Math.min(a?.y ?? Infinity, r.y) })
    }
    return rows
  }, [map.racks])

  const font = Math.max(260, vb.w / 70)

  return (
    <div className="map2d" ref={wrap}>
      <svg
        className="map2d__svg"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => setVb((b) => zoomAt(0.6, e.clientX, e.clientY, b))}
        role="img"
        aria-label={`Plano del ${wh.name}`}
      >
        <defs>
          <pattern id="grid-5m" width="5000" height="5000" patternUnits="userSpaceOnUse">
            <path d="M5000 0H0V5000" fill="none" stroke="#e1e4e8" strokeWidth={vb.w / 900} />
          </pattern>
          <pattern id="hatch" width="400" height="400" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="400" stroke="#d8dbe0" strokeWidth="120" />
          </pattern>
        </defs>

        {/* nave */}
        <rect x={0} y={0} width={wh.lengthMm} height={wh.widthMm} fill="#fbfbfc" />
        <rect x={0} y={0} width={wh.lengthMm} height={wh.widthMm} fill="url(#grid-5m)" />
        <rect x={0} y={0} width={wh.lengthMm} height={wh.widthMm} fill="none" stroke="#353535" strokeWidth={Math.max(80, vb.w / 300)} />
        <text x={0} y={-font * 0.8} className="map2d__title" fontSize={font * 1.1}>{wh.name.toUpperCase()} · {fmt(wh.lengthMm / 1000)} × {fmt(wh.widthMm / 1000)} m</text>

        {/* zonas de piso */}
        {map.zones.map((z) => (
          <g key={z.id} className={`map2d__zone${selectedZone === z.code ? ' is-selected' : ''}`} onClick={click(() => onZone(z.code))}>
            <rect x={z.x} y={z.y} width={z.w} height={z.h} fill="url(#hatch)" />
            <rect x={z.x} y={z.y} width={z.w} height={z.h} className="map2d__zone-frame" strokeWidth={vb.w / 500} />
            <text x={z.x + z.w / 2} y={z.y + z.h / 2} fontSize={font * 1.05} textAnchor="middle" dominantBaseline="middle" className="map2d__zone-label">{z.name.toUpperCase()}</text>
            {z.units > 0 && <text x={z.x + z.w / 2} y={z.y + z.h / 2 + font * 1.3} fontSize={font * 0.8} textAnchor="middle" className="map2d__zone-units">{fmt(z.units)} u. por ubicar</text>}
          </g>
        ))}

        {/* pasillos */}
        {[...aisleRows.entries()].map(([aisle, row]) => (
          <g key={aisle} className={`map2d__aisle${selectedAisle === aisle ? ' is-selected' : ''}`} onClick={click(() => onAisle(aisle))}>
            <rect x={row.x0} y={row.y - 2700} width={row.x1 - row.x0} height={2400} rx={300} className="map2d__aisle-band" />
            <text x={(row.x0 + row.x1) / 2} y={row.y - 1500} fontSize={font * 1.05} textAnchor="middle" dominantBaseline="middle" className="map2d__aisle-label">PASILLO {aisle}</text>
          </g>
        ))}

        {/* racks */}
        {map.racks.map((r) => (
          <RackShape key={r.id} rack={r} positions={byRack.get(r.id) ?? []} selected={selectedRack === r.id}
            dimmed={!!selectedAisle && selectedAisle !== r.aisle} font={font} onClick={click(() => onRack(r.id))} stroke={vb.w / 700} />
        ))}
      </svg>

      <div className="map2d__controls" role="group" aria-label="Zoom">
        <button type="button" onClick={() => { const r = wrap.current!.getBoundingClientRect(); setVb((b) => zoomAt(0.7, r.left + r.width / 2, r.top + r.height / 2, b)) }} aria-label="Acercar"><Plus size={18} /></button>
        <button type="button" onClick={() => { const r = wrap.current!.getBoundingClientRect(); setVb((b) => zoomAt(1.4, r.left + r.width / 2, r.top + r.height / 2, b)) }} aria-label="Alejar"><Minus size={18} /></button>
        <button type="button" onClick={fit} aria-label="Ver todo el almacén"><Maximize size={17} /></button>
      </div>
    </div>
  )
}

function RackShape({ rack: r, positions, selected, dimmed, font, onClick, stroke }: {
  rack: RackSummary; positions: RackPosition[]; selected: boolean; dimmed: boolean; font: number; onClick(): void; stroke: number
}) {
  const s = useMemo(() => calculateRackStructure(r.config), [r.config])
  const frames = s.rows[0]?.frames ?? []
  const cols: { x: number; w: number; occupied: number; reserved: number }[] = []
  const front = s.pallet.front
  for (const p of s.positions.filter((p) => p.row === 0 && p.level === 0)) {
    const mine = positions.filter((q) => q.module === p.module + 1 && q.slot === p.slot + 1)
    cols.push({
      x: p.x - front / 2, w: front,
      occupied: mine.filter((q) => q.status !== 'libre').length / Math.max(r.levels, 1),
      reserved: mine.filter((q) => q.status === 'reservado' || q.status === 'parcial').length,
    })
  }
  const pct = r.positions ? Math.round((r.occupied / r.positions) * 100) : 0
  return (
    <g className={`map2d__rack${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`} onClick={onClick} role="button" aria-label={`Rack ${r.code}: ${r.occupied} de ${r.positions} posiciones ocupadas`}>
      <rect x={r.x} y={r.y} width={r.lengthMm} height={r.depthMm} className="map2d__rack-body" strokeWidth={stroke * (selected ? 3 : 1.2)} />
      {cols.map((c, i) => (
        <rect key={i} x={r.x + c.x} y={r.y + r.depthMm * 0.12} width={c.w} height={r.depthMm * 0.76}
          fill={c.occupied ? `rgba(46,158,85,${0.18 + c.occupied * 0.72})` : '#ffffff'} stroke={c.reserved ? '#2f80c0' : '#c9cdd2'} strokeWidth={stroke * (c.reserved ? 1.6 : 0.6)} />
      ))}
      {frames.map((f) => <rect key={f.id} x={r.x + f.x - 40} y={r.y} width={80} height={r.depthMm} fill="#5c6269" />)}
      <text x={r.x + r.lengthMm / 2} y={r.y + r.depthMm + font * 1.05} fontSize={font * 0.95} textAnchor="middle" className="map2d__rack-code">{r.code}</text>
      <text x={r.x + r.lengthMm / 2} y={r.y + r.depthMm + font * 2.05} fontSize={font * 0.72} textAnchor="middle" className="map2d__rack-pct">{r.occupied}/{r.positions} · {pct}%</text>
    </g>
  )
}
