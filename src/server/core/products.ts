/** Productos con su stock calculado, faltantes y pedidos de reposición. */
import { orderNumber } from '../../shared/orders'
import { stockStatus, suggestedReplenishment } from '../../shared/stock'
import type {
  InventoryRow, LocationKind, Movement, MovementType, OrderDetail, OrderStatus, Product, ProductDetail, ProductStock, StockStatus,
} from '../../shared/types'
import { logActivity } from './activity'
import { bool, conflict, firstName, invalid, notFound, requirePermission, type Ctx } from './context'
import { listOrders, createOrder } from './orders'

interface ProductRow {
  id: number; code: string; name: string; category: string; unit: string; min_stock: number
  description: string; active: number; created_at: string; total: number; reserved: number; locations: number
}

const toProduct = (r: ProductRow): Product => ({
  id: r.id, code: r.code, name: r.name, category: r.category, unit: r.unit, minStock: r.min_stock,
  description: r.description, active: bool(r.active), createdAt: r.created_at,
})

export interface ProductFilter {
  search?: string
  category?: string
  status?: StockStatus | 'faltantes'
  includeInactive?: boolean
}

export function listProducts(ctx: Ctx, f: ProductFilter = {}): ProductStock[] {
  requirePermission(ctx, 'inventario.ver')
  return queryProducts(ctx, f)
}

/** Catálogo para armar pedidos: lo puede ver cualquier perfil que pida materiales. */
export function catalog(ctx: Ctx): (Product & { available: number })[] {
  return queryProducts(ctx, {}).map((p) => ({
    id: p.id, code: p.code, name: p.name, category: p.category, unit: p.unit, minStock: p.minStock,
    description: p.description, active: p.active, createdAt: p.createdAt, available: p.available,
  }))
}

function queryProducts(ctx: Ctx, f: ProductFilter): ProductStock[] {
  const where = f.includeInactive ? ['1 = 1'] : ['p.active = 1']
  const params: Record<string, unknown> = {}
  if (f.search) { where.push('(p.name LIKE :q OR p.code LIKE :q OR p.category LIKE :q)'); params.q = `%${f.search}%` }
  if (f.category) { where.push('p.category = :category'); params.category = f.category }
  const rows = ctx.db.all<ProductRow>(
    `SELECT p.*, COALESCE(SUM(i.quantity), 0) AS total, COALESCE(SUM(i.reserved), 0) AS reserved,
            COALESCE(SUM(CASE WHEN i.quantity > 0 THEN 1 ELSE 0 END), 0) AS locations
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id
      WHERE ${where.join(' AND ')}
      GROUP BY p.id ORDER BY p.category, p.name`,
    params,
  )
  // ubicación principal (la de más stock) y reposiciones abiertas
  const main = new Map<number, string>()
  for (const r of ctx.db.all<{ product_id: number; code: string }>(
    `SELECT i.product_id, l.code FROM inventory i JOIN warehouse_locations l ON l.id = i.location_id
      WHERE i.quantity > 0 ORDER BY i.product_id, i.quantity DESC, l.code`,
  )) if (!main.has(r.product_id)) main.set(r.product_id, r.code)
  const repl = new Map<number, { id: number; number: string; quantity: number }>()
  for (const r of ctx.db.all<{ product_id: number; id: number; quantity: number }>(
    `SELECT oi.product_id, o.id, oi.quantity - oi.received AS quantity FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.type = 'reposicion' AND o.status IN ('solicitado', 'en_revision', 'aprobado') ORDER BY o.id`,
  )) if (!repl.has(r.product_id)) repl.set(r.product_id, { id: r.id, number: orderNumber(r.id), quantity: r.quantity })

  const list = rows.map<ProductStock>((r) => {
    const available = r.total - r.reserved
    return {
      ...toProduct(r),
      total: r.total,
      reserved: r.reserved,
      available,
      status: stockStatus(r.total, r.reserved, r.min_stock),
      locations: r.locations,
      mainLocation: main.get(r.id) ?? null,
      replenishmentOrder: repl.get(r.id) ?? null,
    }
  })
  if (f.status === 'faltantes') return list.filter((p) => p.available < p.minStock)
  if (f.status) return list.filter((p) => p.status === f.status)
  return list
}

