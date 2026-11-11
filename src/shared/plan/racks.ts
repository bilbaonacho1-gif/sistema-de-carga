/**
 * UBICACIÓN LIBRE DE RACKS: mover, girar, duplicar, cambiar módulos y avisar cuando un rack
 * se pisa con otro, con una columna, un tabique, una zona libre o un pasillo, o queda fuera del depósito.
 * La primera edición copia la distribución automática al plano (`plan.racks`).
 */
import { newId } from './edit'
import { outlinePolygon, pointInPolygon } from './geometry'
import { placementRect, type LayoutResult, type RackModuleSize } from './layout'
import type { Plan, PlanPoint, PlanSelection, RackPlacement } from './types'
import { UPRIGHT_PROFILES } from '../rack/technicalSpecs'

type Rect = { x: number; y: number; w: number; h: number }

/** Medidas del módulo de este rack: las del depósito, o las propias si se cambiaron sus piezas. */
export function rackDims(p: RackPlacement, size: RackModuleSize): { width: number; depth: number; upright: number } {
  const up = p.uprightId && p.uprightId !== 'auto' ? UPRIGHT_PROFILES.find((u) => u.id === p.uprightId)?.faceWidth : undefined
  return { width: p.beamLength ?? size.width, depth: p.frameDepth ?? size.depth, upright: up ?? size.upright }
}

/** Largo de viga de cada módulo del rack (cada uno puede tener el suyo). */
export function moduleWidths(p: RackPlacement, size: RackModuleSize): number[] {
  const w = rackDims(p, size).width
  return Array.from({ length: Math.max(1, Math.round(p.modules)) }, (_, k) => p.mods?.[k]?.width ?? w)
}

/** Centro de cada parante a lo largo del rack (uno más que módulos). */
export function frameCenters(p: RackPlacement, size: RackModuleSize): number[] {
  const up = rackDims(p, size).upright
  const out = [up / 2]
  for (const w of moduleWidths(p, size)) out.push(out[out.length - 1] + w + up)
  return out
}

