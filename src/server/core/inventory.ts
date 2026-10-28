/**
 * Operaciones de stock. Es la única parte que toca la tabla `inventory`:
 * cada cambio deja un movimiento (inventory_movements), una línea en el historial
 * y, si el disponible cruza el mínimo, una notificación.
 *
 * Invariante: inventory.reserved = suma de las reservas no entregadas que apuntan a esa fila.
 */
import { orderNumber } from '../../shared/orders'
import type { LocationKind, MovementType } from '../../shared/types'
import type { Db } from '../db/db'
import { logActivity } from './activity'
import { conflict, firstName, invalid, notFound, requirePermission, type Ctx } from './context'
import { notifyRoles, notifyUsers } from './notifications'

/* ------------------------------ Lecturas básicas ------------------------------ */

export interface LocationRow {
  id: number
  warehouse_id: number
  code: string
  kind: LocationKind
  name: string
  sector: string
  active: number
}

export function getLocation(db: Db, id: number): LocationRow {
  const l = db.get<LocationRow>('SELECT id, warehouse_id, code, kind, name, sector, active FROM warehouse_locations WHERE id = :id', { id })
  if (!l) throw notFound('La ubicación')
  return l
}

interface ProductRow { id: number; code: string; name: string; unit: string; min_stock: number; active: number }

export function getProductRow(db: Db, id: number): ProductRow {
  const p = db.get<ProductRow>('SELECT id, code, name, unit, min_stock, active FROM products WHERE id = :id', { id })
  if (!p) throw notFound('El producto')
  return p
}

export function productAvailable(db: Db, productId: number): number {
  return db.get<{ n: number }>(
    'SELECT COALESCE(SUM(quantity - reserved), 0) AS n FROM inventory WHERE product_id = :productId', { productId },
  )?.n ?? 0
}

interface InventoryRowRaw { id: number; product_id: number; location_id: number; quantity: number; reserved: number }

export function getInventoryRow(db: Db, id: number): InventoryRowRaw {
  const r = db.get<InventoryRowRaw>('SELECT id, product_id, location_id, quantity, reserved FROM inventory WHERE id = :id', { id })
  if (!r) throw notFound('El registro de stock')
  return r
}

export function ensureInventoryRow(ctx: Ctx, productId: number, locationId: number): InventoryRowRaw {
  const existing = ctx.db.get<InventoryRowRaw>(
    'SELECT id, product_id, location_id, quantity, reserved FROM inventory WHERE product_id = :productId AND location_id = :locationId',
    { productId, locationId },
  )
  if (existing) return existing
  const { lastInsertRowid } = ctx.db.run(
    'INSERT INTO inventory (product_id, location_id, quantity, reserved, updated_at) VALUES (:productId, :locationId, 0, 0, :now)',
    { productId, locationId, now: ctx.clock.now() },
  )
  return { id: lastInsertRowid, product_id: productId, location_id: locationId, quantity: 0, reserved: 0 }
}

function setRow(ctx: Ctx, id: number, quantity: number, reserved: number): void {
  ctx.db.run('UPDATE inventory SET quantity = :quantity, reserved = :reserved, updated_at = :now WHERE id = :id', {
    id, quantity, reserved, now: ctx.clock.now(),
  })
}

interface MovementInput {
  type: MovementType
  productId: number
  fromLocationId?: number | null
  toLocationId?: number | null
  quantity: number
  orderId?: number | null
  countId?: number | null
  note?: string
}

function recordMovement(ctx: Ctx, m: MovementInput): void {
  ctx.db.run(
    `INSERT INTO inventory_movements (type, product_id, from_location_id, to_location_id, quantity, order_id, count_id, user_id, note, created_at)
     VALUES (:type, :productId, :fromLocationId, :toLocationId, :quantity, :orderId, :countId, :userId, :note, :now)`,
    { ...m, note: m.note ?? '', userId: ctx.actor.id, now: ctx.clock.now() },
  )
}

