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

/**
 * Cambia el largo de una pared recta moviendo su punto final (como en un CAD). Si la pared siguiente
 * es perpendicular, se corre entera (paralela a sí misma): así un rectángulo sigue siendo rectángulo.
 */
export function setEdgeLength(plan: Plan, i: number, length: number): Plan {
  const e = edges(plan.outline)[i]
  const n = plan.outline.points.length
  const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1
  const ux = (e.b.x - e.a.x) / L, uy = (e.b.y - e.a.y) / L
  const dx = Math.round(ux * (length - L)), dy = Math.round(uy * (length - L))
  const j = (i + 1) % n, k = (i + 2) % n
  const next = plan.outline.points[k], b = plan.outline.points[j]
  const nl = Math.hypot(next.x - b.x, next.y - b.y) || 1
  const perpendicular = n > 3 && Math.abs(((next.x - b.x) * ux + (next.y - b.y) * uy) / nl) < 0.02 && !plan.outline.sags[j]
  const points = plan.outline.points.map((p, m) => (m === j || (perpendicular && m === k) ? { x: p.x + dx, y: p.y + dy } : p))
  return { ...plan, outline: { ...plan.outline, points } }
}

/** Cambia el largo o el ancho total del depósito (estira el contorno desde el lado izquierdo o de arriba). */
export function setTotal(plan: Plan, axis: 'x' | 'y', value: number): Plan {
  const pts = plan.outline.points
  if (pts.length < 3 || value < 1000) return plan
  const vs = pts.map((p) => p[axis])
  const lo = Math.min(...vs), hi = Math.max(...vs)
  if (hi - lo < 1) return plan
  const k = value / (hi - lo)
  const points = pts.map((p) => ({ ...p, [axis]: Math.round(lo + (p[axis] - lo) * k) }))
  return { ...plan, outline: { ...plan.outline, points } }
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

/** Columnas, tabiques, zonas y pasillos que quedaron fuera del contorno (por ejemplo, después de redibujarlo). */
export function itemsOutside(plan: Plan): Set<string> {
  const poly = outlinePolygon(plan.outline, 100)
  const out = new Set<string>()
  for (const c of plan.columns) if (!pointInPolygon(c, poly)) out.add(c.id)
  for (const w of plan.walls) if (!pointInPolygon(midpoint(w.a, w.b), poly)) out.add(w.id)
  for (const z of [...plan.zones, ...(plan.rackAreas ?? []), ...(plan.aisles ?? [])])
    if (!pointInPolygon({ x: z.x + z.w / 2, y: z.y + z.d / 2 }, poly)) out.add(z.id)
  return out
}

export function removeOutside(plan: Plan): Plan {
  const out = itemsOutside(plan)
  return {
    ...plan,
    columns: plan.columns.filter((x) => !out.has(x.id)),
    walls: plan.walls.filter((x) => !out.has(x.id)),
    zones: plan.zones.filter((x) => !out.has(x.id)),
    rackAreas: plan.rackAreas?.filter((x) => !out.has(x.id)),
    aisles: plan.aisles?.filter((x) => !out.has(x.id)),
  }
}

/** Borra lo seleccionado. */
export function removeItem(plan: Plan, kind: 'column' | 'wall' | 'door' | 'zone' | 'area' | 'aisle' | 'rack', id: string): Plan {
  switch (kind) {
    case 'column': return { ...plan, columns: plan.columns.filter((x) => x.id !== id) }
    case 'wall': return { ...plan, walls: plan.walls.filter((x) => x.id !== id) }
    case 'door': return { ...plan, doors: plan.doors.filter((x) => x.id !== id) }
    case 'zone': return { ...plan, zones: plan.zones.filter((x) => x.id !== id) }
    case 'area': return { ...plan, rackAreas: (plan.rackAreas ?? []).filter((x) => x.id !== id) }
    case 'aisle': return { ...plan, aisles: (plan.aisles ?? []).filter((x) => x.id !== id) }
    case 'rack': return { ...plan, racks: (plan.racks ?? []).filter((x) => x.id !== id) }
  }
}

/* ------------------------------ Zonas de racks y pasillos ------------------------------ */

type RectKind = 'area' | 'aisle'
type RectLike = { x: number; y: number; w: number; d: number }

/** Cambia una zona de racks o un pasillo. */
export function updateRect(plan: Plan, kind: RectKind, id: string, patch: (r: RectLike) => Partial<RectLike> & { name?: string; orientation?: 'x' | 'y' }): Plan {
  if (kind === 'area') return { ...plan, rackAreas: (plan.rackAreas ?? []).map((a) => (a.id === id ? { ...a, ...patch(a) } : a)) }
  return { ...plan, aisles: (plan.aisles ?? []).map((a) => (a.id === id ? { ...a, ...patch(a) } : a)) }
}

/** Gira un pasillo 90° sobre su centro (sin salirse del depósito). */
export function rotateAisle(plan: Plan, id: string): Plan {
  return updateRect(plan, 'aisle', id, (a) => clipToDepot(plan, { x: Math.round(a.x + a.w / 2 - a.d / 2), y: Math.round(a.y + a.d / 2 - a.w / 2), w: a.d, d: a.w }))
}

/** Recorta un rectángulo al depósito (si casi no queda nada, lo deja como está). */
function clipToDepot(plan: Plan, r: RectLike): RectLike {
  const pts = plan.outline.points
  if (pts.length < 3) return r
  const x0 = Math.max(r.x, Math.min(...pts.map((p) => p.x))), y0 = Math.max(r.y, Math.min(...pts.map((p) => p.y)))
  const x1 = Math.min(r.x + r.w, Math.max(...pts.map((p) => p.x))), y1 = Math.min(r.y + r.d, Math.max(...pts.map((p) => p.y)))
  return x1 - x0 >= 500 && y1 - y0 >= 500 ? { x: x0, y: y0, w: x1 - x0, d: y1 - y0 } : r
}

/**
 * Rectángulo de una zona de racks o de un pasillo a partir de lo que se arrastró en el plano (de a
 * hasta b). Un clic sin arrastrar: zona de 20 × 12 m, o pasillo de lado a lado del depósito.
 * Un pasillo arrastrado a lo largo sale con el ancho de pasillo elegido (`aisle`), salvo que se
 * marque un rectángulo de más de 2 m de cada lado.
 */
export function drawnRect(kind: RectKind, a: PlanPoint, b: PlanPoint, plan: Plan, aisle: number): RectLike {
  const xs = plan.outline.points.map((p) => p.x)
  const bounds = xs.length >= 3 ? { x0: Math.min(...xs), x1: Math.max(...xs) } : null
  // lo que se dibuja se recorta al depósito (un pasillo arrastrado hasta la pared no la atraviesa)
  const clip = (r: RectLike) => clipToDepot(plan, r)
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y)
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  const r = (v: number) => Math.round(v)
  if (kind === 'area') return clip(dx < 1000 || dy < 1000 ? { x: r(a.x - 10_000), y: r(a.y - 6000), w: 20_000, d: 12_000 } : { x, y, w: dx, d: dy })
  if (dx < 1000 && dy < 1000) {
    const x0 = bounds ? bounds.x0 : a.x - 10_000, x1 = bounds ? bounds.x1 : a.x + 10_000
    return { x: r(x0), y: r(a.y - aisle / 2), w: r(x1 - x0), d: aisle }
  }
  if (Math.min(dx, dy) >= 2000) return clip({ x, y, w: dx, d: dy })
  return clip(dx >= dy ? { x, y: r(a.y - aisle / 2), w: dx, d: aisle } : { x: r(a.x - aisle / 2), y, w: aisle, d: dy })
}

