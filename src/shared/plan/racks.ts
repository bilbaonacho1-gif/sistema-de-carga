/**
 * UBICACIÓN LIBRE DE RACKS: mover, girar, duplicar, cambiar módulos y avisar cuando un rack
 * se pisa con otro, con una columna, un tabique, una zona libre o un pasillo, o queda fuera del depósito.
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

/**
 * ¿El rectángulo queda dentro del contorno? Exacto y rápido (no depende del largo del rack): las 4
 * esquinas adentro, ninguna pared que cruce sus bordes y ningún vértice del contorno metido en él.
 * Se mira un poco hacia adentro, para que un rack apoyado justo sobre la línea de la pared no cuente.
 */
function rectInside(b: Rect, poly: PlanPoint[]): boolean {
  const x0 = b.x + TOL, x1 = b.x + b.w - TOL, y0 = b.y + TOL, y1 = b.y + b.h - TOL
  const corners = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
  if (corners.some((p) => !pointInPolygon(p, poly))) return false
  if (poly.some((v) => strictlyInside(v, b))) return false
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length]
    if (Math.max(a.x, c.x) < x0 || Math.min(a.x, c.x) > x1 || Math.max(a.y, c.y) < y0 || Math.min(a.y, c.y) > y1) continue
    for (let k = 0; k < 4; k++) if (segmentsCross(a, c, corners[k], corners[(k + 1) % 4])) return false
  }
  return true
}

function segmentsCross(p1: PlanPoint, p2: PlanPoint, q1: PlanPoint, q2: PlanPoint): boolean {
  const o = (a: PlanPoint, b: PlanPoint, c: PlanPoint) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
  const d1 = o(p1, p2, q1), d2 = o(p1, p2, q2), d3 = o(q1, q2, p1), d4 = o(q1, q2, p2)
  return d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0 && d1 !== d2 && d3 !== d4
}


/** Problemas de cada rack (id → motivo). Los que no tienen problemas no aparecen. */
export function rackIssues(plan: Plan, racks: RackPlacement[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (plan.outline.points.length < 3) return out
  const poly = outlinePolygon(plan.outline, 200)
  const rects = racks.map(placementRect)
  // grilla de 10 m: cada rack se compara sólo con los que caen en sus mismas celdas (miles de racks al instante)
  const CELL = 10_000
  const grid = new Map<string, number[]>()
  const cells = (b: Rect) => {
    const out: string[] = []
    for (let i = Math.floor(b.x / CELL); i <= Math.floor((b.x + b.w) / CELL); i++)
      for (let j = Math.floor(b.y / CELL); j <= Math.floor((b.y + b.h) / CELL); j++) out.push(`${i},${j}`)
    return out
  }
  rects.forEach((b, i) => { for (const c of cells(b)) (grid.get(c) ?? grid.set(c, []).get(c)!).push(i) })
  const neighbours = (b: Rect, i: number) => {
    const found = new Set<number>()
    for (const c of cells(b)) for (const j of grid.get(c) ?? []) if (j !== i) found.add(j)
    return found
  }
  racks.forEach((r, i) => {
    const b = rects[i]
    if (!rectInside(b, poly)) { out[r.id] = 'Queda fuera del depósito'; return }
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
    if ((plan.aisles ?? []).some((a) => overlap(b, { x: a.x, y: a.y, w: a.w, h: a.d }))) { out[r.id] = 'Pisa un pasillo'; return }
    for (const j of neighbours(b, i)) if (overlap(b, rects[j])) { out[r.id] = 'Se pisa con otro rack'; break }
  })
  return out
}
