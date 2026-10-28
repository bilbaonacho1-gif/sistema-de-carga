import { Boxes, MoveRight, PackagePlus, Plus } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { STOCK_META } from '../../../shared/stock'
import type { InventoryRow, ProductStock, StockStatus } from '../../../shared/types'
import { useCategories, useProducts, useStaging } from '../../api/queries'
import { useAuth } from '../../auth/AuthContext'
import { Button, EmptyState, ErrorNote, PageHeader, SearchInput, Segmented, Select, Spinner, Stat, StockBadge } from '../../components/ui'
import { fmt } from '../../lib/format'
import { useIsMobile } from '../../lib/useMediaQuery'
import { MoveDialog, ProductDialog, StockInDialog } from './StockDialogs'

export function InventoryPage() {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState<'todos' | StockStatus>('todos')
  const deferred = useDeferredValue(search.trim())
  const q = useProducts({ search: deferred || undefined, category: category || undefined })
  const categories = useCategories()
  const staging = useStaging()
  const [stockIn, setStockIn] = useState(false)
  const [newProduct, setNewProduct] = useState(false)
  const [moving, setMoving] = useState<InventoryRow | null>(null)
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  const all = q.data ?? []
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: all.length }
    for (const p of all) c[p.status] = (c[p.status] ?? 0) + 1
    return c
  }, [all])
  const list = status === 'todos' ? all : all.filter((p) => p.status === status)
  const totalUnits = all.reduce((s, p) => s + p.total, 0)

  return (
    <div className="page">
      <PageHeader
        phase={2}
        title="Inventario"
        subtitle="Stock de cada producto: total en el almacén, reservado para pedidos y disponible."
        actions={<>
          {can('productos.editar') && <Button icon={Plus} onClick={() => setNewProduct(true)}>Nuevo producto</Button>}
          {can('inventario.mover') && <Button variant="primary" icon={PackagePlus} onClick={() => setStockIn(true)}>Ingresar stock</Button>}
        </>}
      />

      <div className="stats">
        <Stat label="Productos" value={fmt(all.length)} />
        <Stat label="Unidades en el almacén" value={fmt(totalUnits)} />
        <Stat label="Stock bajo" value={fmt(counts.stock_bajo ?? 0)} tone={counts.stock_bajo ? 'amber' : undefined} to="/faltantes" />
        <Stat label="Sin stock" value={fmt(counts.sin_stock ?? 0)} tone={counts.sin_stock ? 'red' : undefined} to="/faltantes" />
      </div>

      {!!staging.data?.length && (
        <section className="staging" aria-label="Mercadería por ubicar">
          <h2 className="section-label">Por ubicar · en zonas de piso</h2>
          <ul>
            {staging.data.map((r) => (
              <li key={r.id}>
                <span className="mono">{r.locationCode}</span>
                <span><strong>{fmt(r.quantity)} {r.unit === 'u' ? 'u.' : r.unit}</strong> de {r.productName}</span>
                {can('inventario.mover') && <Button size="sm" icon={MoveRight} onClick={() => setMoving(r)} disabled={!r.available}>Ubicar en rack</Button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre, código o categoría" />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {(categories.data ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
      <Segmented label="Estado de stock" value={status} onChange={setStatus} options={[
        { value: 'todos', label: 'Todos', count: counts.todos },
        ...(Object.keys(STOCK_META) as StockStatus[]).map((s) => ({ value: s, label: STOCK_META[s].label, count: counts[s] ?? 0 })),
      ]} />

      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : !list.length ? (
        <EmptyState icon={Boxes} title="No hay productos con ese filtro" />
      ) : isMobile ? (
        <ul className="cards">
          {list.map((p) => <li key={p.id}><ProductCard p={p} onOpen={() => navigate(`/inventario/${p.id}`)} /></li>)}
        </ul>
      ) : (
        <div className="table-wrap">
          <table className="table table--click">
            <thead>
              <tr><th>Código</th><th>Producto</th><th className="num">Total</th><th className="num">Disponible</th><th className="num">Reservado</th><th className="num">Mínimo</th><th>Ubicación</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} onClick={() => navigate(`/inventario/${p.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/inventario/${p.id}`)}>
                  <td className="mono">{p.code}</td>
                  <td><strong>{p.name}</strong><span className="sub">{p.category}</span></td>
                  <td className="num">{fmt(p.total)} <span className="unit">{p.unit === 'u' ? '' : p.unit}</span></td>
                  <td className={`num strong${p.available < p.minStock ? ' late' : ''}`}>{fmt(p.available)}</td>
                  <td className="num">{p.reserved ? fmt(p.reserved) : '—'}</td>
                  <td className="num muted">{fmt(p.minStock)}</td>
                  <td>{p.mainLocation ? <span className="mono">{p.mainLocation}</span> : <span className="muted">—</span>}{p.locations > 1 && <span className="sub">+{p.locations - 1} ubicaciones</span>}</td>
                  <td><StockBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stockIn && <StockInDialog onClose={() => setStockIn(false)} />}
      {newProduct && <ProductDialog product={null} onClose={() => setNewProduct(false)} />}
      {moving && <MoveDialog row={moving} onClose={() => setMoving(null)} />}
    </div>
  )
}

function ProductCard({ p, onOpen }: { p: ProductStock; onOpen(): void }) {
  return (
    <button type="button" className="order-card" onClick={onOpen}>
      <span className="order-card__top"><span className="mono">{p.code}</span><StockBadge status={p.status} /></span>
      <span className="order-card__who"><strong>{p.name}</strong></span>
      <span className="order-card__meta">
        <span>Disponible <strong className={p.available < p.minStock ? 'late' : undefined}>{fmt(p.available)}</strong></span>
        <span>Total {fmt(p.total)}</span>
        {p.reserved > 0 && <span>Reservado {fmt(p.reserved)}</span>}
        {p.mainLocation && <span className="mono">{p.mainLocation}</span>}
      </span>
    </button>
  )
}
