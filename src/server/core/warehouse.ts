/**
 * Almacén: mapa, racks, posiciones y ubicaciones.
 * Un rack nace de una configuración del Diseñador 3D: se calcula con el mismo motor
 * (calculateRackStructure) y cada posición pasa a ser una ubicación con código A-04-03-02.
 */
import { calculateRackStructure } from '../../shared/rack/calculateRackStructure'
import { DEFAULT_CONFIGURATION } from '../../shared/rack/technicalSpecs'
import type { RackConfiguration } from '../../shared/rack/types'
import { positionStatus } from '../../shared/stock'
import type {
  Location, LocationDetail, PositionContent, PositionStatus, RackDetail, RackPosition, RackSummary, Warehouse, WarehouseMap, Zone,
} from '../../shared/types'
import type { Db } from '../db/db'
import { logActivity } from './activity'
import { conflict, firstName, invalid, notFound, requirePermission, type Ctx } from './context'
import { inventoryRows } from './products'

const pad = (n: number) => String(n).padStart(2, '0')

/* ------------------------------ Lecturas ------------------------------ */

export function getWarehouse(db: Db, id: number): Warehouse {
  const w = db.get<{ id: number; name: string; address: string; length_mm: number; width_mm: number }>(
    'SELECT id, name, address, length_mm, width_mm FROM warehouses WHERE id = :id', { id },
  )
  if (!w) throw notFound('El almacén')
  return { id: w.id, name: w.name, address: w.address, lengthMm: w.length_mm, widthMm: w.width_mm }
}

export function listWarehouses(ctx: Ctx): Warehouse[] {
  return ctx.db.all<{ id: number }>('SELECT id FROM warehouses ORDER BY id').map((w) => getWarehouse(ctx.db, w.id))
}

interface RackRow {
  id: number; warehouse_id: number; code: string; aisle: string; number: number; x_mm: number; y_mm: number; facing: 1 | -1
  length_mm: number; depth_mm: number; height_mm: number; modules: number; levels: number; slots_per_module: number
  config: string; positions: number; occupied: number; reserved: number; units: number
}

const RACK_SELECT = `
  SELECT r.*,
    (SELECT COUNT(*) FROM rack_positions rp WHERE rp.rack_id = r.id) AS positions,
    (SELECT COUNT(DISTINCT rp.id) FROM rack_positions rp JOIN inventory i ON i.location_id = rp.location_id
      WHERE rp.rack_id = r.id AND i.quantity > 0) AS occupied,
    (SELECT COUNT(DISTINCT rp.id) FROM rack_positions rp JOIN inventory i ON i.location_id = rp.location_id
      WHERE rp.rack_id = r.id AND i.reserved > 0) AS reserved,
    (SELECT COALESCE(SUM(i.quantity), 0) FROM rack_positions rp JOIN inventory i ON i.location_id = rp.location_id
      WHERE rp.rack_id = r.id) AS units
  FROM racks r`

const toRack = (r: RackRow): RackSummary => ({
  id: r.id, warehouseId: r.warehouse_id, code: r.code, aisle: r.aisle, number: r.number, x: r.x_mm, y: r.y_mm, facing: r.facing,
  lengthMm: r.length_mm, depthMm: r.depth_mm, heightMm: r.height_mm, modules: r.modules, levels: r.levels,
  slotsPerModule: r.slots_per_module, config: JSON.parse(r.config), positions: r.positions, occupied: r.occupied,
  reserved: r.reserved, units: r.units,
})

export function listRacks(ctx: Ctx, warehouseId: number): RackSummary[] {
  return ctx.db.all<RackRow>(`${RACK_SELECT} WHERE r.warehouse_id = :warehouseId ORDER BY r.aisle, r.number`, { warehouseId }).map(toRack)
}