const qty = (n: number, unit: string) => `${n.toLocaleString('es-AR')} ${unit === 'u' ? (n === 1 ? 'unidad' : 'unidades') : unit}`

/* ------------------------------ Alertas de stock ------------------------------ */

/** Avisa sólo cuando el disponible CRUZA el mínimo o llega a cero (no en cada movimiento). */
export function checkStockAlerts(ctx: Ctx, productId: number, availableBefore: number): void {
  const p = getProductRow(ctx.db, productId)
  const after = productAvailable(ctx.db, productId)
  if (after <= 0 && availableBefore > 0) {
    notifyRoles(ctx, ['admin', 'encargado'], {
      type: 'stock.sin_stock',
      title: `Sin stock disponible: ${p.name}`,
      body: `${p.code} no tiene unidades disponibles. Mínimo: ${p.min_stock}.`,
      productId,
    })
  } else if (after < p.min_stock && availableBefore >= p.min_stock) {
    notifyRoles(ctx, ['admin', 'encargado'], {
      type: 'stock.bajo',
      title: `Stock bajo: ${p.name}`,
      body: `Disponible ${after} · mínimo ${p.min_stock}.`,
      productId,
    })
  }
}

/* ------------------------------ Ingreso, traslado, ajuste ------------------------------ */

export function addStock(ctx: Ctx, input: { productId: number; locationId: number; quantity: number; note?: string; orderId?: number | null }): void {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw invalid('La cantidad tiene que ser un número entero mayor a cero.')
  const p = getProductRow(ctx.db, input.productId)
  if (!p.active) throw invalid('El producto está dado de baja.')
  const loc = getLocation(ctx.db, input.locationId)
  if (!loc.active) throw invalid('La ubicación no está activa.')

  ctx.db.transaction(() => {
    const row = ensureInventoryRow(ctx, input.productId, input.locationId)
    setRow(ctx, row.id, row.quantity + input.quantity, row.reserved)
    recordMovement(ctx, { type: 'ingreso', productId: p.id, toLocationId: loc.id, quantity: input.quantity, orderId: input.orderId, note: input.note })
    logActivity(ctx, {
      type: 'stock.ingreso',
      message: `${firstName(ctx.actor.name)} agregó ${qty(input.quantity, p.unit)} de ${p.name} en ${loc.code}${input.orderId ? ` (reposición ${orderNumber(input.orderId)})` : ''}`,
      productId: p.id, locationId: loc.id, sector: loc.sector, quantity: input.quantity, orderId: input.orderId,
    })
  })
}

export function moveStock(ctx: Ctx, input: { inventoryId: number; toLocationId: number; quantity: number; note?: string }): void {
  const row = getInventoryRow(ctx.db, input.inventoryId)
  const p = getProductRow(ctx.db, row.product_id)
  const from = getLocation(ctx.db, row.location_id)
  const to = getLocation(ctx.db, input.toLocationId)
  if (from.id === to.id) throw invalid('Elegí una ubicación distinta a la actual.')
  if (!to.active) throw invalid('La ubicación de destino no está activa.')
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw invalid('La cantidad tiene que ser un número entero mayor a cero.')
  const available = row.quantity - row.reserved
  if (input.quantity > available)
    throw conflict(`Sólo se pueden mover unidades no reservadas. Disponibles en ${from.code}: ${available}.`)

  ctx.db.transaction(() => {
    setRow(ctx, row.id, row.quantity - input.quantity, row.reserved)
    const dest = ensureInventoryRow(ctx, row.product_id, to.id)
    setRow(ctx, dest.id, dest.quantity + input.quantity, dest.reserved)
    recordMovement(ctx, { type: 'traslado', productId: p.id, fromLocationId: from.id, toLocationId: to.id, quantity: input.quantity, note: input.note })
    logActivity(ctx, {
      type: 'stock.traslado',
      message: `${firstName(ctx.actor.name)} movió ${qty(input.quantity, p.unit)} de ${p.name} de ${from.code} a ${to.code}`,
      productId: p.id, locationId: to.id, sector: to.sector, quantity: input.quantity,
    })
  })
}

