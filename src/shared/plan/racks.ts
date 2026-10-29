/**
 * UBICACIÓN LIBRE DE RACKS: mover, girar, duplicar, cambiar módulos y avisar cuando un rack
 * se pisa con otro, con una columna, un tabique o una zona libre, o queda fuera del depósito.
 * La primera edición copia la distribución automática al plano (`plan.racks`).
 */
import { newId } from './edit'
import { outlinePolygon, pointInPolygon } from './geometry'
import { placementRect, type LayoutResult, type RackModuleSize } from './layout'
import type { Plan, PlanPoint, RackPlacement } from './types'

type Rect = { x: number; y: number; w: number; h: number }

/** Largo y profundidad de un rack según el módulo elegido (por si cambiaron las medidas del rack). */
export function fitPlacement(p: RackPlacement, size: RackModuleSize): RackPlacement {
  const modules = Math.max(1, Math.round(p.modules))
  return {
    ...p, modules,
    length: modules * size.width + (modules + 1) * size.upright,
    depth: p.pair ? 2 * size.depth + size.backToBackGap : size.depth,
  }
}

/** Resultado de distribución a partir de racks ubicados a mano. */
export function manualLayout(racks: RackPlacement[], size: RackModuleSize): LayoutResult {
  const placements = racks.map((r) => fitPlacement(r, size))
  return {
    placements,
    rows: placements.reduce((n, p) => n + (p.pair ? 2 : 1), 0),
    modules: placements.reduce((n, p) => n + p.modules * (p.pair ? 2 : 1), 0),
  }
}

/** El plano con los racks a mano: si todavía no hay, se copian los de la distribución automática. */
export function freezeRacks(plan: Plan, placements: RackPlacement[]): Plan {
  return plan.racks ? plan : { ...plan, racks: placements.map((p) => ({ ...p })) }
}

const mapRack = (plan: Plan, id: string, fn: (r: RackPlacement) => RackPlacement): Plan =>
  ({ ...plan, racks: (plan.racks ?? []).map((r) => (r.id === id ? fn(r) : r)) })

export function moveRack(plan: Plan, id: string, x: number, y: number): Plan {
  return mapRack(plan, id, (r) => ({ ...r, x: Math.round(x), y: Math.round(y) }))
}

/** Gira 90° sobre su centro. */
export function rotateRack(plan: Plan, id: string): Plan {
  return mapRack(plan, id, (r) => {
    const b = placementRect(r)
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    return { ...r, orientation: r.orientation === 'x' ? 'y' : 'x', x: Math.round(cx - b.h / 2), y: Math.round(cy - b.w / 2) }
  })
}

/** Copia al lado (del lado de la profundidad, dejando un pasillo). Devuelve el plano y el id nuevo. */
export function duplicateRack(plan: Plan, id: string, aisle: number): { plan: Plan; id: string } {
  const r = (plan.racks ?? []).find((x) => x.id === id)
  if (!r) return { plan, id }
  const nid = newId('r')
  const off = r.depth + aisle
  const copy = { ...r, id: nid, x: r.orientation === 'x' ? r.x : r.x + off, y: r.orientation === 'x' ? r.y + off : r.y }
  return { plan: { ...plan, racks: [...(plan.racks ?? []), copy] }, id: nid }
}

export function setRackModules(plan: Plan, id: string, modules: number): Plan {
  return mapRack(plan, id, (r) => ({ ...r, modules: Math.max(1, Math.min(120, Math.round(modules))) }))
}

export function setRackPair(plan: Plan, id: string, pair: boolean): Plan {
  return mapRack(plan, id, (r) => ({ ...r, pair }))
}

/** Rack nuevo en el centro del depósito. */
export function addRack(plan: Plan, size: RackModuleSize, modules = 5): { plan: Plan; id: string } {
  const pts = plan.outline.points
  const cx = pts.reduce((n, p) => n + p.x, 0) / Math.max(1, pts.length)
  const cy = pts.reduce((n, p) => n + p.y, 0) / Math.max(1, pts.length)
  const id = newId('r')
  const r = fitPlacement({ id, x: 0, y: 0, orientation: 'x', modules, length: 0, depth: 0, pair: false }, size)
  return { plan: { ...plan, racks: [...(plan.racks ?? []), { ...r, x: Math.round(cx - r.length / 2), y: Math.round(cy - r.depth / 2) }] }, id }
}

/* ------------------------------ Interferencias ------------------------------ */

const TOL = 2 // mm: tocarse no es pisarse

function overlap(a: Rect, b: Rect): boolean {
  return a.x + TOL < b.x + b.w && b.x + TOL < a.x + a.w && a.y + TOL < b.y + b.h && b.y + TOL < a.y + a.h
}

function strictlyInside(p: PlanPoint, b: Rect): boolean {
  return p.x > b.x + TOL && p.x < b.x + b.w - TOL && p.y > b.y + TOL && p.y < b.y + b.h - TOL
}

/** Puntos sobre el borde del rectángulo, cada ~500 mm. */
function perimeter(b: Rect): PlanPoint[] {
  // un poco hacia adentro, para que un rack apoyado justo sobre la línea de la pared no cuente
  const x0 = b.x + TOL, x1 = b.x + b.w - TOL, y0 = b.y + TOL, y1 = b.y + b.h - TOL
  const out: PlanPoint[] = []
  const nx = Math.max(1, Math.ceil(b.w / 500)), ny = Math.max(1, Math.ceil(b.h / 500))
  for (let i = 0; i <= nx; i++) { const x = x0 + ((x1 - x0) * i) / nx; out.push({ x, y: y0 }, { x, y: y1 }) }
  for (let j = 0; j <= ny; j++) { const y = y0 + ((y1 - y0) * j) / ny; out.push({ x: x0, y }, { x: x1, y }) }
  return out
}

/** Problemas de cada rack (id → motivo). Los que no tienen problemas no aparecen. */
export function rackIssues(plan: Plan, racks: RackPlacement[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (plan.outline.points.length < 3) return out
  const poly = outlinePolygon(plan.outline, 200)
  const rects = racks.map(placementRect)
  racks.forEach((r, i) => {
    const b = rects[i]
    if (perimeter(b).some((p) => !pointInPolygon(p, poly)) || poly.some((v) => strictlyInside(v, b))) { out[r.id] = 'Queda fuera del depósito'; return }
    if (plan.columns.some((c) => overlap(b, { x: c.x - c.w / 2, y: c.y - c.d / 2, w: c.w, h: c.d }))) { out[r.id] = 'Choca con una columna'; return }
    const hitsWall = plan.walls.some((w) => {
      const half = w.thickness / 2
      const grown = { x: b.x - half, y: b.y - half, w: b.w + 2 * half, h: b.h + 2 * half }
      const n = Math.max(1, Math.ceil(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) / 100))
      for (let k = 0; k <= n; k++) if (strictlyInside({ x: w.a.x + ((w.b.x - w.a.x) * k) / n, y: w.a.y + ((w.b.y - w.a.y) * k) / n }, grown)) return true
      return false
    })
    if (hitsWall) { out[r.id] = 'Choca con un tabique'; return }
    if (plan.zones.some((z) => overlap(b, { x: z.x, y: z.y, w: z.w, h: z.d }))) { out[r.id] = 'Pisa una zona libre'; return }
    if (rects.some((o, j) => j !== i && overlap(b, o))) out[r.id] = 'Se pisa con otro rack'
  })
  return out
}
