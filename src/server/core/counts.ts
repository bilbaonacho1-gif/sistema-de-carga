/**
 * Conteo físico: CONTAR → DETECTAR DIFERENCIAS → ACTUALIZAR INVENTARIO.
 * Al iniciar se toma una foto del stock del sector; al confirmar, lo contado
 * reemplaza al stock del sistema con movimientos de ajuste.
 */
import type { CountLine, CountStatus, InventoryCount, InventoryCountDetail } from '../../shared/types'
import { logActivity } from './activity'
import { conflict, firstName, invalid, notFound, requirePermission, type Ctx } from './context'
import { adjustStock, ensureInventoryRow, getLocation, getProductRow } from './inventory'
import { notifyRoles } from './notifications'

export const ALL_SECTORS = 'Todo el almacén'

interface CountRow {
  id: number; warehouse_id: number; sector: string; status: CountStatus; started_by: number; started_name: string
  started_at: string; confirmed_name: string | null; confirmed_at: string | null
}

interface LineRow {
  id: number; inventory_id: number | null; product_id: number; code: string; name: string; unit: string
  location_code: string; system_qty: number; counted_qty: number | null; current_qty: number | null; final_qty: number | null
}

function lines(ctx: Ctx, countId: number): CountLine[] {
  return ctx.db.all<LineRow>(
    `SELECT cl.id, cl.inventory_id, cl.product_id, p.code, p.name, p.unit, l.code AS location_code,
            cl.system_qty, cl.counted_qty, i.quantity AS current_qty, cl.final_qty
       FROM inventory_count_lines cl
       JOIN products p ON p.id = cl.product_id
       JOIN warehouse_locations l ON l.id = cl.location_id
       LEFT JOIN inventory i ON i.id = cl.inventory_id
      WHERE cl.count_id = :countId ORDER BY l.code, p.name`,
    { countId },
  ).map((r) => ({
    id: r.id, inventoryId: r.inventory_id, productId: r.product_id, productCode: r.code, productName: r.name, unit: r.unit,
    locationCode: r.location_code, systemQty: r.system_qty, countedQty: r.counted_qty,
    // abierto: el stock de ahora; cerrado: el que había al cerrarlo (no cambia con movimientos posteriores)
    currentQty: r.final_qty ?? r.current_qty ?? 0,
  }))
}

function summarize(ls: CountLine[]): InventoryCount['summary'] {
  let differences = 0, plus = 0, minus = 0, counted = 0
  for (const l of ls) {
    if (l.countedQty === null) continue
    counted++
    const d = l.countedQty - l.currentQty
    if (d !== 0) differences++
    if (d > 0) plus += d
    if (d < 0) minus -= d
  }
  return { lines: ls.length, counted, differences, plus, minus }
}

const toCount = (r: CountRow, ls: CountLine[]): InventoryCount => ({
  id: r.id, warehouseId: r.warehouse_id, sector: r.sector, status: r.status, startedById: r.started_by, startedByName: r.started_name,
  startedAt: r.started_at, confirmedByName: r.confirmed_name, confirmedAt: r.confirmed_at, summary: summarize(ls),
})

const COUNT_SELECT = `SELECT c.*, us.name AS started_name, uc.name AS confirmed_name FROM inventory_counts c
  JOIN users us ON us.id = c.started_by LEFT JOIN users uc ON uc.id = c.confirmed_by`

export function listCounts(ctx: Ctx): InventoryCount[] {
  requirePermission(ctx, 'conteo.gestionar')
  return ctx.db.all<CountRow>(`${COUNT_SELECT} ORDER BY c.id DESC LIMIT 50`).map((r) => toCount(r, lines(ctx, r.id)))
}

export function getCount(ctx: Ctx, id: number): InventoryCountDetail {
  requirePermission(ctx, 'conteo.gestionar')
  const r = ctx.db.get<CountRow>(`${COUNT_SELECT} WHERE c.id = :id`, { id })
  if (!r) throw notFound('El conteo')
  const ls = lines(ctx, id)
  return { ...toCount(r, ls), lines: ls }
}

export function startCount(ctx: Ctx, input: { warehouseId: number; sector: string }): InventoryCountDetail {
  requirePermission(ctx, 'conteo.gestionar')
  const sector = input.sector.trim()
  const open = ctx.db.get<{ id: number; sector: string }>(
    `SELECT id, sector FROM inventory_counts WHERE status = 'en_curso' AND warehouse_id = :w AND (sector = :sector OR sector = :all OR :sector = :all)`,
    { w: input.warehouseId, sector, all: ALL_SECTORS },
  )
  if (open) throw conflict(`Ya hay un conteo en curso para ${open.sector} (#${open.id}). Terminalo o cancelalo antes de empezar otro.`)
  const rows = ctx.db.all<{ id: number; product_id: number; location_id: number; quantity: number }>(
    `SELECT i.id, i.product_id, i.location_id, i.quantity FROM inventory i
       JOIN warehouse_locations l ON l.id = i.location_id
      WHERE l.warehouse_id = :w AND l.active = 1 AND i.quantity > 0 ${sector === ALL_SECTORS ? '' : 'AND l.sector = :sector'}
      ORDER BY l.code`,
    { w: input.warehouseId, sector },
  )
  if (!rows.length) throw invalid(`No hay stock registrado en ${sector}.`)
  const id = ctx.db.transaction(() => {
    const now = ctx.clock.now()
    const { lastInsertRowid: countId } = ctx.db.run(
      `INSERT INTO inventory_counts (warehouse_id, sector, status, started_by, started_at) VALUES (:w, :sector, 'en_curso', :me, :now)`,
      { w: input.warehouseId, sector, me: ctx.actor.id, now },
    )
    for (const r of rows)
      ctx.db.run(
        `INSERT INTO inventory_count_lines (count_id, inventory_id, product_id, location_id, system_qty) VALUES (:countId, :id, :product_id, :location_id, :quantity)`,
        { ...r, countId },
      )
    logActivity(ctx, { type: 'conteo.iniciado', message: `${firstName(ctx.actor.name)} inició el conteo #${countId} de ${sector} (${rows.length} ubicaciones con stock)`, sector })
    return countId
  })
  return getCount(ctx, id)
}

