/**
 * PIEZAS DE UN RACK, por tipo (como se fabrica un rack real): las vigas (largueros) con su largo,
 * su perfil y la altura de cada una, y los parantes (bastidores) con su alto, su fondo y su perfil.
 * Valen sólo para este rack. En el 3D, con el rack visto solo, se toca una viga o un parante y acá
 * se abre esa pieza (marcada en amarillo en los dos lados).
 */
import { AlertTriangle, Focus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { placementStructure } from '../../shared/plan/depot'
import { freezeRacks, guarded, mapRacks } from '../../shared/plan/racks'
import type { RackPlacement } from '../../shared/plan/types'
import { BEAM_PROFILES, DESIGN_RULES, UPRIGHT_PROFILES } from '../../shared/rack/technicalSpecs'
import type { RackConfiguration } from '../../shared/rack/types'
import { metros } from '../../shared/units'
import { NumberStepper } from '../components/fields'
import { Field, Select } from '../components/ui'
import type { PlanRackLayer } from './PlanEditor'
import { usePlan } from './planStore'

const L = DESIGN_RULES.limits
const OWN: (keyof RackPlacement)[] = ['beamLength', 'frameDepth', 'beamElevations', 'uprightId', 'beamId', 'height']

export function RackParts({ r, rackLayer, config }: { r: RackPlacement; rackLayer: PlanRackLayer; config: RackConfiguration }) {
  const { plan, commit, piece, setPiece, isolate, setIsolate, view3d, setView3d } = usePlan()
  const [note, setNote] = useState<string | null>(null)
  const s = useMemo(() => placementStructure(config, r), [config, r])
  const mine = piece?.rack === r.id ? piece : null
  const pickedKey = mine ? (mine.kind === 'beam' ? `b${mine.plane}` : 'u') : ''
  // al tocar una pieza en el 3D, su lugar en el panel queda a la vista
  useEffect(() => {
    if (!pickedKey) return
    requestAnimationFrame(() => (document.querySelector('.rack-part__row.is-picked') ?? document.querySelector('.rack-part.is-picked'))?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }, [pickedKey])

  const base = freezeRacks(plan, rackLayer.racks)
  /** Cambia piezas de este rack; si con la medida nueva no entra donde está, no se aplica y se avisa. */
  const set = (patch: Partial<RackPlacement>) => {
    const after = guarded(base, mapRacks(base, [r.id], (q) => ({ ...q, ...patch })), r.id, rackLayer.size)
    if (after === base) { setNote('Con esa medida el rack no entra donde está: pisaría una zona libre, un pasillo o saldría de la zona de racks.'); return }
    commit(() => after)
    setNote(null)
  }

  const levels = s.rows[0]?.modules[0]?.levels ?? []
  const beams = levels.filter((l) => l.hasBeam)
  const ownElev = !!r.beamElevations && r.beamElevations.length === beams.length
  const setAt = (i: number, v: number) => {
    const arr = beams.map((b) => b.elevation)
    // ni por encima del parante ni pisando a las de abajo: las demás se corren lo justo
    const top = height - DESIGN_RULES.topMargin
    arr[i] = Math.max(50 + i * 200, Math.min(v, top - (arr.length - 1 - i) * 200))
    for (let k = i + 1; k < arr.length; k++) arr[k] = Math.max(arr[k], arr[k - 1] + 200)
    for (let k = i - 1; k >= 0; k--) arr[k] = Math.min(arr[k], arr[k + 1] - 200)
    set({ beamElevations: arr })
  }
  const width = r.beamLength ?? config.width, depth = r.frameDepth ?? config.depth, height = r.height ?? config.height
  const own = OWN.some((k) => r[k] !== undefined)
  const inIso = view3d && !!isolate?.includes(r.id)
  const beamPicked = mine?.kind === 'beam', upPicked = mine?.kind === 'upright'
  const profileHint = (id: string | undefined, name: string) => (id === undefined ? `Como el resto · ahora ${name}` : id === 'auto' ? `Automático · ahora ${name}` : 'Propio de este rack')

  return (
    <div className="rack-parts">
      <h3 className="rack-list__t">Piezas de este rack</h3>
      {inIso
        ? <p className="muted small">Tocá una viga o un parante en el 3D: se marca en amarillo y lo cambiás acá.</p>
        : <button type="button" className="vp-btn rack-parts__go" onClick={() => { setIsolate([r.id]); setView3d(true) }}>
            <Focus size={14} aria-hidden /> Verlo solo en 3D y tocar sus piezas
          </button>}

      <section className={`rack-part${beamPicked ? ' is-picked' : ''}`} aria-label="Vigas">
        <h4>Vigas (largueros)</h4>
        <NumberStepper label="Largo de viga" meters value={width} min={L.width.min} max={L.width.max} step={100} typedStep={10}
          onChange={(v) => set({ beamLength: v === config.width ? undefined : v })}
          hint={r.beamLength === undefined ? `Como el resto (${metros(config.width)})` : `Propio · el resto tiene ${metros(config.width)}`} />
        <Field label="Perfil de viga" hint={profileHint(r.beamId, s.beam.name)}>{(id) => (
          <Select id={id} value={r.beamId ?? ''} onChange={(e) => set({ beamId: e.target.value || undefined })}>
            <option value="">Como el resto</option>
            <option value="auto">Automática (la más liviana que alcanza)</option>
            {BEAM_PROFILES.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}</Field>
        <p className="rack-part__sub">Altura de cada viga (desde el piso)</p>
        {beams.map((b, i) => {
          const lv = levels[b.index]
          const on = beamPicked && mine.plane === i
          return (
            <div key={b.index} className={`rack-part__row${on ? ' is-picked' : ''}`} onFocusCapture={() => setPiece({ rack: r.id, kind: 'beam', plane: i })}>
              <NumberStepper label={`Viga ${i + 1}${i === beams.length - 1 ? ' (la de arriba)' : ''}`} meters value={b.elevation} min={50} max={height} step={50} typedStep={50}
                onChange={(v) => setAt(i, v)}
                hint={!Number.isFinite(lv.clearHeight) ? undefined
                  : lv.loadHeight < DESIGN_RULES.minLoadHeight ? `⚠ Libre hasta la de arriba: ${metros(lv.clearHeight)}: no entra un pallet`
                  : `Libre hasta la de arriba: ${metros(lv.clearHeight)}`} />
            </div>
          )
        })}
        {ownElev && <button type="button" className="link-btn" onClick={() => set({ beamElevations: undefined })}>Repartir las vigas parejas</button>}
      </section>

      <section className={`rack-part${upPicked ? ' is-picked' : ''}`} aria-label="Parantes" onFocusCapture={() => setPiece({ rack: r.id, kind: 'upright' })}>
        <h4>Parantes (bastidores)</h4>
        <NumberStepper label="Alto del parante" meters value={height} min={L.height.min} max={L.height.max} step={500} typedStep={10}
          onChange={(v) => set({ height: v === config.height ? undefined : v })}
          hint={r.height === undefined ? `Como el resto (${metros(config.height)})` : `Propio · el resto tiene ${metros(config.height)}`} />
        <NumberStepper label="Fondo del bastidor" meters value={depth} min={L.depth.min} max={L.depth.max} step={50} typedStep={10}
          onChange={(v) => set({ frameDepth: v === config.depth ? undefined : v })}
          hint={r.frameDepth === undefined ? `Como el resto (${metros(config.depth)})` : `Propio · el resto tiene ${metros(config.depth)}`} />
        <Field label="Perfil del parante" hint={profileHint(r.uprightId, s.upright.name)}>{(id) => (
          <Select id={id} value={r.uprightId ?? ''} onChange={(e) => set({ uprightId: e.target.value || undefined })}>
            <option value="">Como el resto</option>
            <option value="auto">Automático (el más liviano que alcanza)</option>
            {UPRIGHT_PROFILES.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}</Field>
      </section>

      {note && <p className="rack-editor__issue"><AlertTriangle size={14} aria-hidden /> {note}</p>}
      {own && <button type="button" className="link-btn rack-editor__reset"
        onClick={() => set({ beamLength: undefined, frameDepth: undefined, beamElevations: undefined, uprightId: undefined, beamId: undefined, height: undefined })}>
        Volver a las piezas de todos</button>}
    </div>
  )
}
