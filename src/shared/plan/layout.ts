/**
 * DISTRIBUCIÓN AUTOMÁTICA: cuántos racks entran en el depósito.
 *
 * Se recorre el depósito en franjas paralelas a las filas:
 *   fila simple contra la pared · pasillo · fila doble · pasillo · fila doble … · pasillo · fila simple
 * (sin "espalda con espalda": fila · pasillo · fila · pasillo …).
 * En cada franja se buscan los tramos libres: adentro del contorno y sin columnas, tabiques ni
 * zonas libres. En cada tramo entran todos los módulos posibles; una columna parte la fila en dos.
 */
import { outlinePolygon } from './geometry'
import type { Plan, PlanPoint, RackPlacement } from './types'

export type { RackPlacement } from './types'

export interface LayoutOptions {
  /** 'x' = las filas corren a lo largo del eje X del plano; 'y' = a lo largo del Y. */
  orientation: 'x' | 'y'
  /** Pasillo entre filas (mm). */
  aisle: number
  /** Filas apareadas espalda con espalda. */
  backToBack: boolean
  /** Separación entre la espalda de un rack y la pared (mm). */
  wallGap: number
  /** Espacio libre en las cabeceras de fila, contra las paredes (pasillo de cabecera, mm). */
  endGap: number
  /** Separación mínima a columnas, tabiques y zonas (mm). */
  obstacleGap: number
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  orientation: 'x', aisle: 3000, backToBack: true, wallGap: 200, endGap: 1500, obstacleGap: 150,
}

export interface RackModuleSize {
  /** Largo de viga (luz libre del módulo). */
  width: number
  /** Profundidad del bastidor. */
  depth: number
  /** Ancho del parante (lo que ocupa cada bastidor a lo largo de la fila). */
  upright: number
  /** Separación entre las dos filas de un par espalda con espalda. */
  backToBackGap: number
}

export interface LayoutResult {
  placements: RackPlacement[]
  /** Cantidad de filas de rack (un par cuenta como dos). */
  rows: number
  modules: number
}

interface Interval { a: number; b: number; wallA: boolean; wallB: boolean }
interface Box { x0: number; y0: number; x1: number; y1: number }

/** Tramos de la recta y = cte que quedan adentro del polígono. */
function scan(poly: PlanPoint[], y: number): [number, number][] {
  const xs: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    if ((p.y > y) !== (q.y > y)) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y))
  }
  xs.sort((a, b) => a - b)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]])
  return out
}

/** Intersección de dos listas de tramos. */
function intersect(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [a0, a1] of a) for (const [b0, b1] of b) {
    const lo = Math.max(a0, b0), hi = Math.min(a1, b1)
    if (hi > lo) out.push([lo, hi])
  }
  return out
}

/** Tramos libres de una franja [y0, y1]: adentro del contorno en todo su ancho y sin obstáculos. */
function freeIntervals(poly: PlanPoint[], obstacles: Box[], y0: number, y1: number): Interval[] {
  const step = 200
  let inside = scan(poly, y0 + 1)
  for (let y = y0 + step; y < y1; y += step) inside = intersect(inside, scan(poly, y))
  inside = intersect(inside, scan(poly, y1 - 1))
  let free: Interval[] = inside.map(([a, b]) => ({ a, b, wallA: true, wallB: true }))
  for (const o of obstacles) {
    if (o.y1 <= y0 || o.y0 >= y1) continue
    free = free.flatMap((iv) => {
      if (o.x1 <= iv.a || o.x0 >= iv.b) return [iv]
      const parts: Interval[] = []
      if (o.x0 > iv.a) parts.push({ a: iv.a, b: o.x0, wallA: iv.wallA, wallB: false })
      if (o.x1 < iv.b) parts.push({ a: o.x1, b: iv.b, wallA: false, wallB: iv.wallB })
      return parts
    })
  }
  return free
}

