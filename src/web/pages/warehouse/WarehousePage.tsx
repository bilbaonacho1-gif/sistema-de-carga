/**
 * ALMACÉN: plano 2D o vista 3D + panel lateral con el sector, rack o ubicación elegidos.
 * La selección vive en la URL (?rack=…&ubicacion=…&pasillo=…&zona=…) para poder compartirla
 * o llegar desde un pedido ("A-04-03-02" abre directamente esa posición).
 */
import { Box, Map as MapIcon, PackagePlus } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { WarehouseMap } from '../../../shared/types'
import { usePositions, useWarehouseMap } from '../../api/queries'
import { useAuth } from '../../auth/AuthContext'
import { Sheet } from '../../components/overlays'
import { Button, Loadable, PageHeader, Progress, Segmented, Spinner, Stat } from '../../components/ui'
import { fmt } from '../../lib/format'
import { useIsMobile } from '../../lib/useMediaQuery'
import { StockInDialog } from '../inventory/StockDialogs'
import { PositionDetail, RackPanel } from './RackPanel'
import { WarehouseMap2D } from './WarehouseMap2D'

const Warehouse3D = lazy(() => import('./Warehouse3D'))

export default function WarehousePage() {
  const map = useWarehouseMap(1)
  return (
    <div className="page page--wide">
      <Loadable query={map}>{(m) => <WarehouseView map={m} />}</Loadable>
    </div>
  )
}

function WarehouseView({ map }: { map: WarehouseMap }) {
  const { can } = useAuth()
  const isMobile = useIsMobile()
  const positions = usePositions(1)
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<'plano' | '3d'>('plano')
  const [stockIn, setStockIn] = useState(false)

  const code = params.get('ubicacion')
  // una ubicación de rack "A-04-03-02" pertenece al rack "A-04"
  const rackFromCode = code ? map.racks.find((r) => code.startsWith(`${r.code}-`)) : undefined
  const rackId = params.get('rack') ? Number(params.get('rack')) : rackFromCode?.id ?? null
  const aisle = params.get('pasillo')
  const zone = params.get('zona') ?? (code && !rackFromCode ? code : null)
  const rack = map.racks.find((r) => r.id === rackId) ?? null

  const select = (next: Record<string, string | null>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v)
    setParams(p, { replace: true })
  }
  const close = () => select({})
  const hasSelection = !!(rack || aisle || zone)
  useEffect(() => { if (mode === '3d') document.body.style.cursor = '' }, [mode])

  const t = map.totals
  const occupancy = t.positions ? Math.round((t.occupied / t.positions) * 100) : 0

  const panelTitle = rack ? `Rack ${rack.code}` : aisle ? `Pasillo ${aisle}` : zone ? map.zones.find((z) => z.code === zone)?.name ?? zone : ''
  const panelEyebrow = rack ? `Pasillo ${rack.aisle}` : aisle ? 'Sector' : 'Zona de piso'
  const panel = rack ? (
    <RackPanel rackId={rack.id} positionCode={code} onPosition={(c) => select({ rack: String(rack.id), ubicacion: c })} />
  ) : aisle ? (
    <AislePanel map={map} aisle={aisle} onRack={(id) => select({ rack: String(id) })} />
  ) : zone ? <PositionDetail code={zone} /> : null

  return (
    <>
      <PageHeader
        phase={2}
        title="Almacén"
        subtitle={`${map.warehouse.name} · ${map.warehouse.address}`}
        actions={<>
          <Segmented label="Vista" value={mode} onChange={setMode} options={[
            { value: 'plano', label: <><MapIcon size={15} aria-hidden /> Plano</> },
            { value: '3d', label: <><Box size={15} aria-hidden /> 3D</> },
          ]} />
          {can('inventario.mover') && <Button variant="primary" icon={PackagePlus} onClick={() => setStockIn(true)}>Ingresar stock</Button>}
        </>}
      />

      <div className="stats">
        <Stat label="Posiciones" value={fmt(t.positions)} hint={`${map.racks.length} racks · ${map.aisles.length} pasillos`} />
        <Stat label="Ocupadas" value={`${occupancy}%`} hint={`${fmt(t.occupied)} posiciones`} tone="green" />
        <Stat label="Con reservas" value={fmt(t.reserved)} tone={t.reserved ? 'blue' : undefined} hint="para pedidos aprobados" />
        <Stat label="Unidades guardadas" value={fmt(t.units)} />
      </div>

      <div className="sectors" role="list" aria-label="Sectores">
        {map.aisles.map((a) => (
          <button key={a.aisle} type="button" role="listitem" className={`sector${aisle === a.aisle ? ' is-active' : ''}`} onClick={() => select(aisle === a.aisle ? {} : { pasillo: a.aisle })}>
            <strong>Pasillo {a.aisle}</strong>
            <span>{a.racks} racks · {a.occupied}/{a.positions}</span>
            <Progress value={a.occupied} max={a.positions} tone="green" />
          </button>
        ))}
        {map.zones.map((z) => (
          <button key={z.id} type="button" role="listitem" className={`sector sector--zone${zone === z.code ? ' is-active' : ''}`} onClick={() => select(zone === z.code ? {} : { zona: z.code })}>
            <strong>{z.name}</strong>
            <span>{z.units ? `${fmt(z.units)} u. por ubicar` : 'Vacía'}</span>
          </button>
        ))}
      </div>

      <div className={`warehouse${hasSelection && !isMobile ? ' has-panel' : ''}`}>
        <div className="warehouse__view">
          {mode === 'plano' ? (
            <WarehouseMap2D
              map={map} positions={positions.data ?? []} selectedRack={rack?.id ?? null} selectedAisle={aisle} selectedZone={zone}
              onRack={(id) => select({ rack: String(id) })} onAisle={(a) => select({ pasillo: a })} onZone={(z) => select({ zona: z })}
            />
          ) : (
            <Suspense fallback={<Spinner label="Armando el almacén en 3D…" />}>
              <Warehouse3D
                map={map} positions={positions.data ?? []} selectedRack={rack?.id ?? null} selectedPosition={code}
                onRack={(id) => select({ rack: String(id) })} onPosition={(rid, c) => select({ rack: String(rid), ubicacion: c })}
              />
            </Suspense>
          )}
        </div>
        {hasSelection && !isMobile && (
          <aside className="warehouse__panel" aria-label={panelTitle}>
            <header className="warehouse__panel-head">
              <div><span className="sheet__eyebrow">{panelEyebrow}</span><h2>{panelTitle}</h2></div>
              <button type="button" className="dialog__close" onClick={close} aria-label="Cerrar">×</button>
            </header>
            <div className="warehouse__panel-body">{panel}</div>
          </aside>
        )}
      </div>

      {isMobile && <Sheet open={hasSelection} onClose={close} title={panelTitle} eyebrow={panelEyebrow}>{panel}</Sheet>}
      {stockIn && <StockInDialog onClose={() => setStockIn(false)} />}
    </>
  )
}

function AislePanel({ map, aisle, onRack }: { map: WarehouseMap; aisle: string; onRack(id: number): void }) {
  const racks = map.racks.filter((r) => r.aisle === aisle)
  return (
    <ul className="aisle-racks">
      {racks.map((r) => (
        <li key={r.id}>
          <button type="button" className="aisle-rack" onClick={() => onRack(r.id)}>
            <span className="mono strong">{r.code}</span>
            <span className="aisle-rack__bar"><Progress value={r.occupied} max={r.positions} tone="green" /></span>
            <span className="muted small">{r.occupied}/{r.positions} ocupadas{r.reserved ? ` · ${r.reserved} con reservas` : ''}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
