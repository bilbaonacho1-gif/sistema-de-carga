/**
 * RACKS DENTRO DEL PLANO. Cada rack guarda su configuración (la misma del cotizador) y dónde está.
 *
 * Coordenadas locales del rack (las del motor): u a lo largo de la fila (0 → largo total) y
 * v = z del motor (el frente de la fila 0 en v = 0; las filas siguientes hacia v negativo).
 * En el plano: P = origen + giro(θ)·(u, v), con θ en grados (en pantalla, horario porque y crece hacia abajo).
 * Es el mismo giro que hace SVG con rotate(θ) y que hace el 3D con rotation.y = −θ.
 *
 * Pensado para depósitos grandes: los racks con la misma configuración comparten el cálculo
 * (caché), los choques se buscan con una grilla espacial y no par contra par.
 */
import { calculateRackStructure } from '../rack/calculateRackStructure'
import type { MaterialLine, RackConfiguration, RackStructure } from '../rack/types'
import { newId } from './edit'
import { outlinePolygon, pointInPolygon } from './geometry'
import type { Plan, PlanPoint, PlanRack } from './types'

/* ------------------------------ Cálculo con caché ------------------------------ */

const cache = new Map<string, RackStructure>()
const CACHE_MAX = 400

/** Firma de una configuración. Los racks copiados comparten el mismo objeto: se calcula una vez. */
const keys = new WeakMap<RackConfiguration, string>()
export const configKey = (c: RackConfiguration) => {
  let k = keys.get(c)
  if (k === undefined) keys.set(c, (k = JSON.stringify(c)))
  return k
}

/** Estructura calculada de una configuración (los racks iguales se calculan una sola vez). */
export function structureFor(config: RackConfiguration): RackStructure {
  const key = configKey(config)
  let s = cache.get(key)
  if (s) {
    cache.delete(key)
    cache.set(key, s)        // queda como el más reciente
    return s
  }
  s = calculateRackStructure(config)
  cache.set(key, s)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  return s
}

/* ------------------------------ Huella ------------------------------ */

export interface LocalBox { u0: number; u1: number; v0: number; v1: number }
export interface RowBand { index: number; v0: number; v1: number; frames: number[] }

/** Caja del rack en sus coordenadas locales. */
export function localBox(s: RackStructure): LocalBox {
  const D = s.config.depth
  const v0 = Math.min(...s.rows.map((r) => (r.facing === 1 ? r.zFront - D : r.zFront)))
  const v1 = Math.max(...s.rows.map((r) => (r.facing === 1 ? r.zFront : r.zFront + D)))
  return { u0: 0, u1: s.totalWidth, v0, v1 }
}

/** Cada fila como una banda (para dibujarla en el plano) con la posición de sus bastidores. */
export function rowBands(s: RackStructure): RowBand[] {
  const D = s.config.depth
  return s.rows.map((r) => ({
    index: r.index,
    v0: r.facing === 1 ? r.zFront - D : r.zFront,
    v1: r.facing === 1 ? r.zFront : r.zFront + D,
    frames: r.frames.map((f) => f.x),
  }))
}

export function toPlanPoint(rack: Pick<PlanRack, 'x' | 'y' | 'rotation'>, u: number, v: number): PlanPoint {
  const t = (rack.rotation * Math.PI) / 180
  const c = Math.cos(t), sn = Math.sin(t)
  return { x: rack.x + u * c - v * sn, y: rack.y + u * sn + v * c }
}

export function toLocal(rack: Pick<PlanRack, 'x' | 'y' | 'rotation'>, p: PlanPoint): { u: number; v: number } {
  const t = (rack.rotation * Math.PI) / 180
  const c = Math.cos(t), sn = Math.sin(t)
  const dx = p.x - rack.x, dy = p.y - rack.y
  return { u: dx * c + dy * sn, v: -dx * sn + dy * c }
}

export interface Footprint { corners: PlanPoint[]; minX: number; minY: number; maxX: number; maxY: number; center: PlanPoint }