export function getWarehouseMap(ctx: Ctx, warehouseId: number): WarehouseMap {
  requirePermission(ctx, 'almacen.ver')
  const warehouse = getWarehouse(ctx.db, warehouseId)
  const zones = ctx.db.all<{ id: number; code: string; name: string; x_mm: number; y_mm: number; w_mm: number; h_mm: number; units: number }>(
    `SELECT l.id, l.code, l.name, l.x_mm, l.y_mm, l.w_mm, l.h_mm,
            (SELECT COALESCE(SUM(i.quantity), 0) FROM inventory i WHERE i.location_id = l.id) AS units
       FROM warehouse_locations l WHERE l.warehouse_id = :warehouseId AND l.kind = 'zona' AND l.active = 1 ORDER BY l.code`,
    { warehouseId },
  ).map<Zone>((z) => ({ id: z.id, code: z.code, name: z.name, x: z.x_mm, y: z.y_mm, w: z.w_mm, h: z.h_mm, units: z.units }))
  const racks = listRacks(ctx, warehouseId)
  const aisles = [...new Set(racks.map((r) => r.aisle))].sort().map((aisle) => {
    const rs = racks.filter((r) => r.aisle === aisle)
    return { aisle, racks: rs.length, positions: rs.reduce((s, r) => s + r.positions, 0), occupied: rs.reduce((s, r) => s + r.occupied, 0) }
  })
  return {
    warehouse, zones, racks, aisles,
    totals: {
      positions: racks.reduce((s, r) => s + r.positions, 0),
      occupied: racks.reduce((s, r) => s + r.occupied, 0),
      reserved: racks.reduce((s, r) => s + r.reserved, 0),
      units: racks.reduce((s, r) => s + r.units, 0) + zones.reduce((s, z) => s + z.units, 0),
    },
  }
}

function positionsOf(ctx: Ctx, rackIds: number[]): RackPosition[] {
  if (!rackIds.length) return []
  const params = Object.fromEntries(rackIds.map((id, k) => [`r${k}`, id]))
  const rows = ctx.db.all<{ id: number; rack_id: number; rack_code: string; location_id: number; code: string; module: number; level: number; slot: number }>(
    `SELECT rp.id, rp.rack_id, r.code AS rack_code, rp.location_id, rp.code, rp.module, rp.level, rp.slot
       FROM rack_positions rp JOIN racks r ON r.id = rp.rack_id
      WHERE rp.rack_id IN (${rackIds.map((_, k) => `:r${k}`).join(', ')}) ORDER BY rp.level DESC, rp.module, rp.slot`,
    params,
  )
  const contents = new Map<number, PositionContent[]>()
  for (const inv of inventoryRows(ctx, { locationIds: rows.map((r) => r.location_id) })) {
    const list = contents.get(inv.locationId) ?? []
    list.push({
      inventoryId: inv.id, productId: inv.productId, productCode: inv.productCode, productName: inv.productName, unit: inv.unit,
      quantity: inv.quantity, reserved: inv.reserved, available: inv.available, orders: inv.orders,
    })
    contents.set(inv.locationId, list)
  }
  return rows.map((r) => {
    const c = contents.get(r.location_id) ?? []
    return {
      id: r.id, rackId: r.rack_id, rackCode: r.rack_code, locationId: r.location_id, code: r.code,
      module: r.module, level: r.level, slot: r.slot, contents: c,
      status: aggregateStatus(c),
    }
  })
}

function aggregateStatus(c: PositionContent[]): PositionStatus {
  return positionStatus(c.reduce((s, x) => s + x.quantity, 0), c.reduce((s, x) => s + x.reserved, 0))
}

export function getRack(ctx: Ctx, id: number): RackDetail {
  requirePermission(ctx, 'almacen.ver')
  const r = ctx.db.get<RackRow>(`${RACK_SELECT} WHERE r.id = :id`, { id })
  if (!r) throw notFound('El rack')
  return { ...toRack(r), positionsList: positionsOf(ctx, [id]) }
}

/** Estado de todas las posiciones (para colorear el almacén en 3D). */
export function allPositions(ctx: Ctx, warehouseId: number): RackPosition[] {
  requirePermission(ctx, 'almacen.ver')
  const ids = ctx.db.all<{ id: number }>('SELECT id FROM racks WHERE warehouse_id = :warehouseId', { warehouseId }).map((r) => r.id)
  return positionsOf(ctx, ids)
}

const toLocation = (l: { id: number; warehouse_id: number; code: string; kind: Location['kind']; name: string; sector: string }): Location => ({
  id: l.id, warehouseId: l.warehouse_id, code: l.code, kind: l.kind, name: l.name, sector: l.sector,
})

export function getLocationDetail(ctx: Ctx, code: string): LocationDetail {
  requirePermission(ctx, 'almacen.ver')
  const l = ctx.db.get<{ id: number; warehouse_id: number; code: string; kind: Location['kind']; name: string; sector: string }>(
    'SELECT id, warehouse_id, code, kind, name, sector FROM warehouse_locations WHERE code = :code AND active = 1', { code: code.toUpperCase() },
  )
  if (!l) throw notFound(`La ubicación ${code}`)
  const pos = ctx.db.get<{ rack_id: number }>('SELECT rack_id FROM rack_positions WHERE location_id = :id', { id: l.id })
  const position = pos ? positionsOf(ctx, [pos.rack_id]).find((p) => p.locationId === l.id) ?? null : null
  const rack = pos ? toRack(ctx.db.get<RackRow>(`${RACK_SELECT} WHERE r.id = :id`, { id: pos.rack_id })!) : null
  const contents = position?.contents ?? inventoryRows(ctx, { locationIds: [l.id] }).map((inv) => ({
    inventoryId: inv.id, productId: inv.productId, productCode: inv.productCode, productName: inv.productName, unit: inv.unit,
    quantity: inv.quantity, reserved: inv.reserved, available: inv.available, orders: inv.orders,
  }))
  return { location: toLocation(l), position, rack, contents, status: aggregateStatus(contents) }
}

