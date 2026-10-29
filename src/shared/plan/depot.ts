/**
 * EL DEPÓSITO COMPLETO: cada rack ubicado se arma con el mismo motor del cotizador
 * (calculateRackStructure) y se suman posiciones, capacidad y la lista de materiales.
 */
import { calculateRackStructure, sanitizeConfiguration } from '../rack/calculateRackStructure'
import { DESIGN_RULES } from '../rack/technicalSpecs'
import type { ComponentCounts, MaterialLine, RackConfiguration, RackStructure } from '../rack/types'
import { planArea } from './geometry'
import { autoLayout, type LayoutOptions, type LayoutResult, type RackModuleSize } from './layout'
import { manualLayout, rackIssues } from './racks'
import type { Plan, RackPlacement } from './types'

export interface PlacedRack { placement: RackPlacement; structure: RackStructure }

export interface Depot {
  layout: LayoutResult
  /** Racks ubicados a mano (si no, los ubicó la distribución automática). */
  manual: boolean
  /** Racks con problemas: id → motivo (se pisa, choca con una columna, queda afuera…). */
  issues: Record<string, string>
  racks: PlacedRack[]
  /** Un módulo de muestra del rack elegido (para medidas y perfiles). */
  sample: RackStructure
  positions: number
  capacity: number
  materials: MaterialLine[]
  /** Piezas de todos los racks juntos (para los accesorios). */
  counts: ComponentCounts
}

/** Medidas de un módulo del rack configurado (las que usa la distribución). */
export function moduleSize(config: RackConfiguration): { size: RackModuleSize; sample: RackStructure } {
  const c = sanitizeConfiguration({ ...config, sections: [], layout: { ...config.layout, rows: 1, backToBack: false, warehouseLength: 0, warehouseWidth: 0 } })
  const sample = calculateRackStructure({ ...c, positions: 1 })
  return { sample, size: { width: c.width, depth: c.depth, upright: sample.upright.faceWidth, backToBackGap: DESIGN_RULES.backToBackGap } }
}

/** Estructura de un rack ubicado: una fila, o un par espalda con espalda, de `modules` módulos. */
export function placementStructure(config: RackConfiguration, p: RackPlacement): RackStructure {
  const c = sanitizeConfiguration(config)
  return calculateRackStructure({
    ...c,
    sections: [{ modules: p.modules, width: c.width, height: c.height, levels: c.levels }],
    layout: { ...c.layout, rows: p.pair ? 2 : 1, backToBack: p.pair, warehouseLength: 0, warehouseWidth: 0 },
  })
}

/**
 * Los racks iguales (mismos módulos, simple o doble) comparten la estructura: así, al mover un
 * rack no se recalculan ni se vuelven a dibujar los demás.
 */
const structures = new WeakMap<RackConfiguration, Map<string, RackStructure>>()
function cachedStructure(config: RackConfiguration, p: RackPlacement): RackStructure {
  let byKey = structures.get(config)
  if (!byKey) { byKey = new Map(); structures.set(config, byKey) }
  const key = `${p.modules}|${p.pair}`
  let s = byKey.get(key)
  if (!s) { s = placementStructure(config, p); byKey.set(key, s) }
  return s
}

/** Suma las listas de materiales de varios racks (misma pieza = mismo código). */
export function mergeMaterials(lists: MaterialLine[][]): MaterialLine[] {
  const by = new Map<string, MaterialLine>()
  for (const l of lists.flat()) {
    const prev = by.get(l.code)
    if (prev) prev.qty += l.qty
    else by.set(l.code, { ...l })
  }
  return [...by.values()]
}

function sumCounts(list: ComponentCounts[], zero: ComponentCounts): ComponentCounts {
  const out = Object.fromEntries(Object.keys(zero).map((k) => [k, 0])) as unknown as ComponentCounts
  for (const c of list) for (const k of Object.keys(out) as (keyof ComponentCounts)[]) out[k] += c[k]
  return out
}

export function buildDepot(plan: Plan, config: RackConfiguration, options: LayoutOptions): Depot {
  const { size, sample } = moduleSize(config)
  const layout = plan.racks ? manualLayout(plan.racks, size) : autoLayout(plan, size, options)
  const racks = layout.placements.map((placement) => ({ placement, structure: cachedStructure(config, placement) }))
  const positions = racks.reduce((n, r) => n + r.structure.positionsAvailable, 0)
  return {
    layout, racks, sample, positions,
    manual: !!plan.racks,
    issues: rackIssues(plan, layout.placements),
    capacity: positions * sample.config.palletWeight,
    materials: mergeMaterials(racks.map((r) => r.structure.materials)),
    counts: sumCounts(racks.map((r) => r.structure.counts), sample.counts),
  }
}

const n = (v: number) => v.toLocaleString('es-AR')

/** Texto del depósito completo para el pedido de presupuesto. */
export function depotSummaryText(plan: Plan, depot: Depot, options: LayoutOptions): string {
  const s = depot.sample
  const c = s.config
  return [
    'DEPÓSITO',
    `Superficie: ${n(Math.round(planArea(plan.outline)))} m² · ${n(plan.columns.length)} columnas · altura de paredes ${n(plan.wallHeight)} mm`,
    '',
    'DISTRIBUCIÓN',
    `${n(depot.layout.rows)} filas de rack selectivo${options.backToBack ? ' (dobles espalda con espalda)' : ''} · ${n(depot.layout.modules)} módulos`,
    depot.manual ? 'Racks ubicados a mano sobre el plano' : `Pasillos de ${n(options.aisle)} mm · filas ${options.orientation === 'x' ? 'a lo largo' : 'a lo ancho'} del depósito`,
    ...(Object.keys(depot.issues).length ? [`ATENCIÓN: ${n(Object.keys(depot.issues).length)} racks con interferencias (se pisan, chocan con columnas o quedan fuera)`] : []),
    `${n(depot.positions)} posiciones de pallet · capacidad estimada ${n(depot.capacity)} kg`,
    '',
    'RACK',
    `Largo de viga ${n(c.width)} mm · profundidad ${n(c.depth)} mm · altura ${n(c.height)} mm · ${n(c.levels)} niveles`,
    `Pallet ${s.pallet.name} · ${n(c.palletWeight)} kg · ${s.upright.name} · ${s.beam.name}`,
    '',
    'LISTA DE MATERIALES (todo el depósito)',
    ...depot.materials.map((l) => `${n(l.qty)} × ${l.name}${l.detail ? ` (${l.detail})` : ''}`),
  ].join('\n')
}