/** Las 4 esquinas del rack en el plano y su caja (una vez por objeto: los racks que no cambian se reusan). */
const fpCache = new WeakMap<PlanRack, Footprint>()
export function footprint(rack: PlanRack): Footprint {
  const hit = fpCache.get(rack)
  if (hit) return hit
  const f = computeFootprint(rack)
  fpCache.set(rack, f)
  return f
}

function computeFootprint(rack: PlanRack): Footprint {
  const b = localBox(structureFor(rack.config))
  const corners = [
    toPlanPoint(rack, b.u0, b.v0), toPlanPoint(rack, b.u1, b.v0),
    toPlanPoint(rack, b.u1, b.v1), toPlanPoint(rack, b.u0, b.v1),
  ]
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y)
  return {
    corners,
    minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys),
    center: toPlanPoint(rack, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2),
  }
}

/* ------------------------------ Choques ------------------------------ */

/** Separación de dos polígonos convexos por ejes (SAT). Se toleran contactos de hasta `tol` mm. */
function convexOverlap(a: PlanPoint[], b: PlanPoint[], tol = 10): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length]
      const nx = q.y - p.y, ny = p.x - q.x
      const L = Math.hypot(nx, ny) || 1
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity
      for (const r of a) { const d = (r.x * nx + r.y * ny) / L; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d) }
      for (const r of b) { const d = (r.x * nx + r.y * ny) / L; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d) }
      if (aMax - tol <= bMin || bMax - tol <= aMin) return false
    }
  return true
}

const rectPoly = (x: number, y: number, w: number, d: number): PlanPoint[] =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }]

function segmentsCross(p1: PlanPoint, p2: PlanPoint, q1: PlanPoint, q2: PlanPoint): boolean {
  const o = (a: PlanPoint, b: PlanPoint, c: PlanPoint) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
  return o(p1, p2, q1) !== o(p1, p2, q2) && o(q1, q2, p1) !== o(q1, q2, p2)
}

export type ConflictReason = 'afuera' | 'columna' | 'zona' | 'tabique' | 'rack'
export const CONFLICT_TEXT: Record<ConflictReason, string> = {
  afuera: 'queda fuera del depósito',
  columna: 'pisa una columna',
  zona: 'invade una zona libre',
  tabique: 'cruza un tabique',
  rack: 'se superpone con otro rack',
}

/**
 * Qué racks tienen problemas y por qué. Con una grilla de 10 m: cada rack se compara sólo con lo
 * que cae en sus mismas celdas, así un depósito con miles de racks se revisa al instante.
 */
const conflictCache = new WeakMap<Plan, Map<string, Set<ConflictReason>>>()
export function rackConflicts(plan: Plan): Map<string, Set<ConflictReason>> {
  const hit = conflictCache.get(plan)
  if (hit) return hit
  const out = computeConflicts(plan)
  conflictCache.set(plan, out)
  return out
}

