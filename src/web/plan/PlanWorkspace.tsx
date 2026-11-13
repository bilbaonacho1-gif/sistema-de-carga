/**
 * Visor del depósito: el plano (2D, editable) o el depósito en 3D (también editable: se toca y
 * se arrastra), con los racks ubicados si los hay. Lo seleccionado tiene su barra de acciones.
 */
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Lock, LockOpen, ChevronDown, ChevronRight, Combine, Copy, Focus, Footprints, Forklift, PersonStanding, Scissors, Map as MapIcon, Maximize2, Package, RotateCw, Trash2 } from 'lucide-react'
import { rackNames } from './PlanNotes'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { PlacedRack } from '../../shared/plan/depot'
import { removeItem, removeVertex } from '../../shared/plan/edit'
import { duplicateWithin, fitPlacement, freezeRacks, joinRacks, mapRacks, rackSelection, removeRacks, selectedRackIds, guarded, moveRack, rotateRack, setRackModules, setRackPair, splitRack } from '../../shared/plan/racks'
import { outlinePolygon, planBounds, pointInPolygon } from '../../shared/plan/geometry'
import { placementRect } from '../../shared/plan/layout'
import { metros } from '../../shared/units'
import { NumberStepper } from '../components/fields'
import type { Plan, PlanSelection, RackPlacement } from '../../shared/plan/types'
import { Segmented, Spinner } from '../components/ui'
import { PlanEditor, type PlanRackLayer } from './PlanEditor'
import { PlanPanel } from './PlanPanel'
import { usePlan } from './planStore'
import { RackParts } from './RackParts'
import type { RackConfiguration } from '../../shared/rack/types'

const Plan3D = lazy(() => import('./Plan3D').then((x) => ({ default: x.Plan3D })))

/** Con muchos pallets el 3D se pone pesado: arriba de este número arrancan ocultos. */
const MANY_PALLETS = 1500

