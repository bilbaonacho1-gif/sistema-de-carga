import {
  ArrowRight, Box, CircleCheck, ClipboardCheck, ClipboardList, PackageCheck, PackagePlus, ScanLine, TriangleAlert, Truck, type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router'
import { FLOW, STATUS_META } from '../../shared/orders'
import { ROLE_LABEL } from '../../shared/permissions'
import type { Activity, DashboardData, Task } from '../../shared/types'
import { useDashboard } from '../api/queries'
import { useAuth, useMe } from '../auth/AuthContext'
import { Card, EmptyState, LinkButton, Loadable, PhaseTag, Stat } from '../components/ui'
import { fmt, fmtLongDate, fmtRelative, greeting } from '../lib/format'

const TASK_ICON: Record<Task['kind'], LucideIcon> = {
  revisar: ClipboardList, aprobar: ClipboardCheck, preparar: PackageCheck, entregar: Truck,
  recibir: PackagePlus, finalizar: CircleCheck, reponer: TriangleAlert, conteo: ScanLine,
}

export function DashboardPage() {
  const me = useMe()
  const q = useDashboard()
  return (
    <div className="page">
      <header className="hello">
        <p className="hello__date">{fmtLongDate(new Date())}</p>
        <h1>{greeting()}, {me.name.split(' ')[0]}</h1>
        <p className="hello__role">{ROLE_LABEL[me.role]} · {me.companyName}{me.sector ? ` · ${me.sector}` : ''}</p>
      </header>
      <Loadable query={q}>{(d) => <Dashboard data={d} />}</Loadable>
    </div>
  )
}

function Dashboard({ data }: { data: DashboardData }) {
  const { can } = useAuth()
  const me = useMe()
  const k = data.kpis
  const staff = can('inventario.ver')
  const occupancy = k.positions ? Math.round((k.occupiedPositions / k.positions) * 100) : 0

  return (
    <>
      <section className="summary" aria-label="Resumen">
        <h2 className="section-label">Resumen</h2>
        <div className="stats">
          <Stat label="Pedidos activos" value={fmt(k.activeOrders)} to="/pedidos" />
          <Stat label="En preparación" value={fmt(k.inPreparation)} tone="amber" to="/pedidos?estado=en_preparacion" />
          {staff ? (
            <>
              <Stat label="Stock bajo" value={fmt(k.lowStock)} tone={k.lowStock ? 'amber' : undefined} to="/faltantes" />
              <Stat label="Sin stock" value={fmt(k.outOfStock)} tone={k.outOfStock ? 'red' : undefined} to="/faltantes" />
            </>
          ) : (
            <>
              <Stat label="Preparados" value={fmt(k.prepared)} tone="green" to="/pedidos?estado=preparado" />
              <Stat label="Finalizados" value={fmt(k.finalized)} to="/pedidos?estado=finalizado" />
            </>
          )}
        </div>
        {staff && (
          <div className="stats stats--secondary">
            <Stat label="Productos" value={fmt(k.products)} to="/inventario" />
            <Stat label="Pedidos preparados" value={fmt(k.prepared)} to="/pedidos?estado=preparado" />
            <Stat label="Pedidos finalizados" value={fmt(k.finalized)} to="/pedidos?estado=finalizado" />
            <Stat label="Ocupación del almacén" value={`${occupancy}%`} hint={`${fmt(k.occupiedPositions)} de ${fmt(k.positions)} posiciones`} to="/almacen" />
          </div>
        )}
      </section>

      <FlowStrip flow={data.flow} />

      <div className="dash-grid">
        <Card title="Tareas pendientes" actions={me.role === 'cliente' && <LinkButton to="/pedidos/nuevo" size="sm" variant="primary">Nuevo pedido</LinkButton>}>
          {data.tasks.length ? (
            <ul className="tasks">
              {data.tasks.map((t, i) => {
                const Icon = TASK_ICON[t.kind]
                const to = t.orderId ? (t.kind === 'preparar' ? `/preparacion/${t.orderId}` : `/pedidos/${t.orderId}`) : t.productId ? '/faltantes' : t.countId ? `/conteo/${t.countId}` : '/'
                return (
                  <li key={i}>
                    <Link to={to} className={`task task--${t.kind}`}>
                      <span className="task__icon"><Icon size={18} aria-hidden /></span>
                      <span className="task__text"><strong>{t.title}</strong><span>{t.detail}</span></span>
                      <ArrowRight size={17} aria-hidden className="task__go" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState icon={CircleCheck} title="No hay tareas pendientes">Cuando un pedido necesite tu intervención, aparece acá.</EmptyState>
          )}
        </Card>

        <Card title="Actividad reciente" actions={can('historial.ver_todo') || can('historial.ver_propio') ? <LinkButton to="/historial" size="sm" variant="ghost">Ver historial</LinkButton> : undefined}>
          <ActivityFeed items={data.recent} />
        </Card>
      </div>

      {can('disenador.usar') && me.role === 'cliente' && (
        <Link to="/disenador" className="promo">
          <Box size={26} aria-hidden />
          <span><strong>Cotizador 3D</strong><span>Armá tu rack paso a paso, mirá las medidas y la lista de materiales, y pedí presupuesto.</span></span>
          <ArrowRight size={20} aria-hidden />
        </Link>
      )}
    </>
  )
}

/** Tira del flujo de pedidos: cuántos hay en cada estado (tocar filtra la lista). */
function FlowStrip({ flow }: { flow: DashboardData['flow'] }) {
  const steps = FLOW.salida
  return (
    <section className="flow" aria-label="Pedidos por estado">
      <div className="flow__head">
        <PhaseTag phase={1} />
        <h2 className="section-label">Recorrido de los pedidos</h2>
      </div>
      <ol className="flow__steps">
        {steps.map((s) => (
          <li key={s}>
            <Link to={`/pedidos?estado=${s}`} className={`flow__step${flow[s] ? ' has-items' : ''}`} style={{ ['--c' as string]: STATUS_META[s].color }}>
              <span className="flow__count">{fmt(flow[s])}</span>
              <span className="flow__label">{STATUS_META[s].label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function ActivityFeed({ items, compact }: { items: Activity[]; compact?: boolean }) {
  if (!items.length) return <EmptyState icon={ClipboardList} title="Todavía no hay actividad" />
  return (
    <ul className={`feed${compact ? ' feed--compact' : ''}`}>
      {items.map((a) => (
        <li key={a.id} className={`feed__item feed__item--${a.type.split('.')[0]}`}>
          <span className="feed__dot" aria-hidden />
          <div className="feed__text">
            <p>{a.message}</p>
            <span className="feed__meta">
              <time dateTime={a.createdAt}>{fmtRelative(a.createdAt)}</time>
              {a.orderId && <> · <Link to={`/pedidos/${a.orderId}`}>{a.orderNumber}</Link></>}
              {a.locationCode && <> · <span className="mono">{a.locationCode}</span></>}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