/** Buscador de ubicaciones (para elegir destino al mover o recibir). */
export function searchLocations(ctx: Ctx, q: { search?: string; freeOnly?: boolean; limit?: number }): (Location & { units: number; products: number })[] {
  requirePermission(ctx, 'almacen.ver')
  const rows = ctx.db.all<{ id: number; warehouse_id: number; code: string; kind: Location['kind']; name: string; sector: string; units: number; products: number }>(
    `SELECT l.id, l.warehouse_id, l.code, l.kind, l.name, l.sector,
            COALESCE(SUM(i.quantity), 0) AS units, COUNT(CASE WHEN i.quantity > 0 THEN 1 END) AS products
       FROM warehouse_locations l LEFT JOIN inventory i ON i.location_id = l.id
      WHERE l.active = 1 ${q.search ? 'AND (l.code LIKE :q OR l.name LIKE :q OR l.sector LIKE :q)' : ''}
      GROUP BY l.id
      ${q.freeOnly ? 'HAVING units = 0' : ''}
      ORDER BY l.kind DESC, l.code LIMIT :limit`,
    { q: `%${q.search ?? ''}%`, limit: q.limit ?? 40 },
  )
  return rows.map((r) => ({ ...toLocation(r), units: r.units, products: r.products }))
}

export function listSectors(ctx: Ctx, warehouseId: number): string[] {
  return ctx.db.all<{ sector: string }>(
    'SELECT DISTINCT sector FROM warehouse_locations WHERE warehouse_id = :warehouseId AND active = 1 ORDER BY sector', { warehouseId },
  ).map((r) => r.sector)
}

/* ------------------------------ Racks desde el Diseñador 3D ------------------------------ */

export interface NewRackInput {
  warehouseId: number
  aisle: string
  number?: number
  config: RackConfiguration
  x?: number
  y?: number
  facing?: 1 | -1
}

const AISLE_GAP = 3000
const RACK_GAP = 100

