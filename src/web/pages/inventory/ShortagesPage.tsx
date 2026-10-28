/** FALTANTES: productos con disponible por debajo del mínimo. "Solicitar material" genera una reposición. */
import { CircleCheck, Send, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { STOCK_META, suggestedReplenishment } from '../../../shared/stock'
import type { ProductStock } from '../../../shared/types'
import { useProducts, useReplenish } from '../../api/queries'
import { useToast } from '../../components/overlays'
import { Button, EmptyState, Loadable, PageHeader, Progress } from '../../components/ui'
import { fmt } from '../../lib/format'

export function ShortagesPage() {
  const q = useProducts({ status: 'faltantes' })
  return (
    <div className="page">
      <PageHeader phase={2} title="Faltantes" subtitle="Productos cuyo disponible quedó por debajo del mínimo. Al solicitar material se genera un pedido de reposición que sigue el mismo recorrido." />
      <Loadable query={q}>{(list) => list.length ? (
        <div className="shortage-grid">
          {[...list].sort((a, b) => a.available / Math.max(a.minStock, 1) - b.available / Math.max(b.minStock, 1)).map((p) => <ShortageCard key={p.id} p={p} />)}
        </div>
      ) : (
        <EmptyState icon={CircleCheck} title="No hay faltantes">Todos los productos están por encima de su stock mínimo.</EmptyState>
      )}</Loadable>
    </div>
  )
}

function ShortageCard({ p }: { p: ProductStock }) {
  const replenish = useReplenish()
  const toast = useToast()
  const [qty, setQty] = useState(String(suggestedReplenishment(p.available, p.minStock)))
  const unit = p.unit === 'u' ? 'u.' : p.unit
  const label = p.status === 'sin_stock' ? 'Sin stock' : p.available <= 0 ? 'Sin disponible' : 'Stock bajo'
  const tone = p.available <= 0 ? 'red' : 'amber'

  return (
    <article className={`shortage shortage--${tone}`}>
      <header className="shortage__head">
        <TriangleAlert size={18} aria-hidden />
        <span>{label}</span>
      </header>
      <h2><Link to={`/inventario/${p.id}`}>{p.name}</Link></h2>
      <p className="mono muted small">{p.code}</p>
      <dl className="shortage__nums">
        <div><dt>Disponible</dt><dd>{fmt(p.available)}</dd></div>
        <div><dt>Mínimo</dt><dd>{fmt(p.minStock)}</dd></div>
        <div><dt>En almacén</dt><dd>{fmt(p.total)}</dd></div>
        <div><dt>Reservado</dt><dd>{fmt(p.reserved)}</dd></div>
      </dl>
      <Progress value={Math.max(p.available, 0)} max={p.minStock} tone={tone === 'red' ? 'red' : 'blue'} />
      {p.replenishmentOrder ? (
        <p className="shortage__open">
          <span style={{ color: STOCK_META.reservado.color }}>Reposición en curso</span>{' '}
          <Link to={`/pedidos/${p.replenishmentOrder.id}`} className="mono strong">{p.replenishmentOrder.number}</Link> · {fmt(p.replenishmentOrder.quantity)} {unit}
        </p>
      ) : (
        <div className="shortage__action">
          <label className="qty-inline">
            <span>Cantidad</span>
            <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} aria-label={`Cantidad a reponer de ${p.name}`} />
            <span className="muted">{unit}</span>
          </label>
          <Button variant="primary" icon={Send} loading={replenish.isPending} disabled={!(Number(qty) > 0)}
            onClick={() => replenish.mutate({ productId: p.id, quantity: Number(qty) }, {
              onSuccess: (o) => toast.ok(`Reposición ${o.number} solicitada: ${fmt(Number(qty))} ${unit} de ${p.name}`),
              onError: (e) => toast.error(e.message),
            })}>
            Solicitar material
          </Button>
        </div>
      )}
    </article>
  )
}
