/** Panel de rack (vista de frente con sus posiciones) y de ubicación (etiqueta + contenido). */
import { ArrowRightLeft, PackagePlus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { POSITION_META } from '../../../shared/stock'
import type { InventoryRow, LocationDetail, PositionContent, RackDetail, RackPosition } from '../../../shared/types'
import { useLocation as useLocationDetail, useRack } from '../../api/queries'
import { useAuth } from '../../auth/AuthContext'
import { LocationLabel } from '../../components/LocationLabel'
import { Badge, Button, EmptyState, Loadable, StatusPill } from '../../components/ui'
import { fmt } from '../../lib/format'
import { MoveDialog, StockInDialog } from '../inventory/StockDialogs'

export function RackPanel({ rackId, positionCode, onPosition }: { rackId: number; positionCode: string | null; onPosition(code: string | null): void }) {
  const q = useRack(rackId)
  return (
    <Loadable query={q}>{(rack) => (
      <div className="rack-panel">
        <RackSummary rack={rack} />
        <Elevation rack={rack} selected={positionCode} onSelect={onPosition} />
        {positionCode && <PositionDetail code={positionCode} />}
        {!positionCode && <p className="muted small">Tocá una posición para ver qué hay guardado.</p>}
      </div>
    )}</Loadable>
  )
}

function RackSummary({ rack }: { rack: RackDetail }) {
  const free = rack.positions - rack.occupied
  return (
    <div className="rack-summary">
      <p className="rack-summary__line"><strong>{fmt(rack.positions)} posiciones</strong> · {rack.modules} módulos × {rack.levels} niveles</p>
      <ul className="legend">
        <li><span className="legend__sw" style={{ background: POSITION_META.disponible.fill }} />{fmt(rack.occupied)} ocupadas</li>
        <li><span className="legend__sw legend__sw--free" />{fmt(free)} libres</li>
        {rack.reserved > 0 && <li><span className="legend__sw" style={{ background: POSITION_META.reservado.fill }} />{fmt(rack.reserved)} con reservas</li>}
      </ul>
      <p className="muted small mono">{fmt(rack.lengthMm)} × {fmt(rack.depthMm)} × {fmt(rack.heightMm)} mm · {fmt(rack.units)} unidades guardadas</p>
    </div>
  )
}

/** Vista de frente: un renglón por nivel (el de arriba primero), una celda por posición. */
function Elevation({ rack, selected, onSelect }: { rack: RackDetail; selected: string | null; onSelect(code: string | null): void }) {
  const levels = [...new Set(rack.positionsList.map((p) => p.level))].sort((a, b) => b - a)
  const perLevel = rack.modules * rack.slotsPerModule
  return (
    <div className="elevation" role="grid" aria-label={`Posiciones del rack ${rack.code}`}>
      {levels.map((lv) => {
        const row = rack.positionsList.filter((p) => p.level === lv).sort((a, b) => a.module - b.module || a.slot - b.slot)
        return (
          <div key={lv} className="elevation__row" role="row">
            <span className="elevation__level">N{lv}</span>
            <div className="elevation__cells" style={{ gridTemplateColumns: `repeat(${perLevel}, minmax(0, 1fr))` }}>
              {row.map((p) => <Cell key={p.id} p={p} slots={rack.slotsPerModule} selected={selected === p.code} onClick={() => onSelect(selected === p.code ? null : p.code)} />)}
            </div>
          </div>
        )
      })}
      <div className="elevation__beam" aria-hidden />
    </div>
  )
}

function Cell({ p, slots, selected, onClick }: { p: RackPosition; slots: number; selected: boolean; onClick(): void }) {
  const m = POSITION_META[p.status]
  const units = p.contents.reduce((s, c) => s + c.quantity, 0)
  const label = `${p.code}: ${m.label}${p.contents.length ? ` · ${p.contents.map((c) => `${c.quantity} ${c.productName}`).join(', ')}` : ''}`
  return (
    <button
      type="button" role="gridcell" aria-selected={selected} title={label} aria-label={label} onClick={onClick}
      className={`cell cell--${p.status}${selected ? ' is-selected' : ''}${p.slot === slots ? ' cell--module-end' : ''}`}
      style={{ background: m.fill, borderColor: m.stroke }}
    >
      <span className="cell__pos">{String((p.module - 1) * slots + p.slot).padStart(2, '0')}</span>
      {units > 0 && <span className="cell__units">{fmt(units)}</span>}
    </button>
  )
}

/** Detalle de una ubicación (posición de rack o zona): etiqueta, contenido y acciones. */
export function PositionDetail({ code }: { code: string }) {
  const q = useLocationDetail(code)
  return <Loadable query={q}>{(d) => <LocationView d={d} />}</Loadable>
}

function LocationView({ d }: { d: LocationDetail }) {
  const { can } = useAuth()
  const [stockIn, setStockIn] = useState(false)
  const [moving, setMoving] = useState<InventoryRow | null>(null)
  const status = POSITION_META[d.status]
  const asRow = (c: PositionContent): InventoryRow => ({
    id: c.inventoryId, productId: c.productId, productCode: c.productCode, productName: c.productName, unit: c.unit,
    locationId: d.location.id, locationCode: d.location.code, locationKind: d.location.kind, sector: d.location.sector,
    quantity: c.quantity, reserved: c.reserved, available: c.available, orders: c.orders,
  })

  return (
    <section className="position" aria-label={`Ubicación ${d.location.code}`}>
      <LocationLabel code={d.location.code} name={d.location.name} />
      <div className="position__status">
        <span className="position__dot" style={{ background: status.fill, borderColor: status.stroke }} />
        <strong>{d.location.kind === 'zona' ? (d.contents.length ? 'Con mercadería por ubicar' : 'Vacía') : status.label}</strong>
        <span className="muted">· {d.location.sector}</span>
      </div>
      {d.contents.length ? (
        <ul className="pos-contents">
          {d.contents.map((c) => (
            <li key={c.inventoryId} className="pos-content">
              <div className="pos-content__head">
                <Link to={`/inventario/${c.productId}`}><strong>{c.productName}</strong></Link>
                <span className="mono muted small">{c.productCode}</span>
              </div>
              <dl className="pos-content__nums">
                <div><dt>Stock</dt><dd>{fmt(c.quantity)}</dd></div>
                <div><dt>Reservado</dt><dd>{fmt(c.reserved)}</dd></div>
                <div><dt>Disponible</dt><dd className={c.available ? 'ok' : 'late'}>{fmt(c.available)}</dd></div>
              </dl>
              {c.orders.length > 0 && (
                <p className="pos-content__orders">
                  {c.orders.map((o) => (
                    <span key={o.orderId}><Badge tone="blue">Reservado</Badge> <Link to={`/pedidos/${o.orderId}`} className="mono strong">{o.number}</Link> · {fmt(o.quantity)} u. <StatusPill status={o.status} size="sm" /></span>
                  ))}
                </p>
              )}
              {can('inventario.mover') && c.available > 0 && (
                <Button size="sm" icon={ArrowRightLeft} onClick={() => setMoving(asRow(c))}>{d.location.kind === 'zona' ? 'Ubicar en rack' : 'Mover'}</Button>
              )}
            </li>
          ))}
        </ul>
      ) : <EmptyState icon={PackagePlus} title="Posición libre">{can('inventario.mover') ? 'Podés ingresar mercadería acá.' : undefined}</EmptyState>}
      {can('inventario.mover') && d.location.kind === 'rack' && (
        <Button variant="secondary" block icon={PackagePlus} onClick={() => setStockIn(true)}>Ingresar stock en {d.location.code}</Button>
      )}
      {stockIn && <StockInDialog location={{ ...d.location, units: 0, products: 0 }} onClose={() => setStockIn(false)} />}
      {moving && <MoveDialog row={moving} onClose={() => setMoving(null)} />}
    </section>
  )
}
