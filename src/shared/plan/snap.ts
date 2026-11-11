/**
 * IMÁN A OBJETOS (como el "OSNAP" de AutoCAD): al dibujar, medir o acotar, el clic se pega a la
 * esquina, la punta, el medio o el centro más cercano (paredes, tabiques, columnas, zonas, racks).
 */
import { edges, midpoint } from './geometry'
import { placementRect } from './layout'
import type { Plan, PlanPoint, RackPlacement } from './types'

export type SnapKind = 'esquina' | 'medio' | 'centro' | 'punta'
export interface SnapPoint extends PlanPoint { kind: SnapKind }

const rectPoints = (x: number, y: number, w: number, h: number, out: SnapPoint[]) => {
  out.push({ x, y, kind: 'esquina' }, { x: x + w, y, kind: 'esquina' }, { x: x + w, y: y + h, kind: 'esquina' }, { x, y: y + h, kind: 'esquina' })
  out.push({ x: x + w / 2, y, kind: 'medio' }, { x: x + w, y: y + h / 2, kind: 'medio' }, { x: x + w / 2, y: y + h, kind: 'medio' }, { x, y: y + h / 2, kind: 'medio' })
}

/** Todos los puntos a los que se puede pegar el cursor. */
export function snapPoints(plan: Plan, racks: RackPlacement[] = []): SnapPoint[] {
  const out: SnapPoint[] = []
  for (const e of edges(plan.outline)) {
    out.push({ ...e.a, kind: 'esquina' })
    if (!e.sag) out.push({ ...midpoint(e.a, e.b), kind: 'medio' })
  }
  for (const w of plan.walls) out.push({ ...w.a, kind: 'punta' }, { ...w.b, kind: 'punta' }, { ...midpoint(w.a, w.b), kind: 'medio' })
  for (const c of plan.columns) {
    out.push({ x: c.x, y: c.y, kind: 'centro' })
    if (c.shape === 'rect') rectPoints(c.x - c.w / 2, c.y - c.d / 2, c.w, c.d, out)
  }
  for (const z of [...plan.zones, ...(plan.rackAreas ?? []), ...(plan.aisles ?? [])]) rectPoints(z.x, z.y, z.w, z.d, out)
  for (const r of racks) { const b = placementRect(r); rectPoints(b.x, b.y, b.w, b.h, out) }
  for (const d of plan.dims ?? []) out.push({ ...d.a, kind: 'punta' }, { ...d.b, kind: 'punta' })
  for (const s of plan.symbols ?? []) out.push({ x: s.x, y: s.y, kind: 'centro' })
  return out
}

/** El punto de imán más cercano a `p` dentro de `tol` (mm), o null. Las esquinas y puntas ganan a los medios. */
export function nearestSnap(points: SnapPoint[], p: PlanPoint, tol: number): SnapPoint | null {
  let best: SnapPoint | null = null, bestD = Infinity
  for (const q of points) {
    const d = Math.hypot(q.x - p.x, q.y - p.y) * (q.kind === 'medio' ? 1.25 : 1)
    if (d < bestD && d <= tol) { best = q; bestD = d }
  }
  return best
}