export function PlanStage({ rackLayer, racks, summary }: { rackLayer?: PlanRackLayer; racks?: PlacedRack[]; summary?: ReactNode }) {
  const { view3d: want3d, setView3d, plan, isolate, setIsolate, selection, walk, setWalk, walkBy, tool, setTool, symbolKind, setSymbolKind, lock3d, setLock3d } = usePlan()
  // figuras para ver la escala: se elige cuál y se toca el piso (en el plano o en el 3D) donde va
  const placing = tool === 'symbol' && (symbolKind === 'persona' || symbolKind === 'autoelevador') ? symbolKind : null
  const place = (kind: 'persona' | 'autoelevador') => { if (placing === kind) setTool('select'); else { setSymbolKind(kind); setTool('symbol'); setWalk(null) } }
  // vista a pie: arranca en un lugar libre (un pasillo) cerca del centro, mirando a lo largo
  const startWalk = () => {
    if (walk) { setWalk(null); return }
    const spot = freeSpot(plan, rackLayer?.racks ?? [])
    // mirando a lo largo del pasillo (como van las filas), hacia el lado más largo del depósito
    const b = planBounds(plan), alongX = (rackLayer?.racks[0]?.orientation ?? 'x') === 'x'
    const yaw = alongX ? (spot.x < (b.minX + b.maxX) / 2 ? -Math.PI / 2 : Math.PI / 2) : (spot.y < (b.minY + b.maxY) / 2 ? Math.PI : 0)
    setWalk({ ...spot, yaw, pitch: 0 })
    setTool('select')
    setView3d(true)
  }
  // sin depósito todavía no hay nada que ver en 3D: se queda en el plano
  const empty = plan.outline.points.length < 3
  const view3d = want3d && !empty
  const [fit, setFit] = useState(0)
  const fitTick = usePlan((s) => s.fitTick)
  const pallets = (racks ?? []).reduce((n, r) => n + r.structure.pallets.length, 0)
  const [loads, setLoads] = useState<boolean | null>(null)
  // con muchos racks el 3D va en lote y las cajas no pesan: se ven siempre; con pocos racks muy largos, sólo si no son demasiadas
  // viendo un rack solo, los pallets se ven siempre (son pocos)
  const isoOn = !!isolate?.length && !!racks?.some((r) => isolate.includes(r.placement.id))
  const showLoads = loads ?? (isoOn || (racks?.length ?? 0) > 30 || pallets <= MANY_PALLETS)
  const selIds = selectedRackIds(selection)
  useKeys3d(view3d, rackLayer)
  return (
    <section className="plan-stage" aria-label={view3d ? 'Depósito en 3D' : 'Plano del depósito'}>
      <div className="plan-stage__bar">
        {!empty && <Segmented label="Vista" value={view3d ? '3d' : '2d'} onChange={(v) => setView3d(v === '3d')}
          options={[{ value: '2d', label: <><MapIcon size={15} aria-hidden /> Plano</> }, { value: '3d', label: <><Box size={15} aria-hidden /> 3D</> }]} />}
        {!view3d && !empty && <button type="button" className="vp-btn" onClick={() => setFit((n) => n + 1)}><Maximize2 size={14} aria-hidden /> Encuadrar</button>}
        {!empty && <>
          <button type="button" className={`vp-btn${walk && view3d ? ' is-active' : ''}`} aria-pressed={!!walk && view3d} onClick={startWalk} title="Recorrer el depósito a la altura de los ojos de una persona"><Footprints size={14} aria-hidden /> A&nbsp;pie</button>
          <button type="button" className={`vp-btn vp-btn--icon${placing === 'persona' ? ' is-active' : ''}`} aria-pressed={placing === 'persona'} onClick={() => place('persona')} title="Poner una persona para ver la escala" aria-label="Poner una persona para ver la escala"><PersonStanding size={16} aria-hidden /></button>
          <button type="button" className={`vp-btn vp-btn--icon${placing === 'autoelevador' ? ' is-active' : ''}`} aria-pressed={placing === 'autoelevador'} onClick={() => place('autoelevador')} title="Poner un autoelevador para ver la escala" aria-label="Poner un autoelevador para ver la escala"><Forklift size={16} aria-hidden /></button>
        </>}
        {view3d && !walk && (
          <button type="button" className={`vp-btn${lock3d ? '' : ' is-active'}`} aria-pressed={!lock3d} onClick={() => setLock3d(!lock3d)}
            title={lock3d ? 'La edición está bloqueada: nada se mueve al arrastrar. Tocá para poder mover cosas.' : 'Se pueden mover cosas arrastrando. Tocá para bloquear y sólo mirar.'}>
            {lock3d ? <><Lock size={14} aria-hidden /> Bloqueado</> : <><LockOpen size={14} aria-hidden /> Editando</>}
          </button>
        )}
        {view3d && !!racks?.length && (
          <label className="plan-snap plan-stage__loads"><input type="checkbox" checked={showLoads} onChange={(e) => setLoads(e.target.checked)} /> <Package size={14} aria-hidden /> Ver pallets</label>
        )}
        {view3d && selIds.length > 0 && !isoOn && (
          <button type="button" className="vp-btn" onClick={() => setIsolate(selIds)}><Focus size={14} aria-hidden /> Ver solo {selIds.length === 1 ? 'este rack' : `estos ${selIds.length}`}</button>
        )}
        {summary && <div className="plan-stage__summary">{summary}</div>}
      </div>
      <div className="plan-stage__body">
        {view3d
          ? <Suspense fallback={<Spinner />}><Plan3D key={fitTick} plan={plan} racks={racks} showLoads={showLoads} issues={rackLayer?.issues} size={rackLayer?.size} /></Suspense>
          : <PlanEditor fitRequest={fit + fitTick} rackLayer={rackLayer} />}
        {view3d && isoOn && (
          <div className="iso-pill" role="status">
            <span>Viendo solo {isolate!.length === 1 ? 'este rack' : `estos ${isolate!.length} racks`}</span>
            <button type="button" onClick={() => setIsolate(null)}>Ver todos</button>
          </div>
        )}
        {view3d && walk && (
          <div className="walk" role="group" aria-label="Vista a pie">
            <div className="iso-pill walk__pill" role="status">
              <span>Vista a pie · ojos a 1,65 m</span>
              <button type="button" onClick={() => setWalk(null)}>Salir</button>
            </div>
            <div className="walk__pad">
              <button type="button" onClick={() => walkBy(1000, 0)} aria-label="Avanzar" title="Avanzar"><ArrowUp size={18} aria-hidden /></button>
              <button type="button" onClick={() => walkBy(0, Math.PI / 12)} aria-label="Girar a la izquierda" title="Girar a la izquierda"><ArrowLeft size={18} aria-hidden /></button>
              <button type="button" onClick={() => walkBy(-1000, 0)} aria-label="Retroceder" title="Retroceder"><ArrowDown size={18} aria-hidden /></button>
              <button type="button" onClick={() => walkBy(0, -Math.PI / 12)} aria-label="Girar a la derecha" title="Girar a la derecha"><ArrowRight size={18} aria-hidden /></button>
            </div>
            <p className="plan-stage__hint">Arrastrá para mirar · flechas o WASD para caminar · clic en el piso para ir hasta ahí · Esc sale</p>
          </div>
        )}
        {placing && <p className="plan-stage__hint plan-stage__hint--place">Tocá el piso donde va {placing === 'persona' ? 'la persona' : 'el autoelevador'}{view3d ? '' : ' (después miralo en 3D)'} · Esc termina</p>}
        {tool === 'rackpaste' && view3d && <p className="plan-stage__hint plan-stage__hint--place">Tocá el piso donde va la copia · Esc termina</p>}
        {tool === 'object' && view3d && <p className="plan-stage__hint plan-stage__hint--place">Tocá el piso donde va el objeto (podés poner varios) · Esc termina</p>}
        {view3d && !isoOn && !walk && !placing && tool !== 'rackpaste' && tool !== 'object' && (
          <p className="plan-stage__hint">{lock3d ? 'Edición bloqueada: arrastrá para girar la vista · para mover cosas, tocá el candado' : 'Tocá algo para elegirlo y arrastralo para moverlo · arrastrá el fondo para girar'}</p>
        )}
      </div>
    </section>
  )
}

