/**
 * LO QUE HACE QUE EL PLANO SE LEA FÁCIL (como un plano de AutoCAD, pero explicado):
 *  - el número de cada fila de racks (A1, A2… por zona de racks; 1, 2… si no hay zonas);
 *  - la medida de los pasillos entre filas;
 *  - las referencias (qué es cada color) y una escala gráfica.
 * Los números y pasillos aparecen recién cuando hay lugar para leerlos (al acercarse).
 */
import { useMemo, useState } from 'react'
import { placementRect, type RackPlacement } from '../../shared/plan/layout'
import type { Plan } from '../../shared/plan/types'
import { metros } from '../../shared/units'

const INK = '#1f5f8b'

/** Nombre de cada rack: letra de su zona (si hay) + número de fila. Un par lleva sus dos números. */
export function rackNames(racks: RackPlacement[]): Map<string, string> {
  const groups = new Map<string, RackPlacement[]>()
  for (const r of racks) {
    const zone = /^z(\d+)-/.exec(r.id)?.[1] ?? ''
    const g = groups.get(zone) ?? groups.set(zone, []).get(zone)!
    g.push(r)
  }
  const names = new Map<string, string>()
  for (const [zone, g] of groups) {
    const letter = zone ? String.fromCharCode(64 + Math.min(26, Number(zone))) : ''
    // de arriba hacia abajo (o de izquierda a derecha para filas verticales); en la misma fila, de izquierda a derecha
    g.sort((a, b) => (a.orientation === 'x' ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y))
    let n = 1, lastBand: number | null = null, lastPair = false
    for (const r of g) {
      const band = r.orientation === 'x' ? r.y : r.x
      if (lastBand !== null && Math.abs(band - lastBand) > 1) n += lastPair ? 2 : 1
      lastBand = band; lastPair = r.pair
      names.set(r.id, r.pair ? `${letter}${n}-${n + 1}` : `${letter}${n}`)
    }
  }
  return names
}

interface Gap { x1: number; y1: number; x2: number; y2: number; value: number; vertical: boolean }

/** Pasillos entre filas vecinas (uno por par de filas, en el comienzo del tramo que comparten). */
function aisleGaps(racks: RackPlacement[]): Gap[] {
  const out: Gap[] = []
  const seen = new Set<string>()
  for (const orient of ['x', 'y'] as const) {
    const g = racks.filter((r) => r.orientation === orient).map((r) => ({ r, b: placementRect(r) }))
    // filas a lo largo de X: el vecino está más abajo; a lo largo de Y, más a la derecha
    const across = (b: { x: number; y: number }) => (orient === 'x' ? b.y : b.x)
    g.sort((a, b) => across(a.b) - across(b.b))
    for (let i = 0; i < g.length; i++) {
      const A = g[i].b
      const aEnd = orient === 'x' ? A.y + A.h : A.x + A.w
      let best: { b: typeof A; gap: number } | null = null
      for (let j = i + 1; j < g.length; j++) {
        const B = g[j].b
        const gap = across(B) - aEnd
        if (gap > 12_000) break
        if (gap < 400) continue
        const overlap = orient === 'x' ? Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) : Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y)
        if (overlap > 1000 && (!best || gap < best.gap)) best = { b: B, gap }
      }
      if (!best) continue
      const B = best.b
      const start = orient === 'x' ? Math.max(A.x, B.x) : Math.max(A.y, B.y)
      const key = `${orient}${Math.round(aEnd)}:${Math.round(across(B))}`
      if (seen.has(key)) continue
      seen.add(key)
      const at = start + 1500
      out.push(orient === 'x'
        ? { x1: at, y1: aEnd, x2: at, y2: aEnd + best.gap, value: best.gap, vertical: true }
        : { x1: aEnd, y1: at, x2: aEnd + best.gap, y2: at, value: best.gap, vertical: false })
    }
  }
  return out
}

