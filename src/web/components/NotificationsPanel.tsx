/** Lista de notificaciones: tocar una lleva al pedido o producto y la marca como leída. */
import {
  BellOff, Calculator, CircleCheck, ClipboardList, MessageSquare, PackageCheck, ScanLine, TriangleAlert, Truck, XCircle, type LucideIcon,
} from 'lucide-react'
import { useNavigate } from 'react-router'
import type { Notification, NotificationType } from '../../shared/types'
import { useNotifications, useReadNotifications } from '../api/queries'
import { fmtRelative } from '../lib/format'
import { Button, EmptyState, Spinner } from './ui'

const ICON: Record<NotificationType, [LucideIcon, string]> = {
  'pedido.nuevo': [ClipboardList, 'phase-1'],
  'pedido.revision': [ClipboardList, 'phase-1'],
  'pedido.aprobado': [CircleCheck, 'tone-blue'],
  'pedido.para_preparar': [PackageCheck, 'tone-amber'],
  'pedido.preparado': [PackageCheck, 'tone-green'],
  'pedido.entregado': [Truck, 'tone-green'],
  'pedido.recibido': [Truck, 'tone-green'],
  'pedido.finalizado': [CircleCheck, 'tone-ink'],
  'pedido.cancelado': [XCircle, 'tone-red'],
  'pedido.comentario': [MessageSquare, 'tone-blue'],
  'stock.bajo': [TriangleAlert, 'tone-amber'],
  'stock.sin_stock': [TriangleAlert, 'tone-red'],
  'conteo.diferencias': [ScanLine, 'phase-3'],
  'presupuesto.nuevo': [Calculator, 'tone-blue'],
  'presupuesto.respondido': [Calculator, 'tone-green'],
}

export function NotificationsPanel({ onNavigate }: { onNavigate(): void }) {
  const q = useNotifications()
  const read = useReadNotifications()
  const navigate = useNavigate()

  if (q.isLoading) return <Spinner />
  const items = q.data?.items ?? []
  if (!items.length) return <EmptyState icon={BellOff} title="No tenés notificaciones">Te avisamos acá cuando cambie un pedido o falte stock.</EmptyState>

  const open = (n: Notification) => {
    if (!n.readAt) read.mutate({ ids: [n.id] })
    if (n.link) navigate(n.link)
    else if (n.orderId) navigate(`/pedidos/${n.orderId}`)
    else if (n.productId) navigate(`/inventario/${n.productId}`)
    onNavigate()
  }

  return (
    <div className="notif-list">
      {!!q.data?.unread && (
        <div className="notif-list__actions">
          <Button size="sm" variant="ghost" onClick={() => read.mutate({ all: true })} loading={read.isPending}>Marcar todo como leído</Button>
        </div>
      )}
      <ul>
        {items.map((n) => {
          const [Icon, tone] = ICON[n.type] ?? [ClipboardList, 'tone-ink']
          return (
            <li key={n.id}>
              <button type="button" className={`notif${n.readAt ? '' : ' notif--unread'}`} onClick={() => open(n)}>
                <span className={`notif__icon ${tone}`}><Icon size={18} aria-hidden /></span>
                <span className="notif__text">
                  <strong>{n.title}</strong>
                  {n.body && <span>{n.body}</span>}
                  <time dateTime={n.createdAt}>{fmtRelative(n.createdAt)}</time>
                </span>
                {!n.readAt && <span className="notif__dot" aria-label="Sin leer" />}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
