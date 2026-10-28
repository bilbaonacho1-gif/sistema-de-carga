import {
  Ban, CheckCheck, CircleAlert, ClipboardCheck, ListChecks, PackageCheck, PackagePlus, RotateCcw, Send, Truck, type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { STATUS_META, TYPE_LABEL } from '../../../shared/orders'
import { ROLE_LABEL } from '../../../shared/permissions'
import type { Location, OrderAction, OrderDetail } from '../../../shared/types'
import { useComment, useLocations, useOrder, useReceive, useReserve, useTransition, useUsers } from '../../api/queries'
import { useMe } from '../../auth/AuthContext'
import { LocationSelect } from '../../components/LocationSelect'
import { OrderTimeline } from '../../components/OrderTimeline'
import { ConfirmDialog, Dialog, useToast } from '../../components/overlays'
import { Avatar, Badge, Button, Card, ErrorNote, Field, KeyValue, Loadable, PageHeader, Select, StatusPill, Textarea } from '../../components/ui'
import { fmt, fmtDate, fmtDateTime, fmtRelative } from '../../lib/format'
import { NeededBy, PriorityBadge, TypeBadge } from './orderUi'

export function OrderPage() {
  const id = Number(useParams().id)
  const q = useOrder(id)
  return (
    <div className="page">
      <Loadable query={q}>{(o) => <OrderView order={o} />}</Loadable>
    </div>
  )
}

type DialogKind = 'approve' | 'deliver' | 'finalize' | 'cancel' | 'receive' | null

function OrderView({ order: o }: { order: OrderDetail }) {
  const navigate = useNavigate()
  const toast = useToast()
  const transition = useTransition(o.id)
  const reserve = useReserve(o.id)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const has = (a: OrderAction) => o.actions.includes(a)

  const run = (to: Parameters<typeof transition.mutate>[0], done: string, after?: () => void) =>
    transition.mutate(to, {
      onSuccess: () => { setDialog(null); toast.ok(done); after?.() },
      onError: (e) => toast.error(e.message),
    })

  const shortItems = o.items.filter((i) => i.reserved < i.quantity)
  const primary: { label: string; icon: LucideIcon; onClick(): void; loading?: boolean }[] = []
  if (has('review')) primary.push({ label: 'Pasar a revisión', icon: ClipboardCheck, onClick: () => run({ to: 'en_revision' }, `${o.number} en revisión`) })
  if (has('approve')) primary.push({ label: 'Aprobar pedido', icon: CheckCheck, onClick: () => setDialog('approve') })
  if (has('start')) primary.push({ label: 'Comenzar preparación', icon: PackageCheck, onClick: () => run({ to: 'en_preparacion' }, `Preparación de ${o.number} iniciada`, () => navigate(`/preparacion/${o.id}`)) })
  if (has('pick')) primary.push({ label: 'Abrir checklist', icon: ListChecks, onClick: () => navigate(`/preparacion/${o.id}`) })
  if (has('deliver')) primary.push({ label: 'Registrar entrega', icon: Truck, onClick: () => setDialog('deliver') })
  if (has('receive')) primary.push({ label: 'Registrar recepción', icon: PackagePlus, onClick: () => setDialog('receive') })
  if (has('finalize')) primary.push({ label: 'Finalizar pedido', icon: CheckCheck, onClick: () => setDialog('finalize') })

  return (
    <>
      <PageHeader
        phase={1}
        back={{ to: '/pedidos', label: 'Pedidos' }}
        title={<span className="title-row">Pedido {o.number} <StatusPill status={o.status} /></span>}
        subtitle={<>{TYPE_LABEL[o.type]} · {o.companyName}{o.sector && ` · ${o.sector}`} · pedido por {o.requesterName} el {fmtDate(o.createdAt)}</>}
        actions={
          <>
            {has('reserve') && <Button icon={RotateCcw} onClick={() => reserve.mutate(undefined, { onSuccess: (r) => toast.ok(r.shortage ? 'Se reservó lo disponible; siguen faltando unidades.' : 'Stock reservado completo'), onError: (e) => toast.error(e.message) })} loading={reserve.isPending}>Reintentar reserva</Button>}
            {has('cancel') && <Button variant="danger" icon={Ban} onClick={() => setDialog('cancel')}>Cancelar</Button>}
            {primary.map((a, i) => (
              <Button key={a.label} variant={i === primary.length - 1 ? 'primary' : 'secondary'} icon={a.icon} onClick={a.onClick} loading={transition.isPending && i === primary.length - 1}>{a.label}</Button>
            ))}
          </>
        }
      />

      <Card padded>
        <OrderTimeline order={o} />
      </Card>

      {o.shortage && (
        <div className="note note--amber note--row" role="status">
          <CircleAlert size={20} aria-hidden />
          <div>
            <strong>Faltan unidades sin reservar.</strong>{' '}
            {shortItems.map((i) => `${i.productName}: faltan ${i.quantity - i.reserved}`).join(' · ')}.
            {' '}No se puede terminar la preparación hasta reservarlas (por ejemplo, al recibir una reposición).
          </div>
        </div>
      )}

      <div className="detail-grid">
        <Card title="Productos" padded={false}>
          <ItemsTable order={o} />
        </Card>
        <Card title="Datos del pedido">
          <KeyValue items={[
            ['Empresa', o.companyName],
            ['Sector', o.sector || '—'],
            ['Solicitante', o.requesterName],
            ['Creado por', o.createdByName],
            ['Fecha', fmtDateTime(o.createdAt)],
            ['Fecha necesaria', <NeededBy key="n" order={o} />],
            ['Prioridad', o.priority === 'normal' ? 'Normal' : <PriorityBadge key="p" priority={o.priority} />],
            ['Prepara', o.assignedToName ?? (o.type === 'salida' ? 'Sin asignar' : '—')],
            ...(o.finalizedAt ? [['Finalizado', fmtDateTime(o.finalizedAt)] as [string, string]] : []),
          ]} />
          {o.notes && <blockquote className="order-notes">{o.notes}</blockquote>}
        </Card>
      </div>

      <Comments order={o} />

      <ApproveDialog order={o} open={dialog === 'approve'} onClose={() => setDialog(null)} onConfirm={(assigneeId, note) => run({ to: 'aprobado', assigneeId, note }, `${o.number} aprobado`)} loading={transition.isPending} error={transition.error?.message} />
      <ConfirmDialog
        open={dialog === 'deliver'} onClose={() => setDialog(null)} title={`¿Registrar la entrega de ${o.number}?`}
        confirmLabel="Registrar entrega" loading={transition.isPending} error={transition.error?.message}
        onConfirm={(note) => run({ to: 'entregado', note }, `${o.number} entregado`)}
      >
        Las <strong>{fmt(o.totalUnits)} unidades</strong> reservadas salen del almacén y se descuentan del stock de cada ubicación.
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'finalize'} onClose={() => setDialog(null)} title="¿Confirmar finalización?"
        confirmLabel="Finalizar" loading={transition.isPending} error={transition.error?.message}
        onConfirm={() => run({ to: 'finalizado' }, `${o.number} finalizado`)}
      >
        El pedido <strong>{o.number}</strong> quedará registrado en el historial y ya no se podrá modificar.
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'cancel'} onClose={() => setDialog(null)} title={`¿Cancelar ${o.number}?`} tone="danger"
        confirmLabel="Cancelar pedido" reasonLabel="Motivo de la cancelación" loading={transition.isPending} error={transition.error?.message}
        onConfirm={(note) => run({ to: 'cancelado', note }, `${o.number} cancelado`)}
      >
        {o.items.some((i) => i.reserved > 0) ? 'Lo que estaba reservado vuelve a quedar disponible en el almacén.' : 'El pedido deja de estar activo.'} El solicitante recibe un aviso con el motivo.
      </ConfirmDialog>
      {dialog === 'receive' && <ReceiveDialog order={o} onClose={() => setDialog(null)} />}
    </>
  )
}

