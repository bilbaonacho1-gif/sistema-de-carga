/**
 * DISTRIBUCIÓN AUTOMÁTICA: cuántos racks entran en el depósito.
 *
 * Se recorre el depósito en franjas paralelas a las filas:
 *   fila simple contra la pared · pasillo · fila doble · pasillo · fila doble … · pasillo · fila simple
 * (sin "espalda con espalda": fila · pasillo · fila · pasillo …).
 * En cada franja se buscan los tramos libres: adentro del contorno y sin columnas, tabiques ni
 * zonas libres. En cada tramo entran todos los módulos posibles; una columna parte la fila en dos.
 *
 * Zonas de racks y pasillos dibujados: si hay zonas, se llena cada una por separado (con su
 * orientación). Un pasillo dibujado a lo largo de las filas parte la zona en dos tramos (pegado al
 * pasillo arranca un par, porque ya tiene acceso); uno que cruza las filas las corta.
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
  // los pasillos casi siempre son de 3 m: entre filas y en las cabeceras
  orientation: 'x', aisle: 3000, backToBack: true, wallGap: 200, endGap: 3000, obstacleGap: 150,
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
  /** Ancho de cada tipo de parante (id → mm), para los racks que eligen el suyo. */
  uprightWidths?: Record<string, number>
  /** Para dibujar los pallets en el plano: cuántos por módulo y su medida (frente y fondo). */
  pallets?: number
  palletFront?: number
  palletDeep?: number
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
  return boxes
}

/** Tabique como segmento con su medio espesor (más la separación). */
interface Seg { a: PlanPoint; b: PlanPoint; t: number }

/**
 * Lo que ocupa un tabique dentro de la franja [y0, y1]: sólo el tramo que la cruza. Un tabique en
 * diagonal tapa una franja angosta en cada fila, no todo el rectángulo que lo encierra.
 */
function segBox(s: Seg, y0: number, y1: number): Box | null {
  const lo = y0 - s.t, hi = y1 + s.t
  const { a, b } = s
  if (Math.max(a.y, b.y) < lo || Math.min(a.y, b.y) > hi) return null
  let t0 = 0, t1 = 1
  const dy = b.y - a.y
  if (Math.abs(dy) > 1e-9) {
    let ta = (lo - a.y) / dy, tb = (hi - a.y) / dy
    if (ta > tb) [ta, tb] = [tb, ta]
    t0 = Math.max(0, ta); t1 = Math.min(1, tb)
    if (t0 > t1) return null
  }
  const xa = a.x + (b.x - a.x) * t0, xb = a.x + (b.x - a.x) * t1
  return { x0: Math.min(xa, xb) - s.t, y0, x1: Math.max(xa, xb) + s.t, y1 }
}

const swap = (p: PlanPoint): PlanPoint => ({ x: p.y, y: p.x })
const swapBox = (b: Box): Box => ({ x0: b.y0, y0: b.x0, x1: b.y1, y1: b.x1 })

const EMPTY: LayoutResult = { placements: [], rows: 0, modules: 0 }

/**
 * Calcula la distribución de racks en el depósito. Si el plano tiene zonas de racks, llena sólo
 * esas zonas; los pasillos marcados a mano se respetan siempre.
 */
export function autoLayout(plan: Plan, size: RackModuleSize, opt: LayoutOptions): LayoutResult {
  if (plan.outline.points.length < 3 || size.width <= 0 || size.depth <= 0) return EMPTY
  const areas = plan.rackAreas ?? []
  const placements = areas.length
    ? areas.flatMap((a, i) => layoutRegion(plan, size, { ...opt, orientation: a.orientation ?? opt.orientation },
      { x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.d }, `z${i + 1}-`))
    : layoutRegion(plan, size, opt, null, '')
  return {
    placements,
    rows: placements.reduce((n, p) => n + (p.pair ? 2 : 1), 0),
    modules: placements.reduce((n, p) => n + p.modules * (p.pair ? 2 : 1), 0),
  }
}