export function getProduct(ctx: Ctx, id: number): ProductDetail {
  requirePermission(ctx, 'inventario.ver')
  const base = queryProducts(ctx, { includeInactive: true }).find((p) => p.id === id)
  if (!base) throw notFound('El producto')
  return {
    ...base,
    inventory: inventoryRows(ctx, { productId: id }),
    movements: listMovements(ctx, { productId: id, limit: 60 }),
    openOrders: listOrders(ctx, { search: base.code, limit: 50 }).filter((o) => !['finalizado', 'cancelado'].includes(o.status)),
  }
}

/** Filas de stock con los pedidos que tienen reservado cada una. */
export function inventoryRows(ctx: Ctx, f: { productId?: number; locationIds?: number[]; withEmpty?: boolean }): InventoryRow[] {
  const where = [f.withEmpty ? '1 = 1' : 'i.quantity > 0']
  const params: Record<string, unknown> = {}
  if (f.productId) { where.push('i.product_id = :productId'); params.productId = f.productId }
  if (f.locationIds) {
    if (!f.locationIds.length) return []
    where.push(`i.location_id IN (${f.locationIds.map((_, k) => `:l${k}`).join(', ')})`)
    f.locationIds.forEach((l, k) => (params[`l${k}`] = l))
  }
  const rows = ctx.db.all<{
    id: number; product_id: number; code: string; name: string; unit: string; location_id: number
    location_code: string; kind: LocationKind; sector: string; quantity: number; reserved: number
  }>(
    `SELECT i.id, i.product_id, p.code, p.name, p.unit, i.location_id, l.code AS location_code, l.kind, l.sector, i.quantity, i.reserved
       FROM inventory i JOIN products p ON p.id = i.product_id JOIN warehouse_locations l ON l.id = i.location_id
      WHERE ${where.join(' AND ')} ORDER BY l.code, p.name`,
    params,
  )
  const ids = rows.map((r) => r.id)
  const orders = ids.length
    ? ctx.db.all<{ inventory_id: number; order_id: number; quantity: number; status: OrderStatus }>(
      `SELECT a.inventory_id, o.id AS order_id, SUM(a.quantity) AS quantity, o.status
         FROM order_allocations a JOIN order_items oi ON oi.id = a.order_item_id JOIN orders o ON o.id = oi.order_id
        WHERE a.consumed = 0 AND a.inventory_id IN (${ids.map((_, k) => `:i${k}`).join(', ')})
        GROUP BY a.inventory_id, o.id`,
      Object.fromEntries(ids.map((id, k) => [`i${k}`, id])),
    )
    : []
  return rows.map((r) => ({
    id: r.id, productId: r.product_id, productCode: r.code, productName: r.name, unit: r.unit,
    locationId: r.location_id, locationCode: r.location_code, locationKind: r.kind, sector: r.sector,
    quantity: r.quantity, reserved: r.reserved, available: r.quantity - r.reserved,
    orders: orders.filter((o) => o.inventory_id === r.id)
      .map((o) => ({ orderId: o.order_id, number: orderNumber(o.order_id), quantity: o.quantity, status: o.status })),
  }))
}

export function listMovements(ctx: Ctx, f: { productId?: number; orderId?: number; limit?: number }): Movement[] {
  const where: string[] = []
  const params: Record<string, unknown> = { limit: f.limit ?? 100 }
  if (f.productId) { where.push('m.product_id = :productId'); params.productId = f.productId }
  if (f.orderId) { where.push('m.order_id = :orderId'); params.orderId = f.orderId }
  return ctx.db.all<{
    id: number; type: MovementType; product_id: number; code: string; name: string; from_code: string | null; to_code: string | null
    quantity: number; order_id: number | null; count_id: number | null; user_id: number; user_name: string; note: string; created_at: string
  }>(
    `SELECT m.id, m.type, m.product_id, p.code, p.name, lf.code AS from_code, lt.code AS to_code, m.quantity,
            m.order_id, m.count_id, m.user_id, u.name AS user_name, m.note, m.created_at
       FROM inventory_movements m JOIN products p ON p.id = m.product_id JOIN users u ON u.id = m.user_id
       LEFT JOIN warehouse_locations lf ON lf.id = m.from_location_id
       LEFT JOIN warehouse_locations lt ON lt.id = m.to_location_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.id DESC LIMIT :limit`,
    params,
  ).map((m) => ({
    id: m.id, type: m.type, productId: m.product_id, productCode: m.code, productName: m.name,
    fromLocation: m.from_code, toLocation: m.to_code, quantity: m.quantity, orderId: m.order_id,
    orderNumber: m.order_id ? orderNumber(m.order_id) : null, countId: m.count_id,
    userId: m.user_id, userName: m.user_name, note: m.note, createdAt: m.created_at,
  }))
}