function ItemsTable({ order: o }: { order: OrderDetail }) {
  const reserving = o.type === 'salida' && !['solicitado', 'en_revision', 'cancelado'].includes(o.status)
  return (
    <div className="table-wrap table-wrap--flush">
      <table className="table">
        <thead>
          <tr>
            <th>Producto</th>
            <th className="num">Cantidad</th>
            {o.type === 'salida' ? <><th>Reservado en</th><th>Preparado</th></> : <th className="num">Recibido</th>}
          </tr>
        </thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.id}>
              <td>
                <span className="cell-product"><span className="mono sub">{i.productCode}</span><strong>{i.productName}</strong></span>
                {i.notes && <span className="sub">{i.notes}</span>}
              </td>
              <td className="num"><strong>{fmt(i.quantity)}</strong> {i.unit === 'u' ? 'u.' : i.unit}</td>
              {o.type === 'salida' ? (
                <>
                  <td>
                    {!reserving ? <span className="muted">Se reserva al aprobar</span> : (
                      <span className="alloc-list">
                        {i.allocations.map((a) => <Link key={a.inventoryId} to={`/almacen?ubicacion=${a.locationCode}`} className="alloc">{a.locationCode} · {fmt(a.quantity)}</Link>)}
                        {i.reserved < i.quantity && <Badge tone="red">Faltan {fmt(i.quantity - i.reserved)}</Badge>}
                      </span>
                    )}
                  </td>
                  <td>{i.picked ? <span className="ok">✓ {i.pickedByName?.split(' ')[0]}</span> : <span className="muted">—</span>}</td>
                </>
              ) : (
                <td className="num">{fmt(i.received)} / {fmt(i.quantity)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ApproveDialog({ order: o, open, onClose, onConfirm, loading, error }: {
  order: OrderDetail; open: boolean; onClose(): void; onConfirm(assigneeId: number | null, note: string): void; loading: boolean; error?: string
}) {
  const operarios = useUsers('operario')
  const [assignee, setAssignee] = useState<string>('')
  const [note, setNote] = useState('')
  return (
    <Dialog
      open={open} onClose={onClose} title={`Aprobar ${o.number}`}
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button><Button variant="primary" loading={loading} onClick={() => onConfirm(assignee ? Number(assignee) : null, note)}>Aprobar pedido</Button></>}
    >
      <p className="confirm-text">
        {o.type === 'salida'
          ? <>Se reserva el stock disponible de los <strong>{o.itemCount} productos</strong>. Lo que no alcance queda como faltante.</>
          : <>Se confirma la reposición de <strong>{fmt(o.totalUnits)} unidades</strong>. Cuando llegue, se registra la recepción.</>}
      </p>
      {o.type === 'salida' && (
        <Field label="Quién lo prepara" hint="Si no elegís a nadie, le llega el aviso a todos los operarios.">{(id) => (
          <Select id={id} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Sin asignar</option>
            {(operarios.data ?? []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}</Field>
      )}
      <Field label="Nota" optional>{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      {error && <p className="error-note">{error}</p>}
    </Dialog>
  )
}

type Loc = Location & { units: number; products: number }

function ReceiveDialog({ order: o, onClose }: { order: OrderDetail; onClose(): void }) {
  const receive = useReceive(o.id)
  const toast = useToast()
  const rec = useLocations('REC').data?.find((l) => l.code === 'REC') ?? null
  const [lines, setLines] = useState(() => o.items.map((i) => ({ itemId: i.id, quantity: i.quantity - i.received, location: null as Loc | null })))
  const set = (k: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, j) => (j === k ? { ...l, ...patch } : l)))

  const submit = () => receive.mutate(
    { lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, locationId: (l.location ?? rec)!.id })) },
    { onSuccess: () => { toast.ok(`Recepción de ${o.number} registrada`); onClose() } },
  )

  return (
    <Dialog
      open onClose={onClose} title={`Recepción de ${o.number}`} width={640}
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button><Button variant="primary" icon={PackagePlus} loading={receive.isPending} disabled={!rec && lines.some((l) => !l.location)} onClick={submit}>Ingresar al stock</Button></>}
    >
      <p className="confirm-text">Indicá cuánto llegó y dónde se guarda. Si no elegís ubicación, queda en <strong>Recepción</strong> para ubicarla después.</p>
      {o.items.map((i, k) => (
        <div key={i.id} className="receive-line">
          <div className="receive-line__head">
            <strong>{i.productName}</strong>
            <span className="muted">Pedido: {fmt(i.quantity)} · ya recibido: {fmt(i.received)}</span>
          </div>
          <div className="receive-line__fields">
            <Field label="Llegaron">{(id) => <input id={id} className="input" inputMode="numeric" value={lines[k].quantity} onChange={(e) => set(k, { quantity: Number(e.target.value.replace(/\D/g, '')) || 0 })} />}</Field>
            <Field label="Guardar en">{() => <LocationSelect value={lines[k].location ?? rec} onChange={(l) => set(k, { location: l })} />}</Field>
          </div>
        </div>
      ))}
      <ErrorNote error={receive.error} />
    </Dialog>
  )
}

function Comments({ order: o }: { order: OrderDetail }) {
  const me = useMe()
  const comment = useComment(o.id)
  const [text, setText] = useState('')
  const canComment = o.actions.includes('comment')
  const send = () => comment.mutate(text, { onSuccess: () => setText('') })

  return (
    <Card title={`Comentarios${o.comments.length ? ` · ${o.comments.length}` : ''}`}>
      {o.comments.length ? (
        <ul className="thread">
          {o.comments.map((c) => (
            <li key={c.id} className={`msg${c.userId === me.id ? ' msg--mine' : ''}`}>
              <Avatar name={c.userName} size={32} />
              <div className="msg__bubble">
                <div className="msg__head"><strong>{c.userName.split(' ')[0]}</strong><span>{ROLE_LABEL[c.userRole]}</span><time dateTime={c.createdAt}>{fmtRelative(c.createdAt)}</time></div>
                <p>{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="muted">Todavía no hay comentarios en este pedido.</p>}
      {canComment ? (
        <form className="composer" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send() }}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribí un comentario para el equipo…" aria-label="Comentario" rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) send() }} />
          <Button type="submit" variant="primary" icon={Send} loading={comment.isPending} disabled={!text.trim()}>Comentar</Button>
        </form>
      ) : <p className="muted small">{['finalizado', 'cancelado'].includes(o.status) ? `El pedido está ${STATUS_META[o.status].label.toLowerCase()}: los comentarios quedan como registro.` : ''}</p>}
      <ErrorNote error={comment.error} />
    </Card>
  )
}

export { TypeBadge }
