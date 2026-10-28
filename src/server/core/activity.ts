/** Historial: registra todo lo que pasa y lo devuelve filtrado según el perfil. */
import { orderNumber } from '../../shared/orders'
import type { Activity, ActivityFilter, ActivityType } from '../../shared/types'
import { hasPermission, type Ctx } from './context'
import { orderVisibility } from './visibility'

export interface ActivityInput {
  type: ActivityType
  message: string
  orderId?: number | null
  productId?: number | null
  locationId?: number | null
  sector?: string | null
  quantity?: number | null
}

export function logActivity(ctx: Ctx, a: ActivityInput): void {
  ctx.db.run(
    `INSERT INTO activity (type, message, user_id, order_id, product_id, location_id, sector, quantity, created_at)
     VALUES (:type, :message, :userId, :orderId, :productId, :locationId, :sector, :quantity, :now)`,
    { ...a, userId: ctx.actor.id, now: ctx.clock.now() },
  )
}

interface ActivityRow {
  id: number; type: ActivityType; message: string; user_id: number | null; user_name: string | null
  order_id: number | null; product_id: number | null; product_name: string | null
  location_code: string | null; sector: string | null; quantity: number | null; created_at: string
}

export function listActivity(ctx: Ctx, f: ActivityFilter = {}): Activity[] {
  const where: string[] = []
  const p: Record<string, unknown> = { limit: Math.min(f.limit ?? 100, 500) }
  if (!hasPermission(ctx, 'historial.ver_todo')) {
    // sin el historial completo: sólo lo que pasó con los pedidos que puede ver
    const v = orderVisibility(ctx)
    where.push(`a.order_id IN (SELECT o.id FROM orders o WHERE ${v.sql})`)
    Object.assign(p, v.params)
  }
  if (f.from) { where.push('a.created_at >= :from'); p.from = f.from }
  if (f.to) { where.push('a.created_at <= :to'); p.to = f.to }
  if (f.userId) { where.push('a.user_id = :userId'); p.userId = f.userId }
  if (f.productId) { where.push('a.product_id = :productId'); p.productId = f.productId }
  if (f.orderId) { where.push('a.order_id = :orderId'); p.orderId = f.orderId }
  if (f.sector) { where.push('a.sector = :sector'); p.sector = f.sector }
  if (f.type) { where.push("a.type LIKE :type || '%'"); p.type = f.type }
  if (f.before) { where.push('a.id < :before'); p.before = f.before }

  const rows = ctx.db.all<ActivityRow>(
    `SELECT a.id, a.type, a.message, a.user_id, u.name AS user_name, a.order_id, a.product_id,
            pr.name AS product_name, l.code AS location_code, a.sector, a.quantity, a.created_at
       FROM activity a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN products pr ON pr.id = a.product_id
       LEFT JOIN warehouse_locations l ON l.id = a.location_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.id DESC
      LIMIT :limit`,
    p,
  )
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    message: r.message,
    userId: r.user_id,
    userName: r.user_name,
    orderId: r.order_id,
    orderNumber: r.order_id ? orderNumber(r.order_id) : null,
    productId: r.product_id,
    productName: r.product_name,
    locationCode: r.location_code,
    sector: r.sector,
    quantity: r.quantity,
    createdAt: r.created_at,
  }))
}