function assertOpen(ctx: Ctx, id: number): InventoryCountDetail {
  const c = getCount(ctx, id)
  if (c.status !== 'en_curso') throw conflict(`El conteo #${id} ya está ${c.status === 'confirmado' ? 'confirmado' : 'cancelado'}.`)
  return c
}

export function setCountLine(ctx: Ctx, countId: number, lineId: number, countedQty: number | null): InventoryCountDetail {
  const c = assertOpen(ctx, countId)
  if (!c.lines.some((l) => l.id === lineId)) throw notFound('La línea del conteo')
  if (countedQty !== null && (!Number.isInteger(countedQty) || countedQty < 0)) throw invalid('El conteo tiene que ser un entero mayor o igual a cero.')
  ctx.db.run(
    'UPDATE inventory_count_lines SET counted_qty = :q, counted_by = :me, counted_at = :now WHERE id = :lineId AND count_id = :countId',
    { q: countedQty, me: countedQty === null ? null : ctx.actor.id, now: countedQty === null ? null : ctx.clock.now(), lineId, countId },
  )
  return getCount(ctx, countId)
}

/** Hallazgo: mercadería que no figuraba en esa ubicación. */
export function addCountLine(ctx: Ctx, countId: number, input: { productId: number; locationId: number; countedQty: number }): InventoryCountDetail {
  const c = assertOpen(ctx, countId)
  const loc = getLocation(ctx.db, input.locationId)
  getProductRow(ctx.db, input.productId)
  if (c.sector !== ALL_SECTORS && loc.sector !== c.sector) throw invalid(`${loc.code} no pertenece a ${c.sector}.`)
  if (!Number.isInteger(input.countedQty) || input.countedQty < 0) throw invalid('El conteo tiene que ser un entero mayor o igual a cero.')
  ctx.db.transaction(() => {
    const row = ensureInventoryRow(ctx, input.productId, loc.id)
    if (c.lines.some((l) => l.inventoryId === row.id)) throw conflict('Ese producto ya está en la lista del conteo para esa ubicación.')
    ctx.db.run(
      `INSERT INTO inventory_count_lines (count_id, inventory_id, product_id, location_id, system_qty, counted_qty, counted_by, counted_at)
       VALUES (:countId, :inv, :productId, :locationId, :sys, :q, :me, :now)`,
      { countId, inv: row.id, productId: input.productId, locationId: loc.id, sys: row.quantity, q: input.countedQty, me: ctx.actor.id, now: ctx.clock.now() },
    )
  })
  return getCount(ctx, countId)
}

/** Guarda la cantidad del sistema de cada línea en el momento de cerrar el conteo. */
function freezeSystemQty(ctx: Ctx, countId: number): void {
  ctx.db.run(
    `UPDATE inventory_count_lines
        SET final_qty = COALESCE((SELECT quantity FROM inventory WHERE id = inventory_count_lines.inventory_id), 0)
      WHERE count_id = :countId`,
    { countId },
  )
}

export function confirmCount(ctx: Ctx, id: number): InventoryCountDetail {
  const c = assertOpen(ctx, id)
  if (!c.summary.counted) throw invalid('Cargá al menos un conteo antes de confirmar.')
  ctx.db.transaction(() => {
    freezeSystemQty(ctx, id)
    let adjusted = 0
    for (const l of c.lines) {
      if (l.countedQty === null || l.inventoryId === null) continue
      if (adjustStock(ctx, { inventoryId: l.inventoryId, newQuantity: l.countedQty, countId: id }) !== 0) adjusted++
    }
    ctx.db.run(`UPDATE inventory_counts SET status = 'confirmado', confirmed_by = :me, confirmed_at = :now WHERE id = :id`, { id, me: ctx.actor.id, now: ctx.clock.now() })
    const s = c.summary
    logActivity(ctx, {
      type: 'conteo.confirmado',
      message: `${firstName(ctx.actor.name)} confirmó el conteo #${id} de ${c.sector}: ${s.counted} ubicaciones contadas, ${adjusted} ajustes (+${s.plus} / −${s.minus})`,
      sector: c.sector,
    })
    if (adjusted) notifyRoles(ctx, ['admin'], {
      type: 'conteo.diferencias', title: `Conteo #${id}: ${adjusted} diferencia${adjusted === 1 ? '' : 's'}`,
      body: `${c.sector}: +${s.plus} / −${s.minus} unidades ajustadas.`,
    })
  })
  return getCount(ctx, id)
}

export function cancelCount(ctx: Ctx, id: number): InventoryCountDetail {
  const c = assertOpen(ctx, id)
  ctx.db.transaction(() => {
    freezeSystemQty(ctx, id)
    ctx.db.run(`UPDATE inventory_counts SET status = 'cancelado', confirmed_by = :me, confirmed_at = :now WHERE id = :id`, { id, me: ctx.actor.id, now: ctx.clock.now() })
    logActivity(ctx, { type: 'conteo.cancelado', message: `${firstName(ctx.actor.name)} canceló el conteo #${id} de ${c.sector}`, sector: c.sector })
  })
  return getCount(ctx, id)
}
