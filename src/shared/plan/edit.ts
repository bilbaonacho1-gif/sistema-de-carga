/**
 * Operaciones sobre el plano (funciones puras: reciben un plano y devuelven otro).
 * Las usa el editor; al no tocar el plano original, deshacer/rehacer es guardar copias.
 */
import { arcOf, edges, leftNormal, midpoint, outlinePolygon, pointInPolygon } from './geometry'
import type { Plan, PlanColumn, PlanDoor, PlanPoint } from './types'

let seq = 0
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`

/** Reemplaza el contorno (los portones quedaban sobre paredes que ya no existen). */
export function setOutline(plan: Plan, points: PlanPoint[]): Plan {
  return { ...plan, outline: { points, sags: points.map(() => 0) }, doors: [] }
}

export function moveVertex(plan: Plan, i: number, p: PlanPoint): Plan {
  const points = plan.outline.points.map((q, j) => (j === i ? p : q))
  return { ...plan, outline: { ...plan.outline, points } }
}

/** Flecha de la pared i a partir de un punto arrastrado (el medio del arco sigue al mouse). */
export function sagFromPoint(plan: Plan, i: number, p: PlanPoint): number {
  const e = edges(plan.outline)[i]
  const m = midpoint(e.a, e.b)
  const n = leftNormal(e.a, e.b)
  const sag = (p.x - m.x) * n.x + (p.y - m.y) * n.y
  const half = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) / 2
  // hasta medio círculo; muy chica = recta
  const limited = Math.max(-half, Math.min(half, sag))
  return Math.abs(limited) < 20 ? 0 : Math.round(limited)
}

export function setSag(plan: Plan, i: number, sag: number): Plan {
  const sags = plan.outline.sags.map((s, j) => (j === i ? sag : s))
  return { ...plan, outline: { ...plan.outline, sags } }
}

/** Cambia el largo de una pared recta moviendo su punto final (como en un CAD). */
export function setEdgeLength(plan: Plan, i: number, length: number): Plan {
  const e = edges(plan.outline)[i]
  const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1
  const k = length / L
  const end = { x: Math.round(e.a.x + (e.b.x - e.a.x) * k), y: Math.round(e.a.y + (e.b.y - e.a.y) * k) }
  return moveVertex(plan, (i + 1) % plan.outline.points.length, end)
}

/** Parte la pared i en dos con un punto nuevo en su medio (si es curva, quedan dos arcos). */
export function splitEdge(plan: Plan, i: number): Plan {
  const e = edges(plan.outline)[i]
  const arc = arcOf(e)
  let mid: PlanPoint, halfSag = 0
  if (arc) {
    const a = arc.start + arc.sweep / 2
    mid = { x: arc.center.x + arc.radius * Math.cos(a), y: arc.center.y + arc.radius * Math.sin(a) }
    halfSag = Math.sign(e.sag) * arc.radius * (1 - Math.cos(Math.abs(arc.sweep) / 4))
  } else {
    mid = midpoint(e.a, e.b)
  }
  mid = { x: Math.round(mid.x), y: Math.round(mid.y) }
  const points = [...plan.outline.points.slice(0, i + 1), mid, ...plan.outline.points.slice(i + 1)]
  const sags = [...plan.outline.sags.slice(0, i), halfSag, halfSag, ...plan.outline.sags.slice(i + 1)]
  const doors: PlanDoor[] = plan.doors.map((d) => {
    if (d.edge < i) return d
    if (d.edge > i) return { ...d, edge: d.edge + 1 }
    return d.t < 0.5 ? { ...d, t: d.t * 2 } : { ...d, edge: i + 1, t: (d.t - 0.5) * 2 }
  })
  return { ...plan, outline: { points, sags }, doors }
}

/** Quita un punto del contorno (quedan al menos 3). Las dos paredes vecinas se unen en una recta. */
export function removeVertex(plan: Plan, i: number): Plan {
  const n = plan.outline.points.length
  if (n <= 3) return plan
  const prev = (i - 1 + n) % n
  const points = plan.outline.points.filter((_, j) => j !== i)
  const sags = plan.outline.sags.map((s, j) => (j === prev ? 0 : s)).filter((_, j) => j !== i)
  const doors = plan.doors
    .filter((d) => d.edge !== i && d.edge !== prev)
    .map((d) => (d.edge > i ? { ...d, edge: d.edge - 1 } : d))
  return { ...plan, outline: { points, sags }, doors }
}

/**
 * Grilla de columnas: una cada `dx` × `dy` mm, empezando a `dx` y `dy` del borde y sólo
 * dentro del contorno. Reemplaza las columnas que había.
 */
export function columnGrid(plan: Plan, dx: number, dy: number, size: number): Plan {
  const poly = outlinePolygon(plan.outline, 100)
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const columns: PlanColumn[] = []
  if (dx < 1000 || dy < 1000) return plan
  for (let x = x0 + dx; x < x1 - size; x += dx)
    for (let y = y0 + dy; y < y1 - size; y += dy)
      if (pointInPolygon({ x, y }, poly))
        columns.push({ id: newId('c'), x: Math.round(x), y: Math.round(y), shape: 'rect', w: size, d: size })
  return { ...plan, columns }
}

/** Columnas, tabiques y zonas que quedaron fuera del contorno (por ejemplo, después de redibujarlo). */
export function itemsOutside(plan: Plan): Set<string> {
  const poly = outlinePolygon(plan.outline, 100)
  const out = new Set<string>()
  for (const c of plan.columns) if (!pointInPolygon(c, poly)) out.add(c.id)
  for (const w of plan.walls) if (!pointInPolygon(midpoint(w.a, w.b), poly)) out.add(w.id)
  for (const z of plan.zones) if (!pointInPolygon({ x: z.x + z.w / 2, y: z.y + z.d / 2 }, poly)) out.add(z.id)
  return out
}

export function removeOutside(plan: Plan): Plan {
  const out = itemsOutside(plan)
  return {
    ...plan,
    columns: plan.columns.filter((x) => !out.has(x.id)),
    walls: plan.walls.filter((x) => !out.has(x.id)),
    zones: plan.zones.filter((x) => !out.has(x.id)),
  }
}

/** Borra lo seleccionado. */
export function removeItem(plan: Plan, kind: 'column' | 'wall' | 'door' | 'zone' | 'rack', id: string): Plan {
  switch (kind) {
    case 'column': return { ...plan, columns: plan.columns.filter((x) => x.id !== id) }
    case 'wall': return { ...plan, walls: plan.walls.filter((x) => x.id !== id) }
    case 'door': return { ...plan, doors: plan.doors.filter((x) => x.id !== id) }
    case 'zone': return { ...plan, zones: plan.zones.filter((x) => x.id !== id) }
    case 'rack': return { ...plan, racks: (plan.racks ?? []).filter((x) => x.id !== id) }
  }
}