/**
 * Ajuste por conteo: la cantidad física manda. Si lo contado no alcanza para cubrir
 * lo reservado, se libera la diferencia de los pedidos (los más nuevos primero) y
 * esos pedidos quedan con faltante.
 */
export function adjustStock(ctx: Ctx, input: { inventoryId: number; newQuantity: number; countId: number }): number {
  const row = getInventoryRow(ctx.db, input.inventoryId)
  const p = getProductRow(ctx.db, row.product_id)
  const loc = getLocation(ctx.db, row.location_id)
  const before = productAvailable(ctx.db, p.id)
  const delta = input.newQuantity - row.quantity
  if (delta === 0) return 0

  let reserved = row.reserved
  if (input.newQuantity < reserved) {
    let excess = reserved - input.newQuantity
    const allocs = ctx.db.all<{ id: number; order_item_id: number; quantity: number; order_id: number }>(
      `SELECT a.id, a.order_item_id, a.quantity, oi.order_id FROM order_allocations a
         JOIN order_items oi ON oi.id = a.order_item_id
        WHERE a.inventory_id = :id AND a.consumed = 0 ORDER BY a.id DESC`,
      { id: row.id },
    )
    for (const a of allocs) {
      if (excess <= 0) break
      const take = Math.min(excess, a.quantity)
      if (take === a.quantity) ctx.db.run('DELETE FROM order_allocations WHERE id = :id', { id: a.id })
      else ctx.db.run('UPDATE order_allocations SET quantity = quantity - :take WHERE id = :id', { id: a.id, take })
      ctx.db.run('UPDATE order_items SET reserved = reserved - :take, picked = 0 WHERE id = :id', { id: a.order_item_id, take })
      recordMovement(ctx, { type: 'liberacion', productId: p.id, fromLocationId: loc.id, quantity: take, orderId: a.order_id, countId: input.countId, note: 'Ajuste por conteo' })
      const order = ctx.db.get<{ requester_id: number; assigned_to: number | null }>('SELECT requester_id, assigned_to FROM orders WHERE id = :id', { id: a.order_id })
      notifyRoles(ctx, ['encargado', 'admin'], {
        type: 'stock.bajo',
        title: `Faltante en ${orderNumber(a.order_id)}`,
        body: `El conteo de ${loc.code} dejó ${take} u. de ${p.name} sin reservar.`,
        orderId: a.order_id, productId: p.id,
      })
      notifyUsers(ctx, [order?.assigned_to], {
        type: 'stock.bajo', title: `Faltante en ${orderNumber(a.order_id)}`,
        body: `Faltan ${take} u. de ${p.name}.`, orderId: a.order_id, productId: p.id,
      })
      excess -= take
      reserved -= take
    }
  }

  setRow(ctx, row.id, input.newQuantity, reserved)
  recordMovement(ctx, {
    type: 'ajuste', productId: p.id, fromLocationId: delta < 0 ? loc.id : null, toLocationId: delta > 0 ? loc.id : null,
    quantity: delta, countId: input.countId, note: 'Ajuste por conteo',
  })
  logActivity(ctx, {
    type: 'stock.ajuste',
    message: `${firstName(ctx.actor.name)} ajustó ${p.name} en ${loc.code}: ${row.quantity} → ${input.newQuantity} (${delta > 0 ? '+' : '−'}${Math.abs(delta)})`,
    productId: p.id, locationId: loc.id, sector: loc.sector, quantity: delta,
  })
  checkStockAlerts(ctx, p.id, before)
  return delta
}

/* ------------------------------ Reservas para pedidos ------------------------------ */

interface ItemRow { id: number; order_id: number; product_id: number; quantity: number; reserved: number }

