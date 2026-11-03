/**
 * Visor del depósito: el plano (2D, editable) o el depósito en 3D (también editable: se toca y
 * se arrastra), con los racks ubicados si los hay. Lo seleccionado tiene su barra de acciones.
 */
import { AlertTriangle, Box, Copy, Map as MapIcon, Maximize2, Minus, Package, Plus, RotateCw, Trash2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { PlacedRack } from '../../shared/plan/depot'
import { removeItem, removeVertex } from '../../shared/plan/edit'
import { duplicateRack, freezeRacks, rotateRack, setRackModules, setRackPair } from '../../shared/plan/racks'
import type { Plan, PlanSelection } from '../../shared/plan/types'
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
  useKeys3d(view3d, rackLayer)
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
          ? <Suspense fallback={<Spinner />}><Plan3D plan={plan} racks={racks} showLoads={showLoads} issues={rackLayer?.issues} /></Suspense>
          : <PlanEditor fitRequest={fit} rackLayer={rackLayer} />}
        <SelectionBar rackLayer={rackLayer} />
        {view3d && <p className="plan-stage__hint">Tocá algo para elegirlo y arrastralo para moverlo · arrastrá el fondo para girar</p>}
      </div>
    </section>
  )
}

/** Borra lo seleccionado (los racks automáticos se copian al plano antes de borrar uno). */
function removeSelection(p: Plan, sel: PlanSelection, layer?: PlanRackLayer): Plan {
  if (!sel || sel.kind === 'edge') return p
  if (sel.kind === 'vertex') return removeVertex(p, sel.index)
  if (sel.kind === 'rack') return removeItem(freezeRacks(p, layer?.racks ?? []), 'rack', sel.id)
  return removeItem(p, sel.kind, sel.id)
}

/** En 3D (el plano tiene los suyos): Supr borra, Ctrl+Z / Ctrl+Y deshacen y rehacen, Esc deselecciona. */
function useKeys3d(active: boolean, layer?: PlanRackLayer) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      const s = usePlan.getState()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo() }
      else if (e.key === 'Escape') s.select(null)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection && s.selection.kind !== 'edge') {
        e.preventDefault()
        const sel = s.selection
        s.commit((p) => removeSelection(p, sel, layer))
        s.select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, layer])
}

const NAMES: Record<string, string> = { column: 'Columna', wall: 'Tabique', door: 'Portón', zone: 'Zona libre', vertex: 'Esquina' }

/** Barra flotante con lo que se puede hacer con lo seleccionado. */
function SelectionBar({ rackLayer }: { rackLayer?: PlanRackLayer }) {
  const { selection, commit, select, layout } = usePlan()
  if (!selection || selection.kind === 'edge') return null
  const del = () => { commit((p) => removeSelection(p, selection, rackLayer)); select(null) }
  const delBtn = <button type="button" className="vp-btn" onClick={del}><Trash2 size={14} aria-hidden /> Borrar</button>

  if (selection.kind !== 'rack') return (
    <div className="plan-selbar" role="toolbar" aria-label="Seleccionado">
      <strong>{NAMES[selection.kind]}</strong>
      <span className="plan-selbar__hint">arrastrá para mover</span>
      {delBtn}
    </div>
  )

  const r = rackLayer?.racks.find((x) => x.id === selection.id)
  if (!r || !rackLayer) return null
  const placements = rackLayer.racks
  const edit = (fn: (p: Plan) => Plan) => commit((p) => fn(freezeRacks(p, placements)))
  const issue = rackLayer.issues?.[r.id]
  return (
    <div className="plan-selbar" role="toolbar" aria-label="Rack seleccionado">
      <strong>Rack {r.pair ? 'doble' : 'simple'}</strong>
      <span className="plan-selbar__group" aria-label="Módulos">
        <button type="button" className="vp-btn vp-btn--icon" aria-label="Un módulo menos" disabled={r.modules <= 1} onClick={() => edit((p) => setRackModules(p, r.id, r.modules - 1))}><Minus size={14} aria-hidden /></button>
        <span className="plan-selbar__n">{r.modules} {r.modules === 1 ? 'módulo' : 'módulos'}</span>
        <button type="button" className="vp-btn vp-btn--icon" aria-label="Un módulo más" onClick={() => edit((p) => setRackModules(p, r.id, r.modules + 1))}><Plus size={14} aria-hidden /></button>
      </span>
      <button type="button" className="vp-btn" onClick={() => edit((p) => setRackPair(p, r.id, !r.pair))}>{r.pair ? 'Hacer simple' : 'Hacer doble'}</button>
      <button type="button" className="vp-btn" onClick={() => edit((p) => rotateRack(p, r.id))}><RotateCw size={14} aria-hidden /> Girar</button>
      <button type="button" className="vp-btn" onClick={() => {
        let nid = ''
        edit((p) => { const d = duplicateRack(p, r.id, layout.aisle); nid = d.id; return d.plan })
        if (nid) select({ kind: 'rack', id: nid })
      }}><Copy size={14} aria-hidden /> Duplicar</button>
      {delBtn}
      {issue && <span className="plan-selbar__issue"><AlertTriangle size={14} aria-hidden /> {issue}</span>}
    </div>
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