export function createRack(ctx: Ctx, input: NewRackInput): RackDetail {
  requirePermission(ctx, 'almacen.editar')
  const aisle = input.aisle.trim().toUpperCase()
  if (!/^[A-Z]$/.test(aisle)) throw invalid('El pasillo se identifica con una letra (A, B, C…).')
  const wh = getWarehouse(ctx.db, input.warehouseId)

  // una fila por rack: el resto de la configuración sale tal cual del diseñador
  const config: RackConfiguration = {
    ...DEFAULT_CONFIGURATION, ...input.config,
    layout: { ...DEFAULT_CONFIGURATION.layout, ...input.config?.layout, rows: 1, backToBack: false, warehouseLength: 0, warehouseWidth: 0 },
  }
  const s = calculateRackStructure(config)
  // el mapa del almacén guarda módulos × niveles × posiciones iguales en todo el rack
  if (s.sections.length > 1) throw invalid('Por ahora el almacén acepta racks de un solo tramo. Agregá cada tramo como un rack aparte.')
  const number = input.number ?? (ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM racks WHERE warehouse_id = :w AND aisle = :aisle', { w: wh.id, aisle })?.n ?? 1)
  const code = `${aisle}-${pad(number)}`
  if (ctx.db.get('SELECT id FROM racks WHERE warehouse_id = :w AND code = :code', { w: wh.id, code })) throw conflict(`Ya existe el rack ${code}.`)

  const length = s.totalWidth
  const depth = s.config.depth
  let x = input.x
  let y = input.y
  if (x === undefined || y === undefined) {
    // ubicación automática: al final de su pasillo, o en un pasillo nuevo debajo de los existentes
    const row = ctx.db.get<{ end: number | null; y: number | null }>(
      'SELECT MAX(x_mm + length_mm) AS end, MIN(y_mm) AS y FROM racks WHERE warehouse_id = :w AND aisle = :aisle', { w: wh.id, aisle },
    )
    if (row?.end != null && row.y != null) {
      x = row.end + RACK_GAP
      y = row.y
    } else {
      const last = ctx.db.get<{ bottom: number | null }>('SELECT MAX(y_mm + depth_mm) AS bottom FROM racks WHERE warehouse_id = :w', { w: wh.id })
      x = 2000
      y = last?.bottom != null ? last.bottom + AISLE_GAP : 6000
    }
  }
  if (x < 0 || y < 0 || x + length > wh.lengthMm || y + depth > wh.widthMm)
    throw invalid(`El rack ${code} (${length.toLocaleString('es-AR')} × ${depth.toLocaleString('es-AR')} mm) no entra en el almacén en esa posición.`)

  const id = ctx.db.transaction(() => {
    const { lastInsertRowid: rackId } = ctx.db.run(
      `INSERT INTO racks (warehouse_id, code, aisle, number, x_mm, y_mm, facing, length_mm, depth_mm, height_mm, modules, levels, slots_per_module, config, created_at)
       VALUES (:w, :code, :aisle, :number, :x, :y, :facing, :length, :depth, :height, :modules, :levels, :slots, :config, :now)`,
      {
        w: wh.id, code, aisle, number, x, y, facing: input.facing ?? 1, length, depth, height: s.config.height,
        modules: s.modulesPerRow, levels: s.storageLevels, slots: s.palletsPerModule, config: JSON.stringify(s.config), now: ctx.clock.now(),
      },
    )
    for (let level = 1; level <= s.storageLevels; level++) {
      for (let module = 1; module <= s.modulesPerRow; module++) {
        for (let slot = 1; slot <= s.palletsPerModule; slot++) {
          const pos = (module - 1) * s.palletsPerModule + slot
          const posCode = `${code}-${pad(level)}-${pad(pos)}`
          const { lastInsertRowid: locationId } = ctx.db.run(
            `INSERT INTO warehouse_locations (warehouse_id, code, kind, name, sector) VALUES (:w, :code, 'rack', :name, :sector)`,
            { w: wh.id, code: posCode, name: `Rack ${code} · nivel ${level} · posición ${pos}`, sector: `Pasillo ${aisle}` },
          )
          ctx.db.run(
            'INSERT INTO rack_positions (rack_id, location_id, module, level, slot, code) VALUES (:rackId, :locationId, :module, :level, :slot, :code)',
            { rackId, locationId, module, level, slot, code: posCode },
          )
        }
      }
    }
    const total = s.storageLevels * s.modulesPerRow * s.palletsPerModule
    logActivity(ctx, {
      type: 'rack.creado',
      message: `${firstName(ctx.actor.name)} agregó el rack ${code} al almacén: ${s.modulesPerRow} módulos, ${s.storageLevels} niveles, ${total} posiciones`,
      sector: `Pasillo ${aisle}`, quantity: total,
    })
    return rackId
  })
  return getRack(ctx, id)
}

export function deleteRack(ctx: Ctx, id: number): void {
  requirePermission(ctx, 'almacen.editar')
  const rack = getRack(ctx, id)
  const busy = rack.positionsList.filter((p) => p.contents.length)
  if (busy.length) throw conflict(`El rack ${rack.code} tiene stock en ${busy.length} posiciones. Mové la mercadería antes de quitarlo.`)
  ctx.db.transaction(() => {
    const locIds = rack.positionsList.map((p) => p.locationId)
    ctx.db.run('DELETE FROM rack_positions WHERE rack_id = :id', { id })
    for (const loc of locIds) {
      ctx.db.run('DELETE FROM inventory WHERE location_id = :loc AND quantity = 0 AND id NOT IN (SELECT inventory_id FROM order_allocations) AND id NOT IN (SELECT inventory_id FROM inventory_count_lines WHERE inventory_id IS NOT NULL)', { loc })
      // las ubicaciones quedan inactivas (el historial las sigue nombrando) y liberan su código
      ctx.db.run("UPDATE warehouse_locations SET active = 0, code = code || '~' || id WHERE id = :loc", { loc })
    }
    ctx.db.run('DELETE FROM racks WHERE id = :id', { id })
    logActivity(ctx, { type: 'rack.eliminado', message: `${firstName(ctx.actor.name)} quitó el rack ${rack.code} del almacén`, sector: `Pasillo ${rack.aisle}` })
  })
}

/** Zonas de piso (recepción, despacho…). */
export function createZone(ctx: Ctx, input: { warehouseId: number; code: string; name: string; x: number; y: number; w: number; h: number }): void {
  requirePermission(ctx, 'almacen.editar')
  ctx.db.run(
    `INSERT INTO warehouse_locations (warehouse_id, code, kind, name, sector, x_mm, y_mm, w_mm, h_mm)
     VALUES (:warehouseId, :code, 'zona', :name, :name, :x, :y, :w, :h)`,
    { ...input, code: input.code.toUpperCase() },
  )
}