/**
 * Un lugar libre para pararse: el punto más cerca del centro del depósito que queda adentro y a más
 * de 60 cm de cualquier rack (o sea, en un pasillo).
 */
function freeSpot(plan: Plan, racks: RackPlacement[]): { x: number; y: number } {
  const b = planBounds(plan)
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2
  const poly = outlinePolygon(plan.outline, 300)
  const rects = racks.map(placementRect)
  const free = (x: number, y: number) => pointInPolygon({ x, y }, poly) && !rects.some((r) => x > r.x - 600 && x < r.x + r.w + 600 && y > r.y - 600 && y < r.y + r.h + 600)
  const max = Math.max(b.maxX - b.minX, b.maxY - b.minY)
  for (let d = 0; d <= max; d += 500)
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d)
      if (free(x, y)) return { x, y }
    }
  return { x: Math.round(cx), y: Math.round(cy) }
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
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        // copiar los racks elegidos
        const ids = selectedRackIds(s.selection)
        const picked = (layer?.racks ?? []).filter((r) => ids.includes(r.id))
        if (picked.length) { e.preventDefault(); s.setClipRacks(picked) }
      }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { if (s.clipRacks?.length) { e.preventDefault(); s.setTool('rackpaste') } }
      else if (e.key === 'Escape') { if (s.tool === 'object') s.setPlaceObject(null); else if (s.tool !== 'select') s.setTool('select'); else if (!s.selection && s.isolate) s.setIsolate(null); else s.select(null) }
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
      {/* con las piezas a mano, el alto va con los parantes (abajo) */}
      <RackOverrides racks={[r]} defaults={defaults} onlyLevels={!!defaults.config} onChange={(patch) => commit(() => mapRacks(base, [r.id], (q) => ({ ...q, ...patch })))} />
      <div className="rack-editor__actions">
        <button type="button" className="vp-btn" disabled={!pair} title={pair ? undefined : noRoom} onClick={() => apply(pair)}>{r.pair ? 'Hacer simple' : 'Hacer doble'}</button>
        <button type="button" className="vp-btn" disabled={!rotated} title={rotated ? undefined : noRoom} onClick={() => apply(rotated)}><RotateCw size={14} aria-hidden /> Girar</button>
        <button type="button" className="vp-btn" disabled={!dup} title={dup ? undefined : 'No hay lugar al lado para otro rack igual'} onClick={() => { if (dup) { commit(() => dup.plan); select({ kind: 'rack', id: dup.id }) } }}><Copy size={14} aria-hidden /> Duplicar</button>
        <button type="button" className="vp-btn" onClick={() => { commit((p) => removeSelection(p, selection, rackLayer)); select(null) }}><Trash2 size={14} aria-hidden /> Borrar</button>
      </div>
      <SplitRack key={`${r.id}-${r.modules}`} r={r} base={base} size={size} />
      {defaults.config && <RackParts r={r} rackLayer={rackLayer} config={defaults.config} />}
      <p className="muted small">Arrastralo en el plano o en el 3D para moverlo: no entra en zonas libres ni pasillos{plan.rackAreas?.length ? ' y no sale de la zona de racks' : ''}. Supr lo borra, Esc termina.</p>
    </div>
  )
}

/**
 * Partir un rack largo en dos: se elige después de qué módulo. Quedan dos racks seguidos que se
 * mueven y se editan por separado (y se pueden volver a unir eligiendo los dos).
 */
