/** Piezas compartidas por las pantallas de pedidos. */
import { PRIORITY_META } from '../../../shared/orders'
import type { OrderStatus, OrderSummary, Priority } from '../../../shared/types'
import { Badge } from '../../components/ui'
import { fmtDate } from '../../lib/format'

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === 'normal') return null
  const tone = priority === 'urgente' ? 'red' : priority === 'alta' ? 'amber' : 'neutral'
  return <Badge tone={tone}>{PRIORITY_META[priority].label}</Badge>
}

export function TypeBadge({ type }: { type: OrderSummary['type'] }) {
  return type === 'reposicion' ? <Badge tone="blue">Reposición</Badge> : null
}

/** "05/10" en rojo si ya pasó y el pedido sigue abierto. */
export function NeededBy({ order }: { order: Pick<OrderSummary, 'neededBy' | 'status'> }) {
  if (!order.neededBy) return <span className="muted">—</span>
  const late = new Date(`${order.neededBy}T23:59:59`) < new Date() && !['entregado', 'recibido', 'finalizado', 'cancelado'].includes(order.status)
  return <span className={late ? 'late' : undefined} title={late ? 'Vencido' : undefined}>{fmtDate(order.neededBy)}</span>
}

/** Grupos de estados para filtrar la lista. */
export const ORDER_GROUPS: { id: string; label: string; statuses: OrderStatus[] | null }[] = [
  { id: 'activos', label: 'Activos', statuses: ['solicitado', 'en_revision', 'aprobado', 'en_preparacion', 'preparado', 'entregado', 'recibido'] },
  { id: 'revision', label: 'Por revisar', statuses: ['solicitado', 'en_revision'] },
  { id: 'preparacion', label: 'Aprobados y en preparación', statuses: ['aprobado', 'en_preparacion'] },
  { id: 'listos', label: 'Preparados', statuses: ['preparado'] },
  { id: 'entregados', label: 'Entregados / recibidos', statuses: ['entregado', 'recibido'] },
  { id: 'finalizados', label: 'Finalizados', statuses: ['finalizado'] },
  { id: 'cancelados', label: 'Cancelados', statuses: ['cancelado'] },
  { id: 'todos', label: 'Todos', statuses: null },
]