export function listCategories(ctx: Ctx): string[] {
  return ctx.db.all<{ category: string }>('SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category').map((r) => r.category)
}

/* ------------------------------ Alta y edición ------------------------------ */

export interface ProductInput {
  code: string
  name: string
  category: string
  unit: string
  minStock: number
  description?: string
  active?: boolean
}

function validate(input: ProductInput) {
  if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/i.test(input.code.trim())) throw invalid('El código admite letras, números y guiones (2 a 24 caracteres).')
  if (!input.name.trim()) throw invalid('Ingresá el nombre del producto.')
  if (!input.category.trim()) throw invalid('Ingresá la categoría.')
  if (!Number.isInteger(input.minStock) || input.minStock < 0) throw invalid('El stock mínimo tiene que ser un entero mayor o igual a cero.')
}

export function createProduct(ctx: Ctx, input: ProductInput): ProductStock {
  requirePermission(ctx, 'productos.editar')
  validate(input)
  if (ctx.db.get('SELECT id FROM products WHERE code = :code', { code: input.code.trim() })) throw conflict(`Ya existe un producto con el código ${input.code.trim().toUpperCase()}.`)
  return ctx.db.transaction(() => {
    const { lastInsertRowid: id } = ctx.db.run(
      `INSERT INTO products (code, name, category, unit, min_stock, description, active, created_at)
       VALUES (:code, :name, :category, :unit, :minStock, :description, 1, :now)`,
      { ...input, code: input.code.trim().toUpperCase(), name: input.name.trim(), category: input.category.trim(), unit: input.unit.trim() || 'u', description: input.description?.trim() ?? '', now: ctx.clock.now() },
    )
    logActivity(ctx, { type: 'producto.creado', message: `${firstName(ctx.actor.name)} dio de alta ${input.name.trim()} (${input.code.trim().toUpperCase()})`, productId: id })
    return queryProducts(ctx, { includeInactive: true }).find((p) => p.id === id)!
  })
}

export function updateProduct(ctx: Ctx, id: number, input: ProductInput): ProductStock {
  requirePermission(ctx, 'productos.editar')
  validate(input)
  if (!ctx.db.get('SELECT id FROM products WHERE id = :id', { id })) throw notFound('El producto')
  if (ctx.db.get('SELECT id FROM products WHERE code = :code AND id <> :id', { code: input.code.trim(), id })) throw conflict('Ese código ya lo usa otro producto.')
  return ctx.db.transaction(() => {
    ctx.db.run(
      `UPDATE products SET code = :code, name = :name, category = :category, unit = :unit, min_stock = :minStock,
              description = :description, active = :active WHERE id = :id`,
      { ...input, id, code: input.code.trim().toUpperCase(), name: input.name.trim(), category: input.category.trim(), unit: input.unit.trim() || 'u', description: input.description?.trim() ?? '', active: input.active ?? true },
    )
    logActivity(ctx, { type: 'producto.editado', message: `${firstName(ctx.actor.name)} modificó ${input.name.trim()} (${input.code.trim().toUpperCase()})`, productId: id })
    return queryProducts(ctx, { includeInactive: true }).find((p) => p.id === id)!
  })
}

/* ------------------------------ Faltantes ------------------------------ */

/** "Solicitar material" desde Faltantes: genera un pedido de reposición real. */
export function requestReplenishment(ctx: Ctx, productId: number, quantity?: number): OrderDetail {
  requirePermission(ctx, 'inventario.reponer')
  const p = queryProducts(ctx, {}).find((x) => x.id === productId)
  if (!p) throw notFound('El producto')
  if (p.replenishmentOrder) throw conflict(`Ya hay una reposición abierta para ${p.name}: ${p.replenishmentOrder.number}.`)
  const q = quantity ?? suggestedReplenishment(p.available, p.minStock)
  return createOrder(ctx, {
    type: 'reposicion',
    sector: 'Almacén',
    priority: p.available <= 0 ? 'urgente' : 'alta',
    neededBy: null,
    notes: `Reposición automática desde Faltantes: disponible ${p.available}, mínimo ${p.minStock}.`,
    items: [{ productId, quantity: q }],
  })
}