export function getItemRow(db: Db, id: number): ItemRow {
  const r = db.get<ItemRow>('SELECT id, order_id, product_id, quantity, reserved FROM order_items WHERE id = :id', { id })
  if (!r) throw notFound('El renglón del pedido')
  return r
}

/**
 * Reserva lo que falta de un renglón tomando stock disponible de las posiciones de rack
 * (las zonas de piso, como Recepción, quedan para el final).
 * Criterio "mejor ajuste": si una sola posición alcanza, se usa la más chica que alcance
 * (no se parten pallets completos); si no, se junta desde las que más tienen.
 * Devuelve cuánto pudo reservar.
 */
export function reserveItem(ctx: Ctx, itemId: number): number {
  const item = getItemRow(ctx.db, itemId)
  let need = item.quantity - item.reserved
  if (need <= 0) return 0
  const p = getProductRow(ctx.db, item.product_id)
  const before = productAvailable(ctx.db, p.id)
  const all = ctx.db.all<{ id: number; quantity: number; reserved: number; location_id: number; code: string; is_rack: number }>(
    `SELECT i.id, i.quantity, i.reserved, i.location_id, l.code, (l.kind = 'rack') AS is_rack FROM inventory i
       JOIN warehouse_locations l ON l.id = i.location_id
      WHERE i.product_id = :productId AND i.quantity - i.reserved > 0 AND l.active = 1
      ORDER BY (l.kind = 'rack') DESC, (i.quantity - i.reserved) DESC, i.id`,
    { productId: item.product_id },
  )
  const free = (s: (typeof all)[number]) => s.quantity - s.reserved
  const fit = all.filter((s) => s.is_rack && free(s) >= need).sort((a, b) => free(a) - free(b))[0]
  const sources = fit ? [fit, ...all.filter((s) => s !== fit)] : all
  let total = 0
  const places: string[] = []
  for (const s of sources) {
    if (need <= 0) break
    const take = Math.min(need, s.quantity - s.reserved)
    setRow(ctx, s.id, s.quantity, s.reserved + take)
    const existing = ctx.db.get<{ id: number }>(
      'SELECT id FROM order_allocations WHERE order_item_id = :itemId AND inventory_id = :invId AND consumed = 0', { itemId, invId: s.id },
    )
    if (existing) ctx.db.run('UPDATE order_allocations SET quantity = quantity + :take WHERE id = :id', { id: existing.id, take })
    else ctx.db.run('INSERT INTO order_allocations (order_item_id, inventory_id, quantity) VALUES (:itemId, :invId, :take)', { itemId, invId: s.id, take })
    recordMovement(ctx, { type: 'reserva', productId: p.id, fromLocationId: s.location_id, quantity: take, orderId: item.order_id })
    places.push(s.code)
    need -= take
    total += take
  }
  if (total > 0) {
    ctx.db.run('UPDATE order_items SET reserved = reserved + :total WHERE id = :id', { id: itemId, total })
    logActivity(ctx, {
      type: 'stock.reserva',
      message: `${firstName(ctx.actor.name)} reservó ${qty(total, p.unit)} de ${p.name} para el pedido ${orderNumber(item.order_id)} (${places.join(', ')})`,
      productId: p.id, orderId: item.order_id, quantity: total,
    })
    checkStockAlerts(ctx, p.id, before)
  }
  return total
}