/** Obstáculos del plano como rectángulos (con su separación mínima). */
function obstacleBoxes(plan: Plan, gap: number): Box[] {
  const boxes: Box[] = []
  for (const c of plan.columns) boxes.push({ x0: c.x - c.w / 2 - gap, y0: c.y - c.d / 2 - gap, x1: c.x + c.w / 2 + gap, y1: c.y + c.d / 2 + gap })
  for (const z of plan.zones) boxes.push({ x0: z.x - gap, y0: z.y - gap, x1: z.x + z.w + gap, y1: z.y + z.d + gap })
  for (const w of plan.walls) {
    const t = w.thickness / 2 + gap
    boxes.push({ x0: Math.min(w.a.x, w.b.x) - t, y0: Math.min(w.a.y, w.b.y) - t, x1: Math.max(w.a.x, w.b.x) + t, y1: Math.max(w.a.y, w.b.y) + t })
  }
  return boxes
}

const swap = (p: PlanPoint): PlanPoint => ({ x: p.y, y: p.x })
const swapBox = (b: Box): Box => ({ x0: b.y0, y0: b.x0, x1: b.y1, y1: b.x1 })

/** Calcula la distribución de racks en el depósito. */
export function autoLayout(plan: Plan, size: RackModuleSize, opt: LayoutOptions): LayoutResult {
  if (plan.outline.points.length < 3 || size.width <= 0 || size.depth <= 0) return { placements: [], rows: 0, modules: 0 }
  // se trabaja siempre con filas a lo largo de X; para filas en Y se espeja el plano
  const flip = opt.orientation === 'y'
  let poly = outlinePolygon(plan.outline, 100)
  let obstacles = obstacleBoxes(plan, opt.obstacleGap)
  if (flip) { poly = poly.map(swap); obstacles = obstacles.map(swapBox) }

  const halfWall = plan.wallThickness / 2
  const ys = poly.map((p) => p.y)
  const top = Math.min(...ys) + halfWall + opt.wallGap
  const bottom = Math.max(...ys) - halfWall - opt.wallGap
  const D = size.depth
  const pairDepth = 2 * D + size.backToBackGap

  // franjas: profundidad de cada una (fila simple o par) separadas por pasillos
  const bands: { y: number; depth: number; pair: boolean }[] = []
  let y = top
  const push = (depth: number, pair: boolean) => { bands.push({ y, depth, pair }); y += depth }
  if (y + D <= bottom) push(D, false)                       // contra la primera pared
  while (opt.backToBack && y + opt.aisle + pairDepth <= bottom) { y += opt.aisle; push(pairDepth, true) }
  while (!opt.backToBack && y + opt.aisle + D <= bottom) { y += opt.aisle; push(D, false) }
  if (opt.backToBack && y + opt.aisle + D <= bottom) { y += opt.aisle; push(D, false) }   // contra la última pared

  const placements: RackPlacement[] = []
  const uw = size.upright
  bands.forEach((band, bi) => {
    freeIntervals(poly, obstacles, band.y, band.y + band.depth).forEach((iv, ii) => {
      const a = iv.a + (iv.wallA ? halfWall + opt.endGap : 0)
      const b = iv.b - (iv.wallB ? halfWall + opt.endGap : 0)
      const modules = Math.floor((b - a - uw) / (size.width + uw))
      if (modules < 1) return
      const length = modules * size.width + (modules + 1) * uw
      const corner = { x: Math.round(a), y: Math.round(band.y) }
      const pos = flip ? swap(corner) : corner
      placements.push({
        id: `r${bi + 1}-${ii + 1}`, x: pos.x, y: pos.y, orientation: opt.orientation,
        modules, length, depth: band.depth, pair: band.pair,
      })
    })
  })
  return {
    placements,
    rows: placements.reduce((n, p) => n + (p.pair ? 2 : 1), 0),
    modules: placements.reduce((n, p) => n + p.modules * (p.pair ? 2 : 1), 0),
  }
}

/** Rectángulo que ocupa un rack en el plano. */
export function placementRect(p: RackPlacement): { x: number; y: number; w: number; h: number } {
  return p.orientation === 'x' ? { x: p.x, y: p.y, w: p.length, h: p.depth } : { x: p.x, y: p.y, w: p.depth, h: p.length }
}
