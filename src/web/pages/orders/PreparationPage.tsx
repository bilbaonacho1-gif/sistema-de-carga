/**
 * Preparación de pedidos (operarios): cola de trabajo y checklist.
 * Pensada para usarse con el celular en la mano, recorriendo el almacén.
 */
import { ArrowRight, CircleAlert, ClipboardList, MapPin, PackageCheck, PartyPopper } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { OrderDetail, OrderSummary } from '../../../shared/types'
import { useOrder, useOrders, usePick, useTransition } from '../../api/queries'
import { useMe } from '../../auth/AuthContext'
import { useToast } from '../../components/overlays'
import { Badge, Button, Card, EmptyState, ErrorNote, Loadable, PageHeader, Progress, Spinner, StatusPill } from '../../components/ui'
import { fmt } from '../../lib/format'
import { NeededBy, PriorityBadge } from './orderUi'

export function PreparationPage() {
  const me = useMe()
  const q = useOrders({ status: ['aprobado', 'en_preparacion'], type: 'salida' })
  const list = (q.data ?? []).filter((o) => me.role !== 'operario' || o.assignedToId === me.id || o.assignedToId === null)
  const inProgress = list.filter((o) => o.status === 'en_preparacion')
  const ready = list.filter((o) => o.status === 'aprobado')

  return (
    <div className="page">
      <PageHeader phase={1} title="Preparación de pedidos" subtitle="Pedidos aprobados con el stock reservado. Al comenzar, se abre el checklist con la ubicación de cada producto." />
      {q.isLoading ? <Spinner /> : (
        <>
          <section className="prep-section">
            <h2 className="section-label">En preparación · {inProgress.length}</h2>
            {inProgress.length ? <div className="prep-grid">{inProgress.map((o) => <PrepCard key={o.id} order={o} />)}</div>
              : <p className="muted">No hay pedidos a medio preparar.</p>}
          </section>
          <section className="prep-section">
            <h2 className="section-label">Listos para preparar · {ready.length}</h2>
            {ready.length ? <div className="prep-grid">{ready.map((o) => <PrepCard key={o.id} order={o} />)}</div>
              : <EmptyState icon={ClipboardList} title="No hay pedidos esperando">Cuando se apruebe un pedido, aparece acá.</EmptyState>}
          </section>
        </>
      )}
    </div>
  )
}

function PrepCard({ order: summary }: { order: OrderSummary }) {
  const detail = useOrder(summary.id)
  const transition = useTransition(summary.id)
  const navigate = useNavigate()
  const toast = useToast()
  const o = detail.data
  const start = () => transition.mutate({ to: 'en_preparacion' }, {
    onSuccess: () => navigate(`/preparacion/${summary.id}`),
    onError: (e) => toast.error(e.message),
  })

  return (
    <article className="prep-card">
      <header className="prep-card__head">
        <span className="prep-card__no">PEDIDO {summary.number}</span>
        <PriorityBadge priority={summary.priority} />
      </header>
      <p className="prep-card__who">{summary.companyName}{summary.sector && ` · ${summary.sector}`}</p>
      {o ? (
        <ul className="prep-card__items">
          {o.items.map((i) => (
            <li key={i.id} className={i.picked ? 'is-done' : undefined}>
              <span className="mono">{fmt(i.quantity)} ×</span> {i.productName}
              {i.reserved < i.quantity && <Badge tone="red">Faltan {i.quantity - i.reserved}</Badge>}
            </li>
          ))}
        </ul>
      ) : <Spinner />}
      <div className="prep-card__meta">
        <span>Necesario <NeededBy order={summary} /></span>
        {summary.assignedToName && <span>Asignado a {summary.assignedToName}</span>}
      </div>
      {summary.status === 'aprobado' ? (
        <Button variant="primary" block icon={PackageCheck} onClick={start} loading={transition.isPending}>Comenzar preparación</Button>
      ) : (
        <>
          <Progress value={summary.pickedCount} max={summary.itemCount} tone="green" />
          <Button variant="secondary" block icon={ArrowRight} onClick={() => navigate(`/preparacion/${summary.id}`)}>
            Continuar · {summary.pickedCount} de {summary.itemCount}
          </Button>
        </>
      )}
    </article>
  )
}