/** Largo y profundidad de un rack según el módulo elegido (por si cambiaron las medidas del rack). */
export function fitPlacement(p: RackPlacement, size: RackModuleSize): RackPlacement {
  const modules = Math.max(1, Math.round(p.modules))
  const d = rackDims(p, size)
  const widths = moduleWidths(p, size)
  return {
    ...p, modules,
    length: widths.reduce((n, w) => n + w, 0) + (modules + 1) * d.upright,
    depth: p.pair ? 2 * d.depth + size.backToBackGap : d.depth,
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

/**
 * Rack nuevo: en el primer lugar libre más cerca del centro de la zona de racks (o del depósito si no
 * hay zonas), sin pisar zonas libres, pasillos ni otros racks.
 */
export function addRack(plan: Plan, size: RackModuleSize, modules = 5): { plan: Plan; id: string } {
  const id = newId('r')
  const base = fitPlacement({ id, x: 0, y: 0, orientation: 'x', modules, length: 0, depth: 0, pair: false }, size)
  const spot = findSpot(plan, base, size)
  const r = spot ?? { ...base, ...centerOf(plan, base) }
  return { plan: { ...plan, racks: [...(plan.racks ?? []), r] }, id }
}

function centerOf(plan: Plan, r: RackPlacement): { x: number; y: number } {
  const pts = plan.outline.points
  const cx = pts.reduce((n, p) => n + p.x, 0) / Math.max(1, pts.length)
  const cy = pts.reduce((n, p) => n + p.y, 0) / Math.max(1, pts.length)
  const b = placementRect(r)
  return { x: Math.round(cx - b.w / 2), y: Math.round(cy - b.h / 2) }
}

/** Primer lugar donde el rack entra (sin pisar nada ni a otro rack), buscando desde el centro. */
function findSpot(plan: Plan, r: RackPlacement, size: RackModuleSize): RackPlacement | null {
  const pts = plan.outline.points
  if (pts.length < 3) return null
  const regions = plan.rackAreas?.length
    ? plan.rackAreas.map((a) => ({ x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.d }))
    : [{ x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) }]
  const others = (plan.racks ?? []).map((o) => placementRect(fitPlacement(o, size)))
  for (const g of regions) {
    const b = placementRect(r)
    const step = Math.max(500, Math.round(Math.max(g.x1 - g.x0, g.y1 - g.y0) / 60))
    const cands: { x: number; y: number; d: number }[] = []
    const cx = (g.x0 + g.x1 - b.w) / 2, cy = (g.y0 + g.y1 - b.h) / 2
    for (let x = g.x0; x + b.w <= g.x1; x += step)
      for (let y = g.y0; y + b.h <= g.y1; y += step) cands.push({ x, y, d: Math.hypot(x - cx, y - cy) })
    cands.sort((a, c) => a.d - c.d)
    for (const c of cands.slice(0, 4000)) {
      const cand = { ...r, x: Math.round(c.x), y: Math.round(c.y) }
      const cb = placementRect(cand)
      if (!blockedReason(plan, cand) && !others.some((o) => overlap(cb, o))) return cand
    }
  }
  return null
}

/* ------------------------------ Dónde puede ir un rack ------------------------------ */

/**
 * Por qué un rack NO puede ir donde está (o null si puede): tiene que quedar adentro del depósito,
 * fuera de las zonas libres y de los pasillos y, si hay zonas de racks, adentro de una.
 */
export function blockedReason(plan: Plan, r: RackPlacement, poly = plan.outline.points.length >= 3 ? outlinePolygon(plan.outline, 200) : null): string | null {
  const b = placementRect(r)
  if (poly && !rectInside(b, poly)) return 'Queda fuera del depósito'
  if (plan.zones.some((z) => overlap(b, { x: z.x, y: z.y, w: z.w, h: z.d }))) return 'Pisa una zona libre'
  if ((plan.aisles ?? []).some((a) => overlap(b, { x: a.x, y: a.y, w: a.w, h: a.d }))) return 'Pisa un pasillo'
  const areas = plan.rackAreas ?? []
  if (areas.length && !areas.some((a) => b.x >= a.x - TOL && b.y >= a.y - TOL && b.x + b.w <= a.x + a.w + TOL && b.y + b.h <= a.y + a.d + TOL))
    return 'Fuera de la zona de racks'
  return null
}

/**
 * Cambio de un rack que sólo se acepta si el rack sigue pudiendo ir donde queda (si ya estaba mal
 * ubicado, se acepta igual, para poder sacarlo de ahí). Devuelve el plano sin cambios si no.
 */
export function guarded(before: Plan, after: Plan, id: string, size: RackModuleSize): Plan {
  const a = after.racks?.find((r) => r.id === id)
  if (!a || !blockedReason(after, fitPlacement(a, size))) return after
  const b = before.racks?.find((r) => r.id === id)
  return b && !blockedReason(before, fitPlacement(b, size)) ? before : after
}

/**
 * Mover un rack sin dejarlo entrar en zonas libres, pasillos ni salir de la zona de racks: si el
 * lugar pedido no se puede, se desliza por el borde (sólo en X o sólo en Y) o se queda donde estaba.
 */
export function moveRackWithin(plan: Plan, id: string, x: number, y: number, size: RackModuleSize): Plan {
  const r = plan.racks?.find((q) => q.id === id)
  if (!r) return plan
  const cur = fitPlacement(r, size)
  if (blockedReason(plan, cur)) return moveRack(plan, id, x, y)
  for (const [tx, ty] of [[x, y], [x, r.y], [r.x, y]]) {
    if (!blockedReason(plan, { ...cur, x: Math.round(tx), y: Math.round(ty) })) return moveRack(plan, id, tx, ty)
  }
  return plan
}

/** Duplicar al lado donde entre (de un lado, del otro, o a continuación); null si no entra en ningún lado. */
export function duplicateWithin(plan: Plan, id: string, aisle: number, size: RackModuleSize): { plan: Plan; id: string } | null {
  const r = plan.racks?.find((x) => x.id === id)
  if (!r) return null
  const cur = fitPlacement(r, size)
  const across = cur.depth + aisle, along = cur.length + 200
  const offs = cur.orientation === 'x'
    ? [[0, across], [0, -across], [along, 0], [-along, 0]]
    : [[across, 0], [-across, 0], [0, along], [0, -along]]
  const others = (plan.racks ?? []).map((o) => placementRect(fitPlacement(o, size)))
  for (const [dx, dy] of offs) {
    const cand = { ...r, id: newId('r'), x: r.x + dx, y: r.y + dy }
    const cb = placementRect(fitPlacement(cand, size))
    if (!blockedReason(plan, fitPlacement(cand, size)) && !others.some((o) => overlap(cb, o))) return { plan: { ...plan, racks: [...(plan.racks ?? []), cand] }, id: cand.id }
  }
  return null
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
    const why = blockedReason(plan, r, poly)
    if (why) { out[r.id] = why; return }
    if (plan.columns.some((c) => overlap(b, { x: c.x - c.w / 2, y: c.y - c.d / 2, w: c.w, h: c.d }))) { out[r.id] = 'Choca con una columna'; return }
    const hitsWall = plan.walls.some((w) => {
      const half = w.thickness / 2
      const grown = { x: b.x - half, y: b.y - half, w: b.w + 2 * half, h: b.h + 2 * half }
      const n = Math.max(1, Math.ceil(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) / 100))
      for (let k = 0; k <= n; k++) if (strictlyInside({ x: w.a.x + ((w.b.x - w.a.x) * k) / n, y: w.a.y + ((w.b.y - w.a.y) * k) / n }, grown)) return true
      return false
    })
    if (hitsWall) { out[r.id] = 'Choca con un tabique'; return }
    for (const j of neighbours(b, i)) if (overlap(b, rects[j])) { out[r.id] = 'Se pisa con otro rack'; break }
  })
  return out
}

