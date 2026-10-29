/** Visor del depósito: el plano (2D, editable) o el depósito en 3D, con los racks ubicados si los hay. */
import { Box, Map as MapIcon, Maximize2, Package } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import type { PlacedRack } from '../../shared/plan/depot'
import { Segmented, Spinner } from '../components/ui'
import { PlanEditor, type PlanRackLayer } from './PlanEditor'
import { PlanPanel } from './PlanPanel'
import { usePlan } from './planStore'

const Plan3D = lazy(() => import('./Plan3D').then((x) => ({ default: x.Plan3D })))

/** Con muchos pallets el 3D se pone pesado: arriba de este número arrancan ocultos. */
const MANY_PALLETS = 1500

export function PlanStage({ rackLayer, racks }: { rackLayer?: PlanRackLayer; racks?: PlacedRack[] }) {
  const { view3d, setView3d, plan } = usePlan()
  const [fit, setFit] = useState(0)
  const pallets = (racks ?? []).reduce((n, r) => n + r.structure.pallets.length, 0)
  const [loads, setLoads] = useState<boolean | null>(null)
  const showLoads = loads ?? pallets <= MANY_PALLETS
  return (
    <section className="plan-stage" aria-label={view3d ? 'Depósito en 3D' : 'Plano del depósito'}>
      <div className="plan-stage__bar">
        <Segmented label="Vista" value={view3d ? '3d' : '2d'} onChange={(v) => setView3d(v === '3d')}
          options={[{ value: '2d', label: <><MapIcon size={15} aria-hidden /> Plano</> }, { value: '3d', label: <><Box size={15} aria-hidden /> 3D</> }]} />
        {!view3d && <button type="button" className="vp-btn" onClick={() => setFit((n) => n + 1)}><Maximize2 size={14} aria-hidden /> Encuadrar</button>}
        {view3d && !!racks?.length && (
          <label className="plan-snap plan-stage__loads"><input type="checkbox" checked={showLoads} onChange={(e) => setLoads(e.target.checked)} /> <Package size={14} aria-hidden /> Ver pallets</label>
        )}
      </div>
      <div className="plan-stage__body">
        {view3d
          ? <Suspense fallback={<Spinner />}><Plan3D plan={plan} racks={racks} showLoads={showLoads} /></Suspense>
          : <PlanEditor fitRequest={fit} rackLayer={rackLayer} />}
      </div>
    </section>
  )
}

/** Panel + visor del depósito, sin racks (vista suelta del plano). */
export function PlanWorkspace() {
  return (
    <div className="plan-layout">
      <PlanPanel />
      <PlanStage />
    </div>
  )
}
