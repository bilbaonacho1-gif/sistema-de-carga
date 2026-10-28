import { ClipboardList, X } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { STATUS_META } from '../../../shared/orders'
import type { OrderStatus, OrderSummary } from '../../../shared/types'
import { useOrders } from '../../api/queries'
import { useAuth } from '../../auth/AuthContext'
import { EmptyState, ErrorNote, PageHeader, SearchInput, Segmented, Spinner, StatusPill } from '../../components/ui'
import { fmt, fmtRelative } from '../../lib/format'
import { useIsMobile } from '../../lib/useMediaQuery'
import { NeededBy, ORDER_GROUPS, PriorityBadge, TypeBadge } from './orderUi'

export function OrdersPage() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const exactStatus = params.get('estado') as OrderStatus | null
  const [group, setGroup] = useState(exactStatus ? 'todos' : 'activos')
  const [type, setType] = useState<'todos' | 'salida' | 'reposicion'>('todos')
  const [search, setSearch] = useState('')
  const deferred = useDeferredValue(search.trim())
  const q = useOrders({ search: deferred || undefined, type: type === 'todos' ? undefined : type })
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  const all = q.data ?? []
  const counts = useMemo(() => Object.fromEntries(ORDER_GROUPS.map((g) => [g.id, g.statuses ? all.filter((o) => g.statuses!.includes(o.status)).length : all.length])), [all])
  const statuses = exactStatus ? [exactStatus] : ORDER_GROUPS.find((g) => g.id === group)?.statuses
  const list = statuses ? all.filter((o) => statuses.includes(o.status)) : all

  return (
    <div className="page">
      <PageHeader phase={1} title="Pedidos" subtitle={can('pedidos.ver_todos') ? 'Solicitudes de material y reposiciones de stock de todas las empresas.' : can('pedidos.ver_propios') ? 'Los pedidos de tu empresa y en qué estado están.' : 'Pedidos asignados a vos y listos para preparar.'} />

      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por número, empresa, sector o producto" />
        {can('inventario.reponer') && (
          <Segmented label="Tipo de pedido" value={type} onChange={setType} options={[
            { value: 'todos', label: 'Todos' }, { value: 'salida', label: 'Solicitudes' }, { value: 'reposicion', label: 'Reposiciones' },
          ]} />
        )}
      </div>

      {exactStatus ? (
        <div className="filter-chip">
          Estado: <strong>{STATUS_META[exactStatus]?.label ?? exactStatus}</strong>
          <button type="button" onClick={() => { params.delete('estado'); setParams(params); setGroup('activos') }} aria-label="Quitar filtro"><X size={15} /></button>
        </div>
      ) : (
        <Segmented label="Estado" value={group} onChange={setGroup} options={ORDER_GROUPS.map((g) => ({ value: g.id, label: g.label, count: counts[g.id] }))} />
      )}

      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : !list.length ? (
        <EmptyState icon={ClipboardList} title={search ? 'No hay pedidos que coincidan' : 'No hay pedidos en este estado'}>
          {search ? 'Probá con otro número, empresa o producto.' : 'Cambiá el filtro para ver los demás.'}
        </EmptyState>
      ) : isMobile ? (
        <ul className="cards">
          {list.map((o) => <li key={o.id}><OrderCard order={o} onOpen={() => navigate(`/pedidos/${o.id}`)} /></li>)}
        </ul>
      ) : (
        <div className="table-wrap">
          <table className="table table--click">
            <thead>
              <tr>
                <th>Pedido</th><th>Empresa / sector</th><th>Solicitante</th><th>Productos</th><th>Necesario</th><th>Estado</th><th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} onClick={() => navigate(`/pedidos/${o.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/pedidos/${o.id}`)}>
                  <td><span className="order-no">{o.number}</span> <TypeBadge type={o.type} /> <PriorityBadge priority={o.priority} /></td>
                  <td><strong>{o.companyName}</strong>{o.sector && <span className="sub">{o.sector}</span>}</td>
                  <td>{o.requesterName}{o.assignedToName && <span className="sub">Prepara: {o.assignedToName}</span>}</td>
                  <td className="num">{o.itemCount} · {fmt(o.totalUnits)} u.{o.shortage && <span className="sub late">Con faltantes</span>}</td>
                  <td><NeededBy order={o} /></td>
                  <td><StatusPill status={o.status} size="sm" /></td>
                  <td className="muted">{fmtRelative(o.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function OrderCard({ order: o, onOpen }: { order: OrderSummary; onOpen(): void }) {
  return (
    <button type="button" className="order-card" onClick={onOpen}>
      <span className="order-card__top">
        <span className="order-no">{o.number}</span>
        <StatusPill status={o.status} size="sm" />
      </span>
      <span className="order-card__who"><strong>{o.companyName}</strong>{o.sector && ` · ${o.sector}`}</span>
      <span className="order-card__meta">
        <span>{o.itemCount} productos · {fmt(o.totalUnits)} u.</span>
        <span>Necesario <NeededBy order={o} /></span>
        <TypeBadge type={o.type} />
        <PriorityBadge priority={o.priority} />
        {o.shortage && <span className="late">Con faltantes</span>}
      </span>
    </button>
  )
}