/* ------------------------------ Varios racks a la vez ------------------------------ */

/** Los racks seleccionados (uno o varios). */
export function selectedRackIds(sel: PlanSelection): string[] {
  if (!sel) return []
  if (sel.kind === 'rack') return [sel.id]
  if (sel.kind === 'racks') return sel.ids
  return []
}

/** Selección de racks a partir de una lista (uno solo queda como selección simple). */
export function rackSelection(ids: string[]): PlanSelection {
  return ids.length === 0 ? null : ids.length === 1 ? { kind: 'rack', id: ids[0] } : { kind: 'racks', ids }
}

export function removeRacks(plan: Plan, ids: string[]): Plan {
  const drop = new Set(ids)
  return { ...plan, racks: (plan.racks ?? []).filter((r) => !drop.has(r.id)) }
}

/** Cambia varios racks a la vez con la misma función. */
export function mapRacks(plan: Plan, ids: string[], fn: (r: RackPlacement) => RackPlacement): Plan {
  const set = new Set(ids)
  return { ...plan, racks: (plan.racks ?? []).map((r) => (set.has(r.id) ? fn(r) : r)) }
}

/**
 * Mueve varios racks juntos (la misma distancia). Si alguno quedaría en un lugar prohibido, se
 * prueba sólo en X o sólo en Y; si tampoco, no se mueven.
 */
export function moveRacksBy(plan: Plan, ids: string[], dx: number, dy: number, size: RackModuleSize): Plan {
  const set = new Set(ids)
  const racks = (plan.racks ?? []).filter((r) => set.has(r.id))
  const poly = plan.outline.points.length >= 3 ? outlinePolygon(plan.outline, 200) : null
  const ok = (ddx: number, ddy: number) => racks.every((r) => {
    const cur = fitPlacement(r, size)
    return !!blockedReason(plan, cur, poly) || !blockedReason(plan, { ...cur, x: r.x + ddx, y: r.y + ddy }, poly)
  })
  for (const [tx, ty] of [[dx, dy], [dx, 0], [0, dy]]) {
    if (ok(tx, ty)) return mapRacks(plan, ids, (r) => ({ ...r, x: Math.round(r.x + tx), y: Math.round(r.y + ty) }))
  }
  return plan
}

/** Racks cuyo rectángulo toca el recuadro [x0,y0]–[x1,y1] (selección arrastrando). */
export function racksInBox(racks: RackPlacement[], x0: number, y0: number, x1: number, y1: number): string[] {
  const bx = Math.min(x0, x1), by = Math.min(y0, y1), bw = Math.abs(x1 - x0), bh = Math.abs(y1 - y0)
  return racks.filter((r) => overlap(placementRect(r), { x: bx, y: by, w: bw, h: bh })).map((r) => r.id)
}
