/**
 * Geometría del plano: paredes rectas y curvas, largos, superficie, puntos adentro/afuera.
 * Una pared curva es un arco de circunferencia definido por sus extremos y su flecha (sag).
 * La "bulge" de AutoCAD (DXF) es 2·flecha / cuerda.
 */
import type { Plan, PlanOutline, PlanPoint } from './types'

const TAU = Math.PI * 2
const sub = (a: PlanPoint, b: PlanPoint) => ({ x: a.x - b.x, y: a.y - b.y })
const dist = (a: PlanPoint, b: PlanPoint) => Math.hypot(a.x - b.x, a.y - b.y)

export interface Edge { index: number; a: PlanPoint; b: PlanPoint; sag: number }

export function edges(o: PlanOutline): Edge[] {
  const n = o.points.length
  return o.points.map((a, i) => ({ index: i, a, b: o.points[(i + 1) % n], sag: o.sags[i] ?? 0 }))
}

/** Normal unitaria a la izquierda de la pared (en el sentido de a hacia b). */
export function leftNormal(a: PlanPoint, b: PlanPoint): PlanPoint {
  const L = dist(a, b) || 1
  return { x: (a.y - b.y) / L, y: (b.x - a.x) / L }
}

export function midpoint(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Punto medio del arco (o de la recta si la flecha es 0). */
export function apex(e: Edge): PlanPoint {
  const m = midpoint(e.a, e.b)
  const n = leftNormal(e.a, e.b)
  return { x: m.x + n.x * e.sag, y: m.y + n.y * e.sag }
}

export interface Arc { center: PlanPoint; radius: number; start: number; sweep: number }

/** Arco de una pared curva (null si es recta). sweep con signo: ángulo recorrido desde start. */
export function arcOf(e: Edge): Arc | null {
  const c = dist(e.a, e.b)
  if (!e.sag || c < 1e-6) return null
  const s = e.sag
  const r = (c * c / 4 + s * s) / (2 * Math.abs(s))
  const m = midpoint(e.a, e.b)
  const n = leftNormal(e.a, e.b)
  const k = s - Math.sign(s) * r
  const center = { x: m.x + n.x * k, y: m.y + n.y * k }
  const ang = (p: PlanPoint) => Math.atan2(p.y - center.y, p.x - center.x)
  const a0 = ang(e.a)
  const ccw = (x: number) => ((x % TAU) + TAU) % TAU
  const d1 = ccw(ang(e.b) - a0)
  const dm = ccw(ang(apex(e)) - a0)
  return { center, radius: r, start: a0, sweep: dm < d1 ? d1 : d1 - TAU }
}

/** Largo de la pared (de arco si es curva). */
export function edgeLength(e: Edge): number {
  const arc = arcOf(e)
  return arc ? Math.abs(arc.sweep) * arc.radius : dist(e.a, e.b)
}

/** Puntos a lo largo de la pared (incluye a, no incluye b). `step` = largo máximo de cada tramo. */
export function sampleEdge(e: Edge, step = 250): PlanPoint[] {
  const arc = arcOf(e)
  if (!arc) return [e.a]
  const n = Math.max(4, Math.ceil(edgeLength(e) / step))
  return Array.from({ length: n }, (_, i) => {
    const t = arc.start + (arc.sweep * i) / n
    return { x: arc.center.x + arc.radius * Math.cos(t), y: arc.center.y + arc.radius * Math.sin(t) }
  })
}

/** Contorno completo como polígono (las curvas, en tramos cortos). */
export function outlinePolygon(o: PlanOutline, step = 250): PlanPoint[] {
  return edges(o).flatMap((e) => sampleEdge(e, step))
}

/** Punto a lo largo de la pared, t de 0 a 1. */
export function pointOnEdge(e: Edge, t: number): PlanPoint {
  const arc = arcOf(e)
  if (!arc) return { x: e.a.x + (e.b.x - e.a.x) * t, y: e.a.y + (e.b.y - e.a.y) * t }
  const ang = arc.start + arc.sweep * t
  return { x: arc.center.x + arc.radius * Math.cos(ang), y: arc.center.y + arc.radius * Math.sin(ang) }
}

/** Dirección de la pared en el punto t (unitaria). */
export function tangentOnEdge(e: Edge, t: number): PlanPoint {
  const arc = arcOf(e)
  if (!arc) { const L = dist(e.a, e.b) || 1; return { x: (e.b.x - e.a.x) / L, y: (e.b.y - e.a.y) / L } }
  const ang = arc.start + arc.sweep * t
  const s = Math.sign(arc.sweep)
  return { x: -Math.sin(ang) * s, y: Math.cos(ang) * s }
}

export function polygonArea(pts: PlanPoint[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

/** Superficie en m² (calculada sobre el contorno con las curvas). */
export function planArea(o: PlanOutline): number {
  return polygonArea(outlinePolygon(o, 50)) / 1e6
}

/** Perímetro en mm. */
export function planPerimeter(o: PlanOutline): number {
  return edges(o).reduce((n, e) => n + edgeLength(e), 0)
}

export function pointInPolygon(p: PlanPoint, poly: PlanPoint[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function pointInPlan(p: PlanPoint, o: PlanOutline): boolean {
  return pointInPolygon(p, outlinePolygon(o, 100))
}

/** Caja que envuelve el plano. */
export function planBounds(plan: Plan): { minX: number; minY: number; maxX: number; maxY: number } {
  const pts = [
    ...outlinePolygon(plan.outline, 200),
    ...plan.columns.flatMap((c) => [{ x: c.x - c.w / 2, y: c.y - c.d / 2 }, { x: c.x + c.w / 2, y: c.y + c.d / 2 }]),
    ...plan.walls.flatMap((w) => [w.a, w.b]),
  ]
  if (!pts.length) return { minX: 0, minY: 0, maxX: 10_000, maxY: 10_000 }
  return {
    minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)),
  }
}

/** Distancia de un punto a una pared (recta o curva) y el t más cercano. */
export function nearestOnEdge(e: Edge, p: PlanPoint): { t: number; distance: number } {
  const arc = arcOf(e)
  if (!arc) {
    const ab = sub(e.b, e.a)
    const L2 = ab.x * ab.x + ab.y * ab.y || 1
    const t = Math.min(1, Math.max(0, ((p.x - e.a.x) * ab.x + (p.y - e.a.y) * ab.y) / L2))
    return { t, distance: dist(p, pointOnEdge(e, t)) }
  }
  // en un arco se busca entre muestras (alcanza para elegir dónde poner un portón)
  let best = { t: 0, distance: Infinity }
  for (let i = 0; i <= 100; i++) {
    const t = i / 100
    const d = dist(p, pointOnEdge(e, t))
    if (d < best.distance) best = { t, distance: d }
  }
  return best
}

/** Normal unitaria de la pared que apunta hacia AFUERA del depósito. */
export function outwardNormal(e: Edge, poly: PlanPoint[]): PlanPoint {
  const n = leftNormal(e.a, e.b)
  const m = apex(e)
  const probe = { x: m.x + n.x * 50, y: m.y + n.y * 50 }
  return pointInPolygon(probe, poly) ? { x: -n.x, y: -n.y } : n
}

/**
 * Distancia desde `p` hasta el contorno siguiendo la dirección `dir` (unitaria).
 * Devuelve null si el rayo no toca ninguna pared.
 */
export function rayToPolygon(p: PlanPoint, dir: PlanPoint, poly: PlanPoint[]): number | null {
  let best: number | null = null
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const sx = b.x - a.x, sy = b.y - a.y
    const den = dir.x * sy - dir.y * sx
    if (Math.abs(den) < 1e-9) continue
    const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den   // a lo largo del rayo
    const u = ((a.x - p.x) * dir.y - (a.y - p.y) * dir.x) / den  // a lo largo de la pared
    if (t > 1e-6 && u >= 0 && u <= 1 && (best === null || t < best)) best = t
  }
  return best
}

/** La "bulge" de DXF para una pared: tan(ángulo/4) con signo. */
export function dxfBulge(e: Edge): number {
  const c = dist(e.a, e.b)
  return c ? (2 * e.sag) / c : 0
}

/** Plano inicial: depósito rectangular. */
export function rectanglePlan(length: number, width: number, base?: Partial<Plan>): Plan {
  return {
    wallHeight: 8000, wallThickness: 200, columns: [], walls: [], doors: [], zones: [], ...base,
    outline: { points: [{ x: 0, y: 0 }, { x: length, y: 0 }, { x: length, y: width }, { x: 0, y: width }], sags: [0, 0, 0, 0] },
  }
}
