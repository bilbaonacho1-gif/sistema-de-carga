/**
 * Visor del depósito: el plano (2D, editable) o el depósito en 3D (también editable: se toca y
 * se arrastra), con los racks ubicados si los hay. Lo seleccionado tiene su barra de acciones.
 */
import { AlertTriangle, Box, Copy, Map as MapIcon, Maximize2, Package, RotateCw, Trash2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { PlacedRack } from '../../shared/plan/depot'
import { removeItem, removeVertex } from '../../shared/plan/edit'
import { duplicateWithin, fitPlacement, freezeRacks, mapRacks, removeRacks, selectedRackIds, guarded, moveRack, rotateRack, setRackModules, setRackPair } from '../../shared/plan/racks'
import { metros } from '../../shared/units'
import { NumberStepper } from '../components/fields'
import type { Plan, PlanSelection, RackPlacement } from '../../shared/plan/types'
import { Segmented, Spinner } from '../components/ui'
import { PlanEditor, type PlanRackLayer } from './PlanEditor'
import { PlanPanel } from './PlanPanel'
import { usePlan } from './planStore'

const Plan3D = lazy(() => import('./Plan3D').then((x) => ({ default: x.Plan3D })))

/** Con muchos pallets el 3D se pone pesado: arriba de este número arrancan ocultos. */
const MANY_PALLETS = 1500

export function PlanStage({ rackLayer, racks, summary }: { rackLayer?: PlanRackLayer; racks?: PlacedRack[]; summary?: ReactNode }) {
  const { view3d: want3d, setView3d, plan } = usePlan()
  // sin depósito todavía no hay nada que ver en 3D: se queda en el plano
  const empty = plan.outline.points.length < 3
  const view3d = want3d && !empty
  const [fit, setFit] = useState(0)
  const pallets = (racks ?? []).reduce((n, r) => n + r.structure.pallets.length, 0)
  const [loads, setLoads] = useState<boolean | null>(null)
  // con muchos racks el 3D va en lote y las cajas no pesan: se ven siempre; con pocos racks muy largos, sólo si no son demasiadas
  const showLoads = loads ?? ((racks?.length ?? 0) > 30 || pallets <= MANY_PALLETS)
  useKeys3d(view3d, rackLayer)
  return (
    <section className="plan-stage" aria-label={view3d ? 'Depósito en 3D' : 'Plano del depósito'}>
      <div className="plan-stage__bar">
        {!empty && <Segmented label="Vista" value={view3d ? '3d' : '2d'} onChange={(v) => setView3d(v === '3d')}
          options={[{ value: '2d', label: <><MapIcon size={15} aria-hidden /> Plano</> }, { value: '3d', label: <><Box size={15} aria-hidden /> 3D</> }]} />}
        {!view3d && !empty && <button type="button" className="vp-btn" onClick={() => setFit((n) => n + 1)}><Maximize2 size={14} aria-hidden /> Encuadrar</button>}
        {view3d && !!racks?.length && (
          <label className="plan-snap plan-stage__loads"><input type="checkbox" checked={showLoads} onChange={(e) => setLoads(e.target.checked)} /> <Package size={14} aria-hidden /> Ver pallets</label>
        )}
        {summary && <div className="plan-stage__summary">{summary}</div>}
      </div>
      <div className="plan-stage__body">
        {view3d
          ? <Suspense fallback={<Spinner />}><Plan3D plan={plan} racks={racks} showLoads={showLoads} issues={rackLayer?.issues} size={rackLayer?.size} /></Suspense>
          : <PlanEditor fitRequest={fit} rackLayer={rackLayer} />}
        {view3d && <p className="plan-stage__hint">Tocá algo para elegirlo y arrastralo para moverlo · arrastrá el fondo para girar</p>}
      </div>
    </section>
  )
}

/** Borra lo seleccionado (los racks automáticos se copian al plano antes de borrar uno). */
function removeSelection(p: Plan, sel: PlanSelection, layer?: PlanRackLayer): Plan {
  if (!sel || sel.kind === 'edge') return p
  if (sel.kind === 'vertex') return removeVertex(p, sel.index)
  if (sel.kind === 'rack' || sel.kind === 'racks') return removeRacks(freezeRacks(p, layer?.racks ?? []), selectedRackIds(sel))
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

/**
 * Lo que se puede hacer con el rack seleccionado: módulos, simple o doble, girar, duplicar y borrar.
 * Va en el panel de la izquierda (arriba de todo) mientras el rack está seleccionado.
 */
export function RackEditor({ rackLayer, defaults }: { rackLayer: PlanRackLayer; defaults: RackDefaults }) {
  const { selection, commit, select, layout, plan } = usePlan()
  /** Medida escrita que no se pudo aplicar (el rack quedaría en un lugar prohibido). */
  const [rejected, setRejected] = useState<{ n: number; why: string } | null>(null)
  if (selection?.kind !== 'rack') return null
  const r = rackLayer.racks.find((x) => x.id === selection.id)
  if (!r) return null
  const placements = rackLayer.racks
  const size = rackLayer.size
  const base = freezeRacks(plan, placements)
  // cada cambio se prueba antes: si el rack terminaría en una zona libre, un pasillo o fuera de la
  // zona de racks, el botón queda apagado
  const tryEdit = (fn: (p: Plan) => Plan) => { const after = guarded(base, fn(base), r.id, size); return after === base ? null : after }
  const pair = tryEdit((p) => setRackPair(p, r.id, !r.pair))
  const rotated = tryEdit((p) => rotateRack(p, r.id))
  const dup = duplicateWithin(base, r.id, layout.aisle, size)
  const apply = (next: Plan | null) => { if (next) commit(() => next) }
  const noRoom = 'No entra: pisaría una zona libre, un pasillo o saldría de la zona de racks'
  const issue = rackLayer.issues?.[r.id]
  return (
    <div className="plan-sel rack-editor">
      <h2 className="section-label">Rack {r.pair ? 'doble (espalda con espalda)' : 'simple'}</h2>
      <span className="muted small">{metros(fitPlacement(r, size).length)} × {metros(fitPlacement(r, size).depth)}</span>
      {issue && <p className="rack-editor__issue"><AlertTriangle size={14} aria-hidden /> {issue}</p>}
      {/* todo escrito a mano: si el rack no entra ahí, no se aplica y se avisa */}
      <div key={`${r.id}-${rejected?.n ?? 0}`} className="rack-editor__fields">
        <NumberStepper label="Módulos" value={r.modules} min={1} max={120} step={1}
          onChange={(v) => { const next = tryEdit((p) => setRackModules(p, r.id, v)); if (next) { commit(() => next); setRejected(null) } else setRejected({ n: (rejected?.n ?? 0) + 1, why: noRoom }) }}
          />
        <div className="plan-xy">
          <NumberStepper label="X" meters value={r.x} min={-500_000} max={500_000} step={1000} typedStep={10}
            onChange={(x) => { const next = tryEdit((p) => moveRack(p, r.id, x, r.y)); if (next) { commit(() => next); setRejected(null) } else setRejected({ n: (rejected?.n ?? 0) + 1, why: 'Ahí no entra: pisaría una zona libre o un pasillo, o saldría de la zona de racks.' }) }} />
          <NumberStepper label="Y" meters value={r.y} min={-500_000} max={500_000} step={1000} typedStep={10}
            onChange={(y) => { const next = tryEdit((p) => moveRack(p, r.id, r.x, y)); if (next) { commit(() => next); setRejected(null) } else setRejected({ n: (rejected?.n ?? 0) + 1, why: 'Ahí no entra: pisaría una zona libre o un pasillo, o saldría de la zona de racks.' }) }} />
        </div>
      </div>
      {rejected && <p className="rack-editor__issue"><AlertTriangle size={14} aria-hidden /> {rejected.why}</p>}
      <RackOverrides racks={[r]} defaults={defaults} onChange={(patch) => commit(() => mapRacks(base, [r.id], (q) => ({ ...q, ...patch })))} />
      <div className="rack-editor__actions">
        <button type="button" className="vp-btn" disabled={!pair} title={pair ? undefined : noRoom} onClick={() => apply(pair)}>{r.pair ? 'Hacer simple' : 'Hacer doble'}</button>
        <button type="button" className="vp-btn" disabled={!rotated} title={rotated ? undefined : noRoom} onClick={() => apply(rotated)}><RotateCw size={14} aria-hidden /> Girar</button>
        <button type="button" className="vp-btn" disabled={!dup} title={dup ? undefined : 'No hay lugar al lado para otro rack igual'} onClick={() => { if (dup) { commit(() => dup.plan); select({ kind: 'rack', id: dup.id }) } }}><Copy size={14} aria-hidden /> Duplicar</button>
        <button type="button" className="vp-btn" onClick={() => { commit((p) => removeSelection(p, selection, rackLayer)); select(null) }}><Trash2 size={14} aria-hidden /> Borrar</button>
      </div>
      <p className="muted small">Arrastralo en el plano o en el 3D para moverlo: no entra en zonas libres ni pasillos{plan.rackAreas?.length ? ' y no sale de la zona de racks' : ''}. Supr lo borra, Esc termina.</p>
    </div>
  )
}

/** Altura y niveles del rack elegido para todo el depósito (lo que tiene un rack sin medidas propias). */
export interface RackDefaults { height: number; levels: number }

/**
 * Altura y niveles propios de uno o varios racks. Si muestran "como el resto", usan los del rack
 * elegido para todo el depósito.
 */
function RackOverrides({ racks, defaults, onChange }: { racks: RackPlacement[]; defaults: RackDefaults; onChange(patch: Partial<RackPlacement>): void }) {
  const same = <K extends 'levels' | 'height'>(k: K) => (racks.every((r) => r[k] === racks[0][k]) ? racks[0][k] : undefined)
  const levels = same('levels'), height = same('height')
  const own = racks.some((r) => r.levels !== undefined || r.height !== undefined)
  return (
    <div className="rack-editor__fields">
      <NumberStepper label={racks.length > 1 ? 'Niveles (todos los elegidos)' : 'Niveles de este rack'} value={levels ?? defaults.levels} min={1} max={10} step={1}
        onChange={(v) => onChange({ levels: v === defaults.levels ? undefined : v })}
        hint={levels === undefined ? `Como el resto (${defaults.levels})` : `Propio · el resto tiene ${defaults.levels}`} />
      <NumberStepper label={racks.length > 1 ? 'Altura (todos los elegidos)' : 'Altura de este rack'} meters value={height ?? defaults.height} min={2000} max={16_000} step={500} typedStep={10}
        onChange={(v) => onChange({ height: v === defaults.height ? undefined : v })}
        hint={height === undefined ? `Como el resto (${metros(defaults.height)})` : `Propia · el resto tiene ${metros(defaults.height)}`} />
      {own && <button type="button" className="link-btn rack-editor__reset" onClick={() => onChange({ levels: undefined, height: undefined })}>Volver a las medidas de todos</button>}
    </div>
  )
}

/** Varios racks elegidos a la vez: lo mismo que con uno, aplicado a todos (cada uno sólo si entra). */
export function MultiRackEditor({ rackLayer, defaults }: { rackLayer: PlanRackLayer; defaults: RackDefaults }) {
  const { selection, commit, select, plan } = usePlan()
  const [note, setNote] = useState<string | null>(null)
  const ids = selectedRackIds(selection)
  const racks = rackLayer.racks.filter((r) => ids.includes(r.id))
  if (racks.length < 2) return null
  const size = rackLayer.size
  const base = freezeRacks(plan, rackLayer.racks)
  /** Aplica el cambio rack por rack; los que quedarían en un lugar prohibido no se cambian. */
  const each = (fn: (p: Plan, id: string) => Plan) => {
    let p = base, skipped = 0
    for (const id of ids) { const next = guarded(p, fn(p, id), id, size); if (next === p) skipped++; p = next }
    commit(() => p)
    setNote(skipped ? `${skipped} ${skipped === 1 ? 'rack no entraba y quedó' : 'racks no entraban y quedaron'} como estaba${skipped === 1 ? '' : 'n'}.` : null)
  }
  const modules = racks.every((r) => r.modules === racks[0].modules) ? racks[0].modules : undefined
  return (
    <div className="plan-sel rack-editor">
      <h2 className="section-label">{racks.length} racks elegidos</h2>
      <span className="muted small">Shift + clic suma o saca un rack · arrastrá uno para moverlos juntos</span>
      <NumberStepper label="Módulos (todos)" value={modules ?? racks[0].modules} min={1} max={120} step={1}
        onChange={(v) => each((p, id) => setRackModules(p, id, v))} hint={modules === undefined ? 'Ahora tienen distintos módulos' : undefined} />
      <RackOverrides racks={racks} defaults={defaults} onChange={(patch) => commit(() => mapRacks(base, ids, (q) => ({ ...q, ...patch })))} />
      <div className="rack-editor__actions">
        <button type="button" className="vp-btn" onClick={() => each((p, id) => setRackPair(p, id, false))}>Todos simples</button>
        <button type="button" className="vp-btn" onClick={() => each((p, id) => setRackPair(p, id, true))}>Todos dobles</button>
        <button type="button" className="vp-btn" onClick={() => each((p, id) => rotateRack(p, id))}><RotateCw size={14} aria-hidden /> Girar cada uno</button>
        <button type="button" className="vp-btn" onClick={() => { commit(() => removeRacks(base, ids)); select(null) }}><Trash2 size={14} aria-hidden /> Borrar los {racks.length}</button>
      </div>
      {note && <p className="rack-editor__issue"><AlertTriangle size={14} aria-hidden /> {note}</p>}
      <button type="button" className="link-btn" onClick={() => select(null)}>Terminar (deseleccionar)</button>
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