function SplitRack({ r, base, size }: { r: RackPlacement; base: Plan; size: PlanRackLayer['size'] }) {
  const { commit, select } = usePlan()
  const [at, setAt] = useState(Math.ceil(r.modules / 2))
  const [failed, setFailed] = useState(false)
  if (r.modules < 2) return null
  const split = () => {
    const out = splitRack(base, r.id, at, size)
    if (!out) { setFailed(true); return }
    commit(() => out.plan)
    select(rackSelection(out.ids))
  }
  return (
    <details className="plan-more rack-split">
      <summary>Partir este rack en dos</summary>
      <NumberStepper label="Después del módulo" value={at} min={1} max={r.modules - 1} step={1} onChange={(v) => { setAt(v); setFailed(false) }}
        hint={`Quedan dos racks: uno de ${at} y otro de ${r.modules - at} ${r.modules - at === 1 ? 'módulo' : 'módulos'}`} />
      <button type="button" className="vp-btn" onClick={split}><Scissors size={14} aria-hidden /> Partir en dos</button>
      {failed && <p className="rack-editor__issue"><AlertTriangle size={14} aria-hidden /> No entra partido: los dos racks juntos son un poquito más largos (llevan un parante más). Sacale un módulo o corré el rack.</p>}
    </details>
  )
}

/** Altura y niveles del rack elegido para todo el depósito (lo que tiene un rack sin medidas propias). */
export interface RackDefaults { height: number; levels: number; /** El rack de todo el depósito (para editar las piezas de uno). */ config?: RackConfiguration }

/**
 * Altura y niveles propios de uno o varios racks. Si muestran "como el resto", usan los del rack
 * elegido para todo el depósito.
 */