function computeConflicts(plan: Plan): Map<string, Set<ConflictReason>> {
  const racks = plan.racks ?? []
  const out = new Map<string, Set<ConflictReason>>()
  if (!racks.length) return out
  const add = (id: string, r: ConflictReason) => { let s = out.get(id); if (!s) out.set(id, (s = new Set())); s.add(r) }

  const CELL = 10_000
  const grid = new Map<string, number[]>()
  const fps = racks.map(footprint)
  const cellsOf = (minX: number, minY: number, maxX: number, maxY: number) => {
    const keys: string[] = []
    for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++)
      for (let j = Math.floor(minY / CELL); j <= Math.floor(maxY / CELL); j++) keys.push(`${i},${j}`)
    return keys
  }
  fps.forEach((f, k) => { for (const c of cellsOf(f.minX, f.minY, f.maxX, f.maxY)) (grid.get(c) ?? grid.set(c, []).get(c)!).push(k) })

  // contra otros racks
  for (const list of grid.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = fps[list[i]], b = fps[list[j]]
        if (a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY) continue
        if (convexOverlap(a.corners, b.corners)) { add(racks[list[i]].id, 'rack'); add(racks[list[j]].id, 'rack') }
      }

  // contra lo que está en el plano: se busca en la grilla lo que cae cerca de cada cosa
  const near = (minX: number, minY: number, maxX: number, maxY: number) => {
    const found = new Set<number>()
    for (const c of cellsOf(minX, minY, maxX, maxY)) for (const k of grid.get(c) ?? []) found.add(k)
    return found
  }
  for (const col of plan.columns) {
    const poly = rectPoly(col.x - col.w / 2, col.y - col.d / 2, col.w, col.d)
    for (const k of near(col.x - col.w / 2, col.y - col.d / 2, col.x + col.w / 2, col.y + col.d / 2))
      if (convexOverlap(fps[k].corners, poly)) add(racks[k].id, 'columna')
  }
  for (const z of plan.zones) {
    const poly = rectPoly(z.x, z.y, z.w, z.d)
    for (const k of near(z.x, z.y, z.x + z.w, z.y + z.d))
      if (convexOverlap(fps[k].corners, poly)) add(racks[k].id, 'zona')
  }
  for (const w of plan.walls) {
    const minX = Math.min(w.a.x, w.b.x), maxX = Math.max(w.a.x, w.b.x), minY = Math.min(w.a.y, w.b.y), maxY = Math.max(w.a.y, w.b.y)
    for (const k of near(minX, minY, maxX, maxY)) {
      const c = fps[k].corners
      const crosses = c.some((p, i) => segmentsCross(p, c[(i + 1) % 4], w.a, w.b)) || pointInPolygon(w.a, c) || pointInPolygon(w.b, c)
      if (crosses) add(racks[k].id, 'tabique')
    }
  }
  // contra el contorno: las 4 esquinas adentro y ninguna pared que entre en el rack
  const poly = outlinePolygon(plan.outline, 250)
  fps.forEach((f, k) => {
    const out1 = f.corners.some((p) => !pointInPolygon(p, poly))
    const out2 = !out1 && poly.some((p) => p.x > f.minX && p.x < f.maxX && p.y > f.minY && p.y < f.maxY && pointInPolygon(p, f.corners))
    if (out1 || out2) add(racks[k].id, 'afuera')
  })
  return out
}

/* ------------------------------ Totales y materiales del depósito ------------------------------ */

export interface RackTotals {
  racks: number
  rows: number
  modules: number
  positions: number
  capacityKg: number
  materials: MaterialLine[]
}

/** Totales del depósito y la lista de materiales sumada (cada configuración se calcula una vez). */
const totalsCache = new WeakMap<PlanRack[], RackTotals>()
export function rackTotals(plan: Plan): RackTotals {
  const list = plan.racks ?? []
  const hit = totalsCache.get(list)
  if (hit) return hit
  const t = computeTotals(list)
  totalsCache.set(list, t)
  return t
}

function computeTotals(racksList: PlanRack[]): RackTotals {
  const groups = new Map<string, { s: RackStructure; n: number }>()
  for (const r of racksList) {
    const k = configKey(r.config)
    const g = groups.get(k)
    if (g) g.n++
    else groups.set(k, { s: structureFor(r.config), n: 1 })
  }
  const lines = new Map<string, MaterialLine>()
  let rows = 0, modules = 0, positions = 0, capacityKg = 0, racks = 0
  for (const { s, n } of groups.values()) {
    racks += n
    rows += s.rows.length * n
    modules += s.modules.length * n
    positions += s.positionsAvailable * n
    capacityKg += s.totalCapacity * n
    for (const l of s.materials) {
      const prev = lines.get(l.code)
      lines.set(l.code, prev ? { ...prev, qty: prev.qty + l.qty * n } : { ...l, qty: l.qty * n })
    }
  }
  return { racks, rows, modules, positions, capacityKg, materials: [...lines.values()] }
}

/* ------------------------------ Operaciones (funciones puras) ------------------------------ */

const withRacks = (plan: Plan, fn: (r: PlanRack[]) => PlanRack[]): Plan => ({ ...plan, racks: fn(plan.racks ?? []) })
const snap = (v: number) => Math.round(v / 10) * 10

