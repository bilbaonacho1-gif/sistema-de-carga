/** Área del depósito: panel a la izquierda y, a la derecha, el plano (2D) o el depósito en 3D. */
import { Box, Map as MapIcon, Maximize2 } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Segmented, Spinner } from '../components/ui'
import { PlanEditor } from './PlanEditor'
import { PlanPanel } from './PlanPanel'
import { usePlan } from './planStore'

const Plan3D = lazy(() => import('./Plan3D').then((x) => ({ default: x.Plan3D })))

export function PlanWorkspace() {
  const { view3d, setView3d, plan } = usePlan()
  const [fit, setFit] = useState(0)
  return (
    <div className="plan-layout">
      <PlanPanel />
      <section className="plan-stage" aria-label={view3d ? 'Depósito en 3D' : 'Plano del depósito'}>
        <div className="plan-stage__bar">
          <Segmented label="Vista" value={view3d ? '3d' : '2d'} onChange={(v) => setView3d(v === '3d')}
            options={[{ value: '2d', label: <><MapIcon size={15} aria-hidden /> Plano</> }, { value: '3d', label: <><Box size={15} aria-hidden /> 3D</> }]} />
          {!view3d && <button type="button" className="vp-btn" onClick={() => setFit((n) => n + 1)}><Maximize2 size={14} aria-hidden /> Encuadrar</button>}
        </div>
        <div className="plan-stage__body">
          {view3d
            ? <Suspense fallback={<Spinner />}><Plan3D plan={plan} /></Suspense>
            : <PlanEditor fitRequest={fit} />}
        </div>
      </section>
    </div>
  )
}