/* ------------------------------ Dibujo con medidas escritas ------------------------------ */

/** Depósito vacío: así arranca el plano (se crea escribiendo las medidas o dibujándolo). */
export function emptyPlan(base?: Partial<Plan>): Plan {
  return { wallHeight: 8000, wallThickness: 200, columns: [], walls: [], doors: [], zones: [], ...base, outline: { points: [], sags: [] }, racks: undefined, rackAreas: [], aisles: [] }
}

/**
 * Punto siguiente al escribir el largo de una pared (como en AutoCAD): desde `last`, `length` mm hacia
 * donde apunta el mouse (`toward`); sin mouse, siguiendo la pared anterior. Con `snapAngle` (imán
 * prendido) la pared sale derecha: horizontal o vertical, la más cercana al mouse.
 */
export function pointAtLength(last: PlanPoint, toward: PlanPoint | null, prev: PlanPoint | undefined, length: number, snapAngle: boolean): PlanPoint {
  let dx = 1, dy = 0
  if (toward && Math.hypot(toward.x - last.x, toward.y - last.y) > 1) { dx = toward.x - last.x; dy = toward.y - last.y }
  else if (prev && Math.hypot(last.x - prev.x, last.y - prev.y) > 1) { dx = last.x - prev.x; dy = last.y - prev.y }
  let ang = Math.atan2(dy, dx)
  if (snapAngle) ang = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2)
  return { x: Math.round(last.x + Math.cos(ang) * length), y: Math.round(last.y + Math.sin(ang) * length) }
}