function RackOverrides({ racks, defaults, onChange, onlyLevels }: { racks: RackPlacement[]; defaults: RackDefaults; onChange(patch: Partial<RackPlacement>): void; onlyLevels?: boolean }) {
  const same = <K extends 'levels' | 'height'>(k: K) => (racks.every((r) => r[k] === racks[0][k]) ? racks[0][k] : undefined)
  const levels = same('levels'), height = same('height')
  const own = racks.some((r) => r.levels !== undefined || r.height !== undefined)
  return (
    <div className="rack-editor__fields">
      <NumberStepper label={racks.length > 1 ? 'Niveles (todos los elegidos)' : 'Niveles de este rack'} value={levels ?? defaults.levels} min={1} max={10} step={1}
        onChange={(v) => onChange({ levels: v === defaults.levels ? undefined : v })}
        hint={levels === undefined ? `Como el resto (${defaults.levels})` : `Propio · el resto tiene ${defaults.levels}`} />
      {!onlyLevels && <NumberStepper label={racks.length > 1 ? 'Altura (todos los elegidos)' : 'Altura de este rack'} meters value={height ?? defaults.height} min={2000} max={16_000} step={500} typedStep={10}
        onChange={(v) => onChange({ height: v === defaults.height ? undefined : v })}
        hint={height === undefined ? `Como el resto (${metros(defaults.height)})` : `Propia · el resto tiene ${metros(defaults.height)}`} />}
      {own && !onlyLevels && <button type="button" className="link-btn rack-editor__reset" onClick={() => onChange({ levels: undefined, height: undefined })}>Volver a las medidas de todos</button>}
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
  const joined = joinRacks(base, ids, size)
  const names = rackNames(rackLayer.racks)
  return (
    <div className="plan-sel rack-editor">
      <h2 className="section-label">{racks.length} racks elegidos</h2>
      <h3 className="rack-list__t">Todos juntos</h3>
      <span className="muted small">Shift + clic suma o saca un rack · arrastrá uno para moverlos juntos</span>
      <NumberStepper label="Módulos (todos)" value={modules ?? racks[0].modules} min={1} max={120} step={1}
        onChange={(v) => each((p, id) => setRackModules(p, id, v))} hint={modules === undefined ? 'Ahora tienen distintos módulos' : undefined} />
      <RackOverrides racks={racks} defaults={defaults} onChange={(patch) => commit(() => mapRacks(base, ids, (q) => ({ ...q, ...patch })))} />
      <div className="rack-editor__actions">
        <button type="button" className="vp-btn" onClick={() => each((p, id) => setRackPair(p, id, false))}>Todos simples</button>
        <button type="button" className="vp-btn" onClick={() => each((p, id) => setRackPair(p, id, true))}>Todos dobles</button>
        <button type="button" className="vp-btn" onClick={() => each((p, id) => rotateRack(p, id))}><RotateCw size={14} aria-hidden /> Girar cada uno</button>
        <button type="button" className="vp-btn" onClick={() => { commit(() => removeRacks(base, ids)); select(null) }}><Trash2 size={14} aria-hidden /> Borrar los {racks.length}</button>
        <button type="button" className="vp-btn" disabled={!joined} title={joined ? undefined : 'Para unirlos tienen que estar en la misma fila, uno al lado del otro, y tener la misma altura, niveles y parante'}
          onClick={() => { if (joined) { commit(() => joined.plan); select({ kind: 'rack', id: joined.id }) } }}><Combine size={14} aria-hidden /> Unir en uno</button>
      </div>
      {note && <p className="rack-editor__issue"><AlertTriangle size={14} aria-hidden /> {note}</p>}

      {/* cada uno por separado: tocás uno, se abre y lo cambiás sin tocar a los demás */}
      <h3 className="rack-list__t">Cada uno por separado</h3>
      <ul className="rack-list">
        {racks.map((r) => <RackItem key={r.id} r={r} name={names.get(r.id)} rackLayer={rackLayer} defaults={defaults} ids={ids} />)}
      </ul>
      <button type="button" className="link-btn" onClick={() => select(null)}>Terminar (deseleccionar)</button>
    </div>
  )
}

/** Un rack de la selección, editable por separado (se abre tocándolo). */
function RackItem({ r, name, rackLayer, defaults, ids }: { r: RackPlacement; name?: string; rackLayer: PlanRackLayer; defaults: RackDefaults; ids: string[] }) {
  const { plan, commit, select, layout, focusRack, setFocusRack } = usePlan()
  const open = focusRack === r.id
  const size = rackLayer.size
  const base = freezeRacks(plan, rackLayer.racks)
  const tryEdit = (fn: (p: Plan) => Plan) => { const after = guarded(base, fn(base), r.id, size); return after === base ? null : after }
  const rot = open ? tryEdit((p) => rotateRack(p, r.id)) : null
  const pair = open ? tryEdit((p) => setRackPair(p, r.id, !r.pair)) : null
  const dup = open ? duplicateWithin(base, r.id, layout.aisle, size) : null
  const len = fitPlacement(r, size).length
  return (
    <li className={`rack-list__i${open ? ' is-open' : ''}`}>
      <button type="button" className="rack-list__h" onClick={() => setFocusRack(open ? null : r.id)} aria-expanded={open}>
        {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
        <strong>{name ? `Fila ${name}` : 'Rack'}</strong>
        <span>{r.modules} mód. · {r.pair ? 'doble' : 'simple'} · {metros(len)}{r.levels !== undefined || r.height !== undefined || r.mods || r.frameHeights || r.beamLength || r.beamId || r.uprightId ? ' · medidas propias' : ''}</span>
      </button>
      {open && (
        <div className="rack-list__b">
          <NumberStepper label="Módulos" value={r.modules} min={1} max={120} step={1}
            onChange={(v) => { const next = tryEdit((p) => setRackModules(p, r.id, v)); if (next) commit(() => next) }} />
          <RackOverrides racks={[r]} defaults={defaults} onlyLevels={!!defaults.config} onChange={(patch) => commit(() => mapRacks(base, [r.id], (q) => ({ ...q, ...patch })))} />
          <div className="rack-editor__actions">
            <button type="button" className="vp-btn" disabled={!rot} onClick={() => rot && commit(() => rot)}><RotateCw size={14} aria-hidden /> Girar</button>
            <button type="button" className="vp-btn" disabled={!pair} onClick={() => pair && commit(() => pair)}>{r.pair ? 'Hacer simple' : 'Hacer doble'}</button>
            <button type="button" className="vp-btn" disabled={!dup} onClick={() => { if (dup) { commit(() => dup.plan); select({ kind: 'racks', ids: [...ids, dup.id] }); setFocusRack(dup.id) } }}><Copy size={14} aria-hidden /> Duplicar</button>
            <button type="button" className="vp-btn" onClick={() => { const rest = ids.filter((x) => x !== r.id); select(rest.length === 1 ? { kind: 'rack', id: rest[0] } : { kind: 'racks', ids: rest }); setFocusRack(null) }}>Sacar de la selección</button>
            <button type="button" className="vp-btn" onClick={() => { const rest = ids.filter((x) => x !== r.id); commit(() => removeRacks(base, [r.id])); select(rest.length === 1 ? { kind: 'rack', id: rest[0] } : rest.length ? { kind: 'racks', ids: rest } : null); setFocusRack(null) }}><Trash2 size={14} aria-hidden /> Borrar este</button>
          </div>
          {/* las piezas de este rack (vigas y parantes), igual que con un rack solo */}
          {defaults.config && <RackParts r={r} rackLayer={rackLayer} config={defaults.config} />}
        </div>
      )}
    </li>
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