export function PickingPage() {
  const id = Number(useParams().id)
  const q = useOrder(id)
  return <div className="page page--narrow"><Loadable query={q}>{(o) => <Checklist order={o} />}</Loadable></div>
}

function Checklist({ order: o }: { order: OrderDetail }) {
  const pick = usePick(o.id)
  const transition = useTransition(o.id)
  const toast = useToast()
  const [pending, setPending] = useState<number | null>(null)
  const done = o.items.filter((i) => i.picked).length
  const all = done === o.items.length
  const canPick = o.actions.includes('pick')

  const toggle = (itemId: number, picked: boolean) => {
    setPending(itemId)
    pick.mutate({ itemId, picked }, { onError: (e) => toast.error(e.message), onSettled: () => setPending(null) })
  }

  if (o.status === 'preparado' || o.status === 'entregado' || o.status === 'finalizado') {
    return (
      <div className="prep-done">
        <PartyPopper size={44} aria-hidden />
        <h1>Pedido {o.number} preparado</h1>
        <p className="muted">Quedó listo para entregar. El encargado recibió el aviso.</p>
        <div className="prep-done__actions">
          <Link to="/preparacion" className="btn btn--primary btn--lg">Siguiente pedido</Link>
          <Link to={`/pedidos/${o.id}`} className="btn btn--secondary btn--lg">Ver el pedido</Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <PageHeader
        phase={1}
        back={{ to: '/preparacion', label: 'Preparación' }}
        title={`Pedido ${o.number}`}
        subtitle={<>{o.companyName}{o.sector && ` · ${o.sector}`} · <StatusPill status={o.status} size="sm" /></>}
      />
      <div className="checklist-progress">
        <span><strong>{done}</strong> de {o.items.length} productos</span>
        <Progress value={done} max={o.items.length} tone="green" />
      </div>
      {!canPick && <p className="note note--amber">Este pedido no está en preparación o está asignado a otra persona.</p>}

      <ul className="checklist">
        {o.items.map((i) => {
          const short = i.quantity - i.reserved
          return (
            <li key={i.id}>
              <label className={`check-item${i.picked ? ' is-checked' : ''}${short > 0 ? ' is-blocked' : ''}`}>
                <input
                  type="checkbox"
                  checked={i.picked}
                  disabled={!canPick || short > 0 || pending === i.id}
                  onChange={(e) => toggle(i.id, e.target.checked)}
                />
                <span className="check-item__box" aria-hidden />
                <span className="check-item__body">
                  <span className="check-item__title"><span className="mono">{fmt(i.quantity)} {i.unit === 'u' ? 'u.' : i.unit}</span> {i.productName}</span>
                  <span className="check-item__where">
                    {i.allocations.map((a) => (
                      <span key={a.inventoryId} className="where"><MapPin size={14} aria-hidden /><b>{a.locationCode}</b> · tomar {fmt(a.quantity)}</span>
                    ))}
                  </span>
                  {short > 0 && <span className="check-item__short"><CircleAlert size={15} aria-hidden /> Faltan {short} sin stock reservado</span>}
                  {i.picked && i.pickedByName && <span className="check-item__by">Preparado por {i.pickedByName.split(' ')[0]}</span>}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <Card padded>
        {all ? (
          <div className="ready-row">
            <PackageCheck size={26} aria-hidden />
            <div><strong>Todo listo</strong><p className="muted">Confirmá para avisar que el pedido está preparado.</p></div>
          </div>
        ) : <p className="muted">Marcá cada producto a medida que lo retirás de su ubicación.</p>}
        <ErrorNote error={transition.error} />
        <Button
          variant="primary" size="lg" block icon={PackageCheck} disabled={!all || !o.actions.includes('prepared')} loading={transition.isPending}
          onClick={() => transition.mutate({ to: 'preparado' }, { onSuccess: () => toast.ok(`Pedido ${o.number} preparado`) })}
        >
          Pedido preparado
        </Button>
        <Link to={`/pedidos/${o.id}`} className="small-link">Ver detalle y comentarios</Link>
      </Card>
    </>
  )
}