/** Racks de una región (una zona de racks, o todo el depósito si `area` es null). */
function layoutRegion(plan: Plan, size: RackModuleSize, opt: LayoutOptions, area: Box | null, prefix: string): RackPlacement[] {
  // se trabaja siempre con filas a lo largo de X; para filas en Y se espeja el plano
  const flip = opt.orientation === 'y'
  let poly = outlinePolygon(plan.outline, 100)
  let obstacles = obstacleBoxes(plan, opt.obstacleGap)
  let aisles: Box[] = (plan.aisles ?? []).map((a) => ({ x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.d }))
  let segs: Seg[] = plan.walls.map((w) => ({ a: w.a, b: w.b, t: w.thickness / 2 + opt.obstacleGap }))
  if (flip) { poly = poly.map(swap); obstacles = obstacles.map(swapBox); aisles = aisles.map(swapBox); segs = segs.map((q) => ({ ...q, a: swap(q.a), b: swap(q.b) })); if (area) area = swapBox(area) }

  const halfWall = plan.wallThickness / 2
  const ys = poly.map((p) => p.y)
  let top = Math.min(...ys) + halfWall + opt.wallGap
  let bottom = Math.max(...ys) - halfWall - opt.wallGap
  let x0 = -Infinity, x1 = Infinity
  if (area) { top = Math.max(top, area.y0); bottom = Math.min(bottom, area.y1); x0 = area.x0; x1 = area.x1 }
  if (bottom <= top || x1 <= x0) return []

  // pasillos a lo largo de las filas: parten la región en tramos, cada uno con sus filas;
  // los que cruzan las filas son obstáculos (cortan la fila, como una columna)
  const g = opt.obstacleGap
  const along: Box[] = []
  for (const a of aisles) {
    if (a.x1 <= x0 || a.x0 >= x1 || a.y1 <= top || a.y0 >= bottom) continue
    if (a.x1 - a.x0 >= a.y1 - a.y0) along.push(a)
    else obstacles.push({ x0: a.x0 - g, y0: a.y0 - g, x1: a.x1 + g, y1: a.y1 + g })
  }
  along.sort((a, b) => a.y0 - b.y0)
  const segments: { y0: number; y1: number; afterAisle: boolean }[] = []
  let from = top, afterAisle = false
  for (const a of along) {
    if (a.y0 - g > from) segments.push({ y0: from, y1: a.y0 - g, afterAisle })
    from = Math.max(from, a.y1 + g)
    afterAisle = true
  }
  if (bottom > from) segments.push({ y0: from, y1: bottom, afterAisle })

  // franjas: profundidad de cada una (fila simple o par) separadas por pasillos
  const D = size.depth
  const pairDepth = 2 * D + size.backToBackGap
  const bands: { y: number; depth: number; pair: boolean }[] = []
  for (const seg of segments) {
    let y = seg.y0
    const push = (depth: number, pair: boolean) => { bands.push({ y, depth, pair }); y += depth }
    if (opt.backToBack) {
      // contra una pared o el borde de la zona va una fila simple; pegado a un pasillo, un par
      // (el pasillo ya le da acceso)
      if (seg.afterAisle && y + pairDepth <= seg.y1) push(pairDepth, true)
      else if (y + D <= seg.y1) push(D, false)
      while (y + opt.aisle + pairDepth <= seg.y1) { y += opt.aisle; push(pairDepth, true) }
      if (y + opt.aisle + D <= seg.y1) { y += opt.aisle; push(D, false) }   // contra la última pared
    } else {
      if (y + D <= seg.y1) push(D, false)
      while (y + opt.aisle + D <= seg.y1) { y += opt.aisle; push(D, false) }
    }
  }

  const placements: RackPlacement[] = []
  const uw = size.upright
  bands.forEach((band, bi) => {
    const walls = segs.map((q) => segBox(q, band.y, band.y + band.depth)).filter((b): b is Box => !!b)
    freeIntervals(poly, walls.length ? [...obstacles, ...walls] : obstacles, band.y, band.y + band.depth).forEach((iv, ii) => {
      // contra la pared queda el pasillo de cabecera; en el borde de la zona, la fila llega justo
      const a = Math.max(iv.a + (iv.wallA ? halfWall + opt.endGap : 0), x0)
      const b = Math.min(iv.b - (iv.wallB ? halfWall + opt.endGap : 0), x1)
      const modules = Math.floor((b - a - uw) / (size.width + uw))
      if (modules < 1) return
      const length = modules * size.width + (modules + 1) * uw
      const corner = { x: Math.round(a), y: Math.round(band.y) }
      const pos = flip ? swap(corner) : corner
      placements.push({
        id: `${prefix}r${bi + 1}-${ii + 1}`, x: pos.x, y: pos.y, orientation: opt.orientation,
        modules, length, depth: band.depth, pair: band.pair,
      })
    })
  })
  return placements
}

/** Rectángulo que ocupa un rack en el plano. */
export function placementRect(p: RackPlacement): { x: number; y: number; w: number; h: number } {
  return p.orientation === 'x' ? { x: p.x, y: p.y, w: p.length, h: p.depth } : { x: p.x, y: p.y, w: p.depth, h: p.length }
}
