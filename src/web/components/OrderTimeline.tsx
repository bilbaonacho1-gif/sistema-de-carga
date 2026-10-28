/** Línea de tiempo del pedido: los pasos de su tipo, con fecha y persona de cada cambio. */
import { Check, X } from 'lucide-react'
import { FLOW, STATUS_META } from '../../shared/orders'
import type { OrderDetail } from '../../shared/types'
import { fmtDateTime } from '../lib/format'

export function OrderTimeline({ order }: { order: OrderDetail }) {
  const steps = FLOW[order.type]
  const reached = new Map(order.history.map((h) => [h.to, h]))
  const cancelled = order.status === 'cancelado'
  const currentIdx = cancelled
    ? Math.max(...order.history.filter((h) => h.to !== 'cancelado').map((h) => steps.indexOf(h.to)))
    : steps.indexOf(order.status)
  const cancel = reached.get('cancelado')

  return (
    <ol className={`timeline${cancelled ? ' timeline--cancelled' : ''}`}>
      {steps.map((s, i) => {
        const h = reached.get(s)
        const state = i < currentIdx || (i === currentIdx && (s === 'finalizado' || cancelled)) ? 'done' : i === currentIdx ? 'current' : 'pending'
        return (
          <li key={s} className={`timeline__step is-${state}`} style={{ ['--c' as string]: STATUS_META[s].color }}>
            <span className="timeline__dot" aria-hidden>{state === 'done' ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
            <span className="timeline__label">{STATUS_META[s].label}</span>
            {h && <span className="timeline__meta">{fmtDateTime(h.createdAt)} · {h.userName.split(' ')[0]}</span>}
          </li>
        )
      })}
      {cancel && (
        <li className="timeline__step is-cancel">
          <span className="timeline__dot" aria-hidden><X size={13} strokeWidth={3} /></span>
          <span className="timeline__label">Cancelado</span>
          <span className="timeline__meta">{fmtDateTime(cancel.createdAt)} · {cancel.userName.split(' ')[0]}</span>
        </li>
      )}
    </ol>
  )
}
