/**
 * GIRAR, AGRANDAR Y ACHICAR lo que hay en el plano (zonas, pasillos, columnas, tabiques, textos y el
 * depósito entero). Funciones puras: reciben el plano y devuelven otro.
 */
import { planBounds } from './geometry'
import { placementRect } from './layout'
import type { Plan, PlanPoint } from './types'

export interface Rect { x: number; y: number; w: number; d: number }
export type Side = 'l' | 'r' | 't' | 'b'

/** Gira 90° un rectángulo sobre su centro. */
export const rotateRect = <T extends Rect>(r: T): T => ({ ...r, x: Math.round(r.x + r.w / 2 - r.d / 2), y: Math.round(r.y + r.d / 2 - r.w / 2), w: r.d, d: r.w })

/** Agranda (o achica, con delta negativo) el ancho o el fondo sin moverle el centro. */
export function growRect<T extends Rect>(r: T, axis: 'w' | 'd', delta: number, min = 500): T {
  const v = Math.max(min, r[axis] + delta)
  const real = v - r[axis]
  return axis === 'w' ? { ...r, w: v, x: Math.round(r.x - real / 2) } : { ...r, d: v, y: Math.round(r.y - real / 2) }
}

/** Estira el rectángulo desde uno o dos de sus lados hasta el punto `p` (el lado opuesto queda quieto). */
export function resizeRect<T extends Rect>(r: T, sides: Side[], p: PlanPoint, min = 500): T {
  let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.d
  if (sides.includes('l')) x0 = Math.min(p.x, x1 - min)
  if (sides.includes('r')) x1 = Math.max(p.x, x0 + min)
  if (sides.includes('t')) y0 = Math.min(p.y, y1 - min)
  if (sides.includes('b')) y1 = Math.max(p.y, y0 + min)
  return { ...r, x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), d: Math.round(y1 - y0) }
}

/** Recorta el rectángulo a lo que ocupa el depósito (para un pasillo o zona que se salió). */
export function fitToDepot<T extends Rect>(plan: Plan, r: T): T {
  const pts = plan.outline.points
  if (pts.length < 3) return r
  const x0 = Math.max(r.x, Math.min(...pts.map((p) => p.x))), y0 = Math.max(r.y, Math.min(...pts.map((p) => p.y)))
  const x1 = Math.min(r.x + r.w, Math.max(...pts.map((p) => p.x))), y1 = Math.min(r.y + r.d, Math.max(...pts.map((p) => p.y)))
  return x1 - x0 >= 500 && y1 - y0 >= 500 ? { ...r, x: x0, y: y0, w: x1 - x0, d: y1 - y0 } : r
}

/** Gira 90° el tabique sobre su punto medio. */
export function rotateWall(w: { a: PlanPoint; b: PlanPoint }) {
  const cx = (w.a.x + w.b.x) / 2, cy = (w.a.y + w.b.y) / 2
  const rot = (p: PlanPoint) => ({ x: Math.round(cx - (p.y - cy)), y: Math.round(cy + (p.x - cx)) })
  return { a: rot(w.a), b: rot(w.b) }
}

/** Alarga o acorta el tabique (desde su punto medio, para los dos lados). */
export function growWall(w: { a: PlanPoint; b: PlanPoint }, delta: number) {
  const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1
  const nl = Math.max(200, L + delta), k = (nl - L) / 2 / L
  const dx = (w.b.x - w.a.x) * k, dy = (w.b.y - w.a.y) * k
  return { a: { x: Math.round(w.a.x - dx), y: Math.round(w.a.y - dy) }, b: { x: Math.round(w.b.x + dx), y: Math.round(w.b.y + dy) } }
}

/**
 * Gira el depósito entero 90° (en el sentido de las agujas del reloj) sobre su centro: el contorno y
 * todo lo que tiene adentro. Los portones siguen en su pared y los racks cambian de orientación.
 */
export function rotatePlan(plan: Plan): Plan {
  if (plan.outline.points.length < 3) return plan
  const b = planBounds(plan)
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2
  const rp = (p: PlanPoint): PlanPoint => ({ x: Math.round(cx - (p.y - cy)), y: Math.round(cy + (p.x - cx)) })
  // un rectángulo girado: su esquina de arriba a la izquierda pasa a ser la de arriba a la derecha
  const rr = <T extends Rect>(r: T): T => { const c = rp({ x: r.x, y: r.y + r.d }); return { ...r, x: c.x, y: c.y, w: r.d, d: r.w } }
  return {
    ...plan,
    outline: { ...plan.outline, points: plan.outline.points.map(rp) },
    columns: plan.columns.map((c) => ({ ...c, ...rp(c), w: c.d, d: c.w })),
    walls: plan.walls.map((w) => ({ ...w, a: rp(w.a), b: rp(w.b) })),
    zones: plan.zones.map(rr),
    rackAreas: plan.rackAreas?.map((a) => ({ ...rr(a), orientation: a.orientation ? (a.orientation === 'x' ? 'y' : 'x') : undefined })),
    aisles: plan.aisles?.map(rr),
    texts: plan.texts?.map((t) => ({ ...t, ...rp(t) })),
    symbols: plan.symbols?.map((s) => ({ ...s, ...rp(s) })),
    dims: plan.dims?.map((d) => ({ ...d, a: rp(d.a), b: rp(d.b) })),
    racks: plan.racks?.map((r) => {
      const box = placementRect(r)
      const c = rp({ x: box.x, y: box.y + box.h })
      return { ...r, orientation: r.orientation === 'x' ? 'y' : 'x', x: c.x, y: c.y }
    }),
  }
}
