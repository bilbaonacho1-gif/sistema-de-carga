/**
 * Notificaciones. Hoy se entregan dentro de la app (canal "inApp", guardado en la base).
 * Para sumar notificaciones push alcanza con agregar otro canal a CHANNELS:
 * recibe la misma notificación ya armada y la manda al dispositivo.
 */
import type { Notification, NotificationType, Role } from '../../shared/types'
import type { Ctx } from './context'

export interface NotificationInput {
  type: NotificationType
  title: string
  body: string
  orderId?: number | null
  productId?: number | null
  /** Ruta de la app a la que lleva, si no es un pedido ni un producto. */
  link?: string | null
}

export interface NotificationChannel {
  name: string
  deliver(ctx: Ctx, userIds: number[], n: NotificationInput): void
}

const inApp: NotificationChannel = {
  name: 'inApp',
  deliver(ctx, userIds, n) {
    for (const userId of userIds) {
      ctx.db.run(
        `INSERT INTO notifications (user_id, type, title, body, order_id, product_id, link, created_at)
         VALUES (:userId, :type, :title, :body, :orderId, :productId, :link, :now)`,
        { ...n, userId, now: ctx.clock.now() },
      )
    }
  },
}

/** Canales activos. Un canal push (Web Push / FCM) se agrega acá. */
export const CHANNELS: NotificationChannel[] = [inApp]

export function notifyUsers(ctx: Ctx, userIds: (number | null | undefined)[], n: NotificationInput): void {
  // nunca se notifica a quien hizo la acción
  const ids = [...new Set(userIds.filter((id): id is number => !!id && id !== ctx.actor.id))]
  if (!ids.length) return
  for (const channel of CHANNELS) channel.deliver(ctx, ids, n)
}

export function usersWithRoles(ctx: Ctx, roles: Role[]): number[] {
  const placeholders = roles.map((_, i) => `:r${i}`).join(', ')
  const params = Object.fromEntries(roles.map((r, i) => [`r${i}`, r]))
  return ctx.db.all<{ id: number }>(`SELECT id FROM users WHERE active = 1 AND role IN (${placeholders})`, params).map((r) => r.id)
}

export function notifyRoles(ctx: Ctx, roles: Role[], n: NotificationInput): void {
  notifyUsers(ctx, usersWithRoles(ctx, roles), n)
}

interface NotificationRow {
  id: number; type: NotificationType; title: string; body: string
  order_id: number | null; product_id: number | null; link: string | null; read_at: string | null; created_at: string
}

export function listNotifications(ctx: Ctx, limit = 50): { items: Notification[]; unread: number } {
  const rows = ctx.db.all<NotificationRow>(
    'SELECT * FROM notifications WHERE user_id = :id ORDER BY id DESC LIMIT :limit',
    { id: ctx.actor.id, limit },
  )
  const unread = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = :id AND read_at IS NULL', { id: ctx.actor.id })?.n ?? 0
  return {
    unread,
    items: rows.map((r) => ({
      id: r.id, type: r.type, title: r.title, body: r.body, orderId: r.order_id,
      productId: r.product_id, link: r.link, readAt: r.read_at, createdAt: r.created_at,
    })),
  }
}

export function markNotificationsRead(ctx: Ctx, ids: number[] | 'all'): void {
  ctx.db.transaction(() => {
    if (ids === 'all') {
      ctx.db.run('UPDATE notifications SET read_at = :now WHERE user_id = :id AND read_at IS NULL', { id: ctx.actor.id, now: ctx.clock.now() })
    } else {
      for (const nid of ids)
        ctx.db.run('UPDATE notifications SET read_at = :now WHERE id = :nid AND user_id = :id AND read_at IS NULL', { nid, id: ctx.actor.id, now: ctx.clock.now() })
    }
  })
}