/** Números de fila y medidas de pasillo, sobre el plano (SVG en mm). */
export function PlanRackNotes({ racks, px }: { racks: RackPlacement[]; px: (n: number) => number }) {
  const names = useMemo(() => rackNames(racks), [racks])
  const gaps = useMemo(() => aisleGaps(racks), [racks])
  const mmPerPx = px(1)
  if (!racks.length) return null
  const depth = racks[0].pair ? racks[0].depth / 2 : racks[0].depth
  // los números entran cuando una fila mide al menos ~9 px de ancho en pantalla
  const showNames = depth / mmPerPx >= 9
  const font = Math.min(px(11), depth * 0.9)
  return (
    <g pointerEvents="none" style={{ fontFamily: 'var(--f-mono)', fontWeight: 700 }}>
      {showNames && racks.map((r) => {
        const b = placementRect(r)
        const name = names.get(r.id)
        return r.orientation === 'x'
          ? <text key={r.id} x={b.x - px(5)} y={b.y + b.h / 2} fontSize={font} textAnchor="end" dominantBaseline="middle" fill="#9a4a0c">{name}</text>
          : <text key={r.id} x={b.x + b.w / 2} y={b.y - px(5)} fontSize={font} textAnchor="middle" fill="#9a4a0c">{name}</text>
      })}
      {gaps.filter((g) => g.value / mmPerPx >= 16).map((g, i) => {
        const tick = px(3)
        const mx = (g.x1 + g.x2) / 2, my = (g.y1 + g.y2) / 2
        return (
          <g key={i}>
            <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={INK} strokeWidth={px(1)} />
            {g.vertical
              ? <><line x1={g.x1 - tick} y1={g.y1} x2={g.x1 + tick} y2={g.y1} stroke={INK} strokeWidth={px(1)} /><line x1={g.x2 - tick} y1={g.y2} x2={g.x2 + tick} y2={g.y2} stroke={INK} strokeWidth={px(1)} /></>
              : <><line x1={g.x1} y1={g.y1 - tick} x2={g.x1} y2={g.y1 + tick} stroke={INK} strokeWidth={px(1)} /><line x1={g.x2} y1={g.y2 - tick} x2={g.x2} y2={g.y2 + tick} stroke={INK} strokeWidth={px(1)} /></>}
            <text x={g.vertical ? mx + px(6) : mx} y={g.vertical ? my : my - px(6)} fontSize={px(10.5)} textAnchor={g.vertical ? 'start' : 'middle'} dominantBaseline="middle"
              fill={INK} stroke="#fff" strokeWidth={px(3)} style={{ paintOrder: 'stroke' }}>{`pasillo ${metros(g.value)}`}</text>
          </g>
        )
      })}
    </g>
  )
}

/** Escala gráfica: una barra de medida redonda (1, 2, 5, 10, 20, 50… m) de unos 100 px. */
export function ScaleBar({ mmPerPx }: { mmPerPx: number }) {
  const target = mmPerPx * 110
  const nice = [1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000].find((v) => v >= target * 0.6) ?? 1_000_000
  const w = nice / mmPerPx
  return (
    <div className="scale-bar" aria-label={`Escala: la barra mide ${metros(nice)}`}>
      <span className="scale-bar__bar" style={{ width: w }}><i /><i /></span>
      <span className="scale-bar__t" style={{ left: 0 }}>0</span><span className="scale-bar__t" style={{ left: w }}>{metros(nice)}</span>
    </div>
  )
}

/** Referencias: qué es cada cosa del plano (sólo lo que hay en este plano). */
export function Legend({ plan, racks, issues }: { plan: Plan; racks: boolean; issues: boolean }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('sdc-legend') !== '0' } catch { return true } })
  const toggle = () => { setOpen(!open); try { localStorage.setItem('sdc-legend', open ? '0' : '1') } catch { /* sin memoria */ } }
  const items: [string, string][] = [
    ...(racks ? [['rack', 'Rack (fila con su número)'] as [string, string]] : []),
    ...(issues ? [['rack-bad', 'Rack con problema'] as [string, string]] : []),
    ...(plan.rackAreas?.length ? [['area', 'Zona de racks'] as [string, string]] : []),
    ...(plan.aisles?.length ? [['aisle', 'Pasillo marcado'] as [string, string]] : []),
    ...(plan.zones.length ? [['zone', 'Zona libre (sin racks)'] as [string, string]] : []),
    ...(plan.columns.length ? [['column', 'Columna'] as [string, string]] : []),
    ...(plan.walls.length ? [['wall', 'Tabique'] as [string, string]] : []),
    ...(plan.doors.length ? [['door', 'Portón'] as [string, string]] : []),
    ['cota', 'Medida (tocala para cambiarla)'],
  ]
  return (
    <div className={`plan-legend${open ? ' is-open' : ''}`}>
      <button type="button" className="plan-legend__head" onClick={toggle} aria-expanded={open}>Referencias {open ? '▾' : '▸'}</button>
      {open && <ul>{items.map(([k, t]) => <li key={k}><span className={`plan-legend__sw plan-legend__sw--${k}`} aria-hidden />{t}</li>)}</ul>}
    </div>
  )
}
