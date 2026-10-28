/** Resumen inicial: indicadores, pedidos por estado, actividad reciente y tareas del perfil. */
import { STATUS_META } from '../../shared/orders'
import type { DashboardData, OrderStatus, Task } from '../../shared/types'
import { listActivity } from './activity'
import { hasPermission, type Ctx } from './context'
import { listOrders } from './orders'
import { listProducts } from './products'

export function getDashboard(ctx: Ctx): DashboardData {
  const orders = listOrders(ctx, { limit: 1000 })
  const flow = Object.fromEntries(Object.keys(STATUS_META).map((s) => [s, 0])) as Record<OrderStatus, number>
  for (const o of orders) flow[o.status]++

  const products = hasPermission(ctx, 'inventario.ver') ? listProducts(ctx) : []
  const positions = ctx.db.get<{ total: number; occupied: number }>(
    `SELECT COUNT(*) AS total,
            COUNT(CASE WHEN EXISTS (SELECT 1 FROM inventory i WHERE i.location_id = rp.location_id AND i.quantity > 0) THEN 1 END) AS occupied
       FROM rack_positions rp`,
  ) ?? { total: 0, occupied: 0 }

  const tasks: Task[] = []
  const me = ctx.actor
  for (const o of orders) {
    const who = [o.companyName, o.sector].filter(Boolean).join(' · ')
    if (o.status === 'solicitado' && hasPermission(ctx, 'pedidos.revisar'))
      tasks.push({ kind: 'revisar', title: `Revisar ${o.number}`, detail: `${who} · ${o.itemCount} productos`, orderId: o.id })
    if (o.status === 'en_revision' && hasPermission(ctx, 'pedidos.revisar'))
      tasks.push({ kind: 'aprobar', title: `Aprobar ${o.number}`, detail: who, orderId: o.id })
    if (o.type === 'salida' && ['aprobado', 'en_preparacion'].includes(o.status) && hasPermission(ctx, 'pedidos.preparar')
      && (me.role !== 'operario' || o.assignedToId === me.id || o.assignedToId === null))
      tasks.push({ kind: 'preparar', title: `${o.status === 'aprobado' ? 'Preparar' : 'Terminar de preparar'} ${o.number}`, detail: `${o.pickedCount}/${o.itemCount} productos listos`, orderId: o.id })
    if (o.status === 'preparado' && hasPermission(ctx, 'pedidos.entregar'))
      tasks.push({ kind: 'entregar', title: `Entregar ${o.number}`, detail: who, orderId: o.id })
    if (o.type === 'reposicion' && o.status === 'aprobado' && hasPermission(ctx, 'pedidos.entregar'))
      tasks.push({ kind: 'recibir', title: `Recibir reposición ${o.number}`, detail: `${o.totalUnits} u.`, orderId: o.id })
    if (['entregado', 'recibido'].includes(o.status) && hasPermission(ctx, 'pedidos.finalizar') && (me.role !== 'cliente' || o.companyId === me.companyId))
      tasks.push({ kind: 'finalizar', title: `Finalizar ${o.number}`, detail: me.role === 'cliente' ? 'Confirmá que lo recibiste' : who, orderId: o.id })
  }
  if (hasPermission(ctx, 'inventario.reponer'))
    for (const p of products.filter((x) => x.available < x.minStock && !x.replenishmentOrder).slice(0, 6))
      tasks.push({ kind: 'reponer', title: `Reponer ${p.name}`, detail: `Disponible ${p.available} · mínimo ${p.minStock}`, productId: p.id })
  if (hasPermission(ctx, 'conteo.gestionar'))
    for (const c of ctx.db.all<{ id: number; sector: string }>("SELECT id, sector FROM inventory_counts WHERE status = 'en_curso'"))
      tasks.push({ kind: 'conteo', title: `Terminar conteo #${c.id}`, detail: c.sector, countId: c.id })

  return {
    kpis: {
      products: products.length,
      lowStock: products.filter((p) => p.status === 'stock_bajo').length,
      outOfStock: products.filter((p) => p.status === 'sin_stock').length,
      activeOrders: orders.filter((o) => !['finalizado', 'cancelado'].includes(o.status)).length,
      inPreparation: flow.en_preparacion,
      prepared: flow.preparado,
      finalized: flow.finalizado,
      positions: positions.total,
      occupiedPositions: positions.occupied,
    },
    flow,
    recent: listActivity(ctx, { limit: 12 }),
    tasks: tasks.slice(0, 12),
  }
}
