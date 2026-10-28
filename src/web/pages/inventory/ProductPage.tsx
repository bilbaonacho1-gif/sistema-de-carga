import { ArrowRightLeft, Pencil, PackagePlus, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { InventoryRow, MovementType, ProductDetail } from '../../../shared/types'
import { useProduct, useReplenish } from '../../api/queries'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../components/overlays'
import { Badge, Button, Card, EmptyState, Loadable, PageHeader, Stat, StatusPill, StockBadge } from '../../components/ui'
import { fmt, fmtDateTime } from '../../lib/format'
import { MoveDialog, ProductDialog, StockInDialog } from './StockDialogs'

export const MOVEMENT_LABEL: Record<MovementType, { label: string; tone: 'green' | 'red' | 'blue' | 'neutral' | 'amber' }> = {
  ingreso: { label: 'Ingreso', tone: 'green' },
  egreso: { label: 'Egreso', tone: 'red' },
  reserva: { label: 'Reserva', tone: 'blue' },
  liberacion: { label: 'Liberación', tone: 'neutral' },
  traslado: { label: 'Traslado', tone: 'neutral' },
  ajuste: { label: 'Ajuste', tone: 'amber' },
}

export function ProductPage() {
  const id = Number(useParams().id)
  const q = useProduct(id)
  return <div className="page"><Loadable query={q}>{(p) => <ProductView p={p} />}</Loadable></div>
}

function ProductView({ p }: { p: ProductDetail }) {
  const { can } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const replenish = useReplenish()
  const [stockIn, setStockIn] = useState(false)
  const [edit, setEdit] = useState(false)
  const [moving, setMoving] = useState<InventoryRow | null>(null)
  const unit = p.unit === 'u' ? 'u.' : p.unit

  return (
    <>
      <PageHeader
        phase={2}
        back={{ to: '/inventario', label: 'Inventario' }}
        title={<span className="title-row">{p.name} <StockBadge status={p.status} /></span>}
        subtitle={<><span className="mono">{p.code}</span> · {p.category}{p.description && ` · ${p.description}`}</>}
        actions={<>
          {can('productos.editar') && <Button icon={Pencil} onClick={() => setEdit(true)}>Editar</Button>}
          {can('inventario.reponer') && !p.replenishmentOrder && (
            <Button icon={TriangleAlert} loading={replenish.isPending}
              onClick={() => replenish.mutate({ productId: p.id }, { onSuccess: (o) => { toast.ok(`Reposición ${o.number} solicitada`); navigate(`/pedidos/${o.id}`) }, onError: (e) => toast.error(e.message) })}>
              Solicitar reposición
            </Button>
          )}
          {can('inventario.mover') && <Button variant="primary" icon={PackagePlus} onClick={() => setStockIn(true)}>Ingresar stock</Button>}
        </>}
      />

      <div className="stats">
        <Stat label="Total en almacén" value={<>{fmt(p.total)} <small className="unit">{unit}</small></>} />
        <Stat label="Disponible" value={fmt(p.available)} tone={p.available < p.minStock ? (p.available <= 0 ? 'red' : 'amber') : 'green'} />
        <Stat label="Reservado" value={fmt(p.reserved)} tone={p.reserved ? 'blue' : undefined} />
        <Stat label="Stock mínimo" value={fmt(p.minStock)} />
      </div>
      {p.replenishmentOrder && (
        <p className="note note--blue">Hay una reposición en curso: <Link to={`/pedidos/${p.replenishmentOrder.id}`}>{p.replenishmentOrder.number}</Link> por {fmt(p.replenishmentOrder.quantity)} {unit}</p>
      )}

      <div className="detail-grid">
        <Card title="Ubicaciones" padded={false}>
          {p.inventory.length ? (
            <div className="table-wrap table-wrap--flush">
              <table className="table">
                <thead><tr><th>Ubicación</th><th className="num">Cantidad</th><th className="num">Reservado</th><th>Pedidos</th><th /></tr></thead>
                <tbody>
                  {p.inventory.map((r) => (
                    <tr key={r.id}>
                      <td><Link to={`/almacen?ubicacion=${r.locationCode}`} className="mono strong">{r.locationCode}</Link><span className="sub">{r.sector}</span></td>
                      <td className="num">{fmt(r.quantity)}</td>
                      <td className="num">{r.reserved ? fmt(r.reserved) : '—'}</td>
                      <td>{r.orders.map((o) => <Link key={o.orderId} to={`/pedidos/${o.orderId}`} className="alloc">{o.number} · {fmt(o.quantity)}</Link>)}</td>
                      <td className="actions-cell">{can('inventario.mover') && r.available > 0 && <Button size="sm" variant="ghost" icon={ArrowRightLeft} onClick={() => setMoving(r)}>Mover</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={PackagePlus} title="No hay stock en el almacén">Ingresá mercadería o pedí una reposición.</EmptyState>}
        </Card>

        <Card title="Pedidos abiertos">
          {p.openOrders.length ? (
            <ul className="mini-list">
              {p.openOrders.map((o) => (
                <li key={o.id}>
                  <Link to={`/pedidos/${o.id}`}><span className="mono strong">{o.number}</span> {o.type === 'reposicion' && <Badge tone="blue">Reposición</Badge>}</Link>
                  <span className="muted">{o.companyName}</span>
                  <StatusPill status={o.status} size="sm" />
                </li>
              ))}
            </ul>
          ) : <p className="muted">Ningún pedido abierto incluye este producto.</p>}
        </Card>
      </div>

      <Card title="Movimientos" padded={false}>
        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Cantidad</th><th>Desde → hacia</th><th>Pedido</th><th>Usuario</th><th>Nota</th></tr></thead>
            <tbody>
              {p.movements.map((m) => {
                const sign = m.type === 'egreso' || (m.type === 'ajuste' && m.quantity < 0) ? '−' : m.type === 'ingreso' || (m.type === 'ajuste' && m.quantity > 0) ? '+' : ''
                return (
                  <tr key={m.id}>
                    <td className="muted nowrap">{fmtDateTime(m.createdAt)}</td>
                    <td><Badge tone={MOVEMENT_LABEL[m.type].tone}>{MOVEMENT_LABEL[m.type].label}</Badge></td>
                    <td className="num strong">{sign}{fmt(Math.abs(m.quantity))}</td>
                    <td className="mono small">{m.fromLocation ?? ''}{m.fromLocation && m.toLocation ? ' → ' : ''}{m.toLocation ?? ''}</td>
                    <td>{m.orderId ? <Link to={`/pedidos/${m.orderId}`}>{m.orderNumber}</Link> : m.countId ? `Conteo #${m.countId}` : '—'}</td>
                    <td>{m.userName}</td>
                    <td className="muted small">{m.note}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {stockIn && <StockInDialog product={p} onClose={() => setStockIn(false)} />}
      {edit && <ProductDialog product={p} onClose={() => setEdit(false)} />}
      {moving && <MoveDialog row={moving} onClose={() => setMoving(null)} />}
    </>
  )
}