/** Devuelve al stock disponible todo lo reservado (y no entregado) de un renglón. */
export function releaseItem(ctx: Ctx, itemId: number, note = ''): number {
  const item = getItemRow(ctx.db, itemId)
  const p = getProductRow(ctx.db, item.product_id)
  const allocs = ctx.db.all<{ id: number; inventory_id: number; quantity: number }>(
    'SELECT id, inventory_id, quantity FROM order_allocations WHERE order_item_id = :itemId AND consumed = 0', { itemId },
  )
  let total = 0
  for (const a of allocs) {
    const row = getInventoryRow(ctx.db, a.inventory_id)
    setRow(ctx, row.id, row.quantity, row.reserved - a.quantity)
    ctx.db.run('DELETE FROM order_allocations WHERE id = :id', { id: a.id })
    recordMovement(ctx, { type: 'liberacion', productId: p.id, fromLocationId: row.location_id, quantity: a.quantity, orderId: item.order_id, note })
    total += a.quantity
  }
  if (total > 0) {
    ctx.db.run('UPDATE order_items SET reserved = reserved - :total, picked = 0 WHERE id = :id', { id: itemId, total })
    logActivity(ctx, {
      type: 'stock.liberacion',
      message: `Se liberaron ${qty(total, p.unit)} de ${p.name} del pedido ${orderNumber(item.order_id)}`,
      productId: p.id, orderId: item.order_id, quantity: total,
    })
  }
  return total
}

/** Entrega: lo reservado sale del almacén (egreso) desde cada ubicación. */
export function consumeItem(ctx: Ctx, itemId: number): number {
  const item = getItemRow(ctx.db, itemId)
  const p = getProductRow(ctx.db, item.product_id)
  const allocs = ctx.db.all<{ id: number; inventory_id: number; quantity: number }>(
    'SELECT id, inventory_id, quantity FROM order_allocations WHERE order_item_id = :itemId AND consumed = 0', { itemId },
  )
  let total = 0
  for (const a of allocs) {
    const row = getInventoryRow(ctx.db, a.inventory_id)
    setRow(ctx, row.id, row.quantity - a.quantity, row.reserved - a.quantity)
    ctx.db.run('UPDATE order_allocations SET consumed = 1 WHERE id = :id', { id: a.id })
    recordMovement(ctx, { type: 'egreso', productId: p.id, fromLocationId: row.location_id, quantity: a.quantity, orderId: item.order_id })
    total += a.quantity
  }
  if (total > 0) {
    logActivity(ctx, {
      type: 'stock.egreso',
      message: `${firstName(ctx.actor.name)} despachó ${qty(total, p.unit)} de ${p.name} (pedido ${orderNumber(item.order_id)})`,
      productId: p.id, orderId: item.order_id, quantity: total,
    })
  }
  return total
}

/** Control de consistencia (lo usan las pruebas): reservas y stock tienen que cerrar. */
export function checkInvariants(db: Db): string[] {
  const problems: string[] = []
  const rows = db.all<{ id: number; reserved: number; alloc: number }>(
    `SELECT i.id, i.reserved, COALESCE((SELECT SUM(a.quantity) FROM order_allocations a WHERE a.inventory_id = i.id AND a.consumed = 0), 0) AS alloc
       FROM inventory i`,
  )
  for (const r of rows) if (r.reserved !== r.alloc) problems.push(`inventory ${r.id}: reserved ${r.reserved} ≠ reservas ${r.alloc}`)
  const items = db.all<{ id: number; reserved: number; alloc: number }>(
    `SELECT oi.id, oi.reserved, COALESCE((SELECT SUM(a.quantity) FROM order_allocations a WHERE a.order_item_id = oi.id), 0) AS alloc
       FROM order_items oi`,
  )
  for (const r of items) if (r.reserved !== r.alloc) problems.push(`order_item ${r.id}: reserved ${r.reserved} ≠ reservas ${r.alloc}`)
  return problems
}

/* ------------------------------ Operaciones manuales (con permiso) ------------------------------ */

/** Ingreso manual de mercadería ("Juan agregó 20 unidades"). */
export function manualReceive(ctx: Ctx, input: { productId: number; locationId: number; quantity: number; note?: string }): void {
  requirePermission(ctx, 'inventario.mover')
  addStock(ctx, input)
}

/** Traslado entre ubicaciones (por ejemplo, de Recepción a una posición de rack: ALMACENAR). */
export function manualMove(ctx: Ctx, input: { inventoryId: number; toLocationId: number; quantity: number; note?: string }): void {
  requirePermission(ctx, 'inventario.mover')
  moveStock(ctx, input)
}
