/**
 * LO QUE VE EL CLIENTE con su link (…?ver=CÓDIGO): el proyecto terminado, sólo para mirar. Sin
 * usuario ni contraseña. Puede pasar del plano al 3D, moverse, acercarse y recorrerlo a pie, pero
 * no elegir, mover, marcar ni cambiar nada (el sistema queda en modo "sólo mirar").
 */
import { Eye } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createJSONStorage } from 'zustand/middleware'
import { moduleSize } from '../shared/plan/depot'
import { planArea } from '../shared/plan/geometry'
import { Logo } from '../web/components/Logo'
import { useDesigner } from '../web/pages/designer/designerStore'
import { PlanStage } from '../web/plan/PlanWorkspace'
import { usePlan } from '../web/plan/planStore'
import { CloudError, viewProject } from './cloud'
import { DepotStrip, useDepot } from './DepotFlow'
import { showForView, useProject } from './projects'

/** El código del link de cliente, si la dirección lo trae. */
export const viewCode = (): string | null => {
  const c = new URLSearchParams(window.location.search).get('ver')
  return c ? c.replace(/[^A-Za-z0-9]/g, '').toLowerCase() : null
}

/**
 * Antes de mostrar nada: en este navegador no se guarda lo que se ve (si el que mira también usa el
 * sistema, su trabajo no se pisa) y todo queda en "sólo mirar".
 */
export function enterViewMode() {
  const none = createJSONStorage(() => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }))
  usePlan.persist.setOptions({ storage: none })
  useDesigner.persist.setOptions({ storage: none })
  useProject.persist.setOptions({ storage: none })
}

export function ClientView({ code }: { code: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    viewProject(code).then((p) => {
      if (!alive) return
      if (!showForView(p.data)) { setError('Este proyecto no se puede mostrar.'); setState('error'); return }
      usePlan.getState().setViewOnly(true)
      usePlan.setState({ flowStep: 'distribucion', section: 'deposito' })
      setName(p.name)
      setDate(new Date(p.updated_at).toLocaleDateString('es-AR'))
      document.title = `${p.name} · Sistemas de Carga S.A.`
      setState('ready')
    }).catch((e) => { if (alive) { setError(e instanceof CloudError ? e.message : 'No se pudo abrir el proyecto.'); setState('error') } })
    return () => { alive = false }
  }, [code])

  return (
    <div className="cv">
      <header className="cv__top">
        <Logo size={40} />
        <div className="cv__title">
          <span className="cz-top__eyebrow">Sistemas de Carga S.A.</span>
          <h1>{state === 'ready' ? name : 'Proyecto de depósito'}</h1>
        </div>
        {state === 'ready' && <span className="cv__tag"><Eye size={14} aria-hidden /> Solo para ver{date ? ` · al ${date}` : ''}</span>}
      </header>
      <main className="cv__main">
        {state === 'loading' && <p className="cv__msg">Abriendo el proyecto…</p>}
        {state === 'error' && <div className="cv__msg"><strong>No se puede ver este proyecto</strong><span>{error}</span></div>}
        {state === 'ready' && <Stage />}
      </main>
    </div>
  )
}

/** El plano y el 3D del proyecto, con sus números arriba. */
function Stage() {
  const { depot } = useDepot()
  const plan = usePlan((s) => s.plan)
  const config = useDesigner((s) => s.config)
  const size = useMemo(() => moduleSize(config).size, [config])
  const area = planArea(plan.outline)
  // los avisos de armado (racks en rojo) son para quien lo diseña, no para el cliente
  const rackLayer = useMemo(() => ({ racks: depot.layout.placements, size, issues: {} }), [depot, size])
  return <PlanStage rackLayer={rackLayer} racks={depot.racks} summary={area > 0 && <DepotStrip depot={depot} area={area} />} />
}