/** Agrega un rack con su centro en `at`. */
export function addRack(plan: Plan, config: RackConfiguration, at: PlanPoint, rotation = 0): { plan: Plan; id: string } {
  const b = localBox(structureFor(config))
  const id = newId('r')
  const probe = { x: 0, y: 0, rotation }
  const c = toPlanPoint(probe, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2)
  const rack: PlanRack = { id, x: snap(at.x - c.x), y: snap(at.y - c.y), rotation, config }
  return { plan: withRacks(plan, (rs) => [...rs, rack]), id }
}

export function updateRack(plan: Plan, id: string, patch: Partial<PlanRack>): Plan {
  return withRacks(plan, (rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
}

/** Gira el rack sobre su centro. */
export function rotateRack(plan: Plan, id: string, rotation: number): Plan {
  const r = (plan.racks ?? []).find((x) => x.id === id)
  if (!r) return plan
  const b = localBox(structureFor(r.config))
  const center = toPlanPoint(r, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2)
  const rot = ((rotation % 360) + 360) % 360
  const c = toPlanPoint({ x: 0, y: 0, rotation: rot }, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2)
  return updateRack(plan, id, { rotation: rot, x: snap(center.x - c.x), y: snap(center.y - c.y) })
}

export function removeRack(plan: Plan, id: string): Plan {
  return withRacks(plan, (rs) => rs.filter((r) => r.id !== id))
}

/**
 * Copias en serie de un rack: `along` = a continuación de la fila (u) o `across` = enfrente, del lado
 * del frente (pasillo de por medio), dejando `gap` mm (el pasillo, o 0 para pegarlas). Devuelve los ids nuevos.
 */
export function repeatRack(plan: Plan, id: string, count: number, direction: 'along' | 'across', gap: number): { plan: Plan; ids: string[] } {
  const r = (plan.racks ?? []).find((x) => x.id === id)
  if (!r || count < 1) return { plan, ids: [] }
  const b = localBox(structureFor(r.config))
  const stepU = direction === 'along' ? b.u1 - b.u0 + gap : 0
  const stepV = direction === 'across' ? b.v1 - b.v0 + gap : 0
  const copies: PlanRack[] = []
  for (let i = 1; i <= count; i++) {
    const o = toPlanPoint(r, stepU * i, stepV * i)
    copies.push({ ...r, id: newId('r'), x: snap(o.x), y: snap(o.y) })
  }
  return { plan: withRacks(plan, (rs) => [...rs, ...copies]), ids: copies.map((c) => c.id) }
}

/* ------------------------------ Guardado compacto ------------------------------ */

/**
 * Para guardar: las configuraciones repetidas se guardan una sola vez (un depósito con 2.000 racks
 * iguales ocupa casi lo mismo que uno con un rack).
 */
export interface PackedPlan extends Omit<Plan, 'racks'> {
  rackConfigs?: RackConfiguration[]
  racks?: (Omit<PlanRack, 'config'> & { c: number })[]
}

export function packPlan(plan: Plan): PackedPlan {
  const index = new Map<string, number>()
  const rackConfigs: RackConfiguration[] = []
  const racks = (plan.racks ?? []).map(({ config, ...r }) => {
    const k = configKey(config)
    let c = index.get(k)
    if (c === undefined) { c = rackConfigs.length; index.set(k, c); rackConfigs.push(config) }
    return { ...r, c }
  })
  return { ...plan, rackConfigs, racks }
}

export function unpackPlan(p: PackedPlan | Plan): Plan {
  const packed = p as PackedPlan
  const configs = packed.rackConfigs ?? []
  const racks = (packed.racks ?? []).map((r) => {
    if ('config' in r) return r as unknown as PlanRack
    const { c, ...rest } = r
    return { ...rest, config: configs[c] } as PlanRack
  }).filter((r) => r.config)
  const { rackConfigs: _ignored, ...plan } = packed
  return { ...(plan as Plan), racks }
}
