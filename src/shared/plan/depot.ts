/**
 * EL DEPÓSITO COMPLETO: cada rack ubicado se arma con el mismo motor del cotizador
 * (calculateRackStructure) y se suman posiciones, capacidad y la lista de materiales.
 */
import { calculateRackStructure, sanitizeConfiguration } from '../rack/calculateRackStructure'
import { DESIGN_RULES } from '../rack/technicalSpecs'
import type { ComponentCounts, MaterialLine, RackConfiguration, RackSection, RackStructure } from '../rack/types'
import { planArea } from './geometry'
import { autoLayout, type LayoutOptions, type LayoutResult, type RackModuleSize } from './layout'
import { manualLayout, rackIssues } from './racks'
import type { Plan, RackPlacement } from './types'
import { metros } from '../units'
import { profilesOf } from '../rack/profiles'

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
  return { sample, size: { width: c.width, depth: c.depth, upright: sample.upright.faceWidth, backToBackGap: DESIGN_RULES.backToBackGap,
    uprightWidths: Object.fromEntries(profilesOf(c).uprights.map((u) => [u.id, u.faceWidth])),
    pallets: sample.palletsPerModule, palletFront: sample.pallet.front, palletDeep: sample.pallet.deep } }
}

/**
 * Los tramos del rack: uno solo si todos sus módulos son iguales; si algún módulo tiene sus propias
 * vigas (largo, perfil o alturas), un tramo por cada grupo de módulos seguidos iguales.
 */
function rackSections(p: RackPlacement, c: RackConfiguration): RackSection[] {
  const base: RackSection = { modules: p.modules, width: c.width, height: c.height, levels: c.levels }
  const mods = p.mods ? Object.entries(p.mods).filter(([k]) => Number(k) < p.modules) : []
  if (!mods.length) return [base]
  const out: RackSection[] = []
  let lastKey = ''
  for (let m = 0; m < p.modules; m++) {
    const o = p.mods?.[m]
    // este módulo puede tener menos vigas (las que se borraron) y el piso libre (un paso)
    const floor = c.floorStorage && !o?.noFloor
    const beams = o?.beamElevations?.length ?? (c.floorStorage ? c.levels - 1 : c.levels)
    const sec: RackSection = {
      modules: 1, width: o?.width ?? c.width, height: c.height, levels: beams + (floor ? 1 : 0),
      ...(o?.beamElevations ? { beamElevations: o.beamElevations } : {}),
      ...(o?.beamId ? { beamId: o.beamId } : {}),
      ...(o?.noFloor ? { floorStorage: false } : {}),
    }
    const key = JSON.stringify({ ...sec, modules: 0 })
    if (key === lastKey) out[out.length - 1].modules++
    else { out.push(sec); lastKey = key }
  }
  return out
}

/** Estructura de un rack ubicado: una fila, o un par espalda con espalda, de `modules` módulos. */
export function placementStructure(config: RackConfiguration, p: RackPlacement): RackStructure {
  // un rack puede tener su propia altura y cantidad de niveles
  const c = sanitizeConfiguration({
    ...config, height: p.height ?? config.height, levels: p.levels ?? config.levels,
    // piezas propias: largo de viga, fondo del pórtico, altura de cada viga y perfiles
    width: p.beamLength ?? config.width, depth: p.frameDepth ?? config.depth,
    beamElevations: p.beamElevations ?? config.beamElevations,
    uprightId: p.uprightId ?? config.uprightId, beamId: p.beamId ?? config.beamId,
  })
  return calculateRackStructure({
    ...c,
    sections: rackSections(p, c),
    frameHeights: p.frameHeights,
    frameParts: p.frameParts,
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
  const key = `${p.modules}|${p.pair}|${p.levels ?? ''}|${p.height ?? ''}|${p.beamLength ?? ''}|${p.frameDepth ?? ''}|${p.beamElevations?.join(',') ?? ''}|${p.uprightId ?? ''}|${p.beamId ?? ''}|${p.mods ? JSON.stringify(p.mods) : ''}|${p.frameHeights ? JSON.stringify(p.frameHeights) : ''}|${p.frameParts ? JSON.stringify(p.frameParts) : ''}`
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
    `Superficie: ${n(Math.round(planArea(plan.outline)))} m² · ${n(plan.columns.length)} columnas · altura de paredes ${metros(plan.wallHeight)}`,
    '',
    'DISTRIBUCIÓN',
    `${n(depot.layout.rows)} filas de rack selectivo${options.backToBack ? ' (dobles espalda con espalda)' : ''} · ${n(depot.layout.modules)} módulos (${n(Math.min(depot.layout.rows, depot.layout.modules))} iniciales + ${n(Math.max(0, depot.layout.modules - depot.layout.rows))} adicionales)`,
    depot.manual ? 'Racks ubicados a mano sobre el plano' : `Pasillos de ${metros(options.aisle)} · filas ${options.orientation === 'x' ? 'a lo largo' : 'a lo ancho'} del depósito`,
    ...(Object.keys(depot.issues).length ? [`ATENCIÓN: ${n(Object.keys(depot.issues).length)} racks con interferencias (se pisan, chocan con columnas o quedan fuera)`] : []),
    `${n(depot.positions)} posiciones de pallet · capacidad estimada ${n(depot.capacity)} kg`,
    '',
    'RACK',
    `Largo de viga ${metros(c.width)} · profundidad ${metros(c.depth)} · altura ${metros(c.height)} · ${n(c.levels)} niveles`,
    `Pallet ${s.pallet.name} · ${n(c.palletWeight)} kg · ${s.upright.name} · ${s.beam.name}`,
    '',
    'LISTA DE MATERIALES (todo el depósito)',
    ...depot.materials.map((l) => `${n(l.qty)} × ${l.name}${l.detail ? ` (${l.detail})` : ''}`),
  ].join('\n')
}
