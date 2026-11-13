/**
 * PIEZAS DE UN RACK. En el 3D, con el rack visto solo, se toca una viga o un parante y acá se
 * cambia SÓLO esa pieza (marcada en amarillo en los dos lados):
 *  - una viga: su altura (sólo esa viga), y el largo y el perfil de las vigas de su módulo (el
 *    hueco entre dos parantes: las vigas de un mismo hueco miden lo mismo);
 *  - un parante: su alto (nunca más bajo que las vigas que sostiene).
 * Más abajo, plegado, lo que vale para todo el rack (largo, perfiles, alturas, alto y fondo).
 */
import { AlertTriangle, Focus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { placementStructure } from '../../shared/plan/depot'
import { freezeRacks, guarded, mapRacks } from '../../shared/plan/racks'
import type { ModulePieces, RackPlacement } from '../../shared/plan/types'
import { isOwnProfile, profilesOf } from '../../shared/rack/profiles'
import { DESIGN_RULES } from '../../shared/rack/technicalSpecs'
import type { FrameParts, LevelLayout, RackConfiguration } from '../../shared/rack/types'
import { metros } from '../../shared/units'
import { NumberStepper, Switch } from '../components/fields'
import { Field, Select } from '../components/ui'
import type { PlanRackLayer } from './PlanEditor'
import { usePlan } from './planStore'

const L = DESIGN_RULES.limits
const OWN: (keyof RackPlacement)[] = ['beamLength', 'frameDepth', 'beamElevations', 'uprightId', 'beamId', 'height', 'mods', 'frameHeights', 'frameParts']
const GAP = 200

/** Alturas de viga con una cambiada: sin pasar el tope del parante y sin pisar a las vecinas. */
function withBeamAt(elevs: number[], i: number, v: number, height: number): number[] {
  const arr = [...elevs]
  const top = height - DESIGN_RULES.topMargin
  arr[i] = Math.max(50 + i * GAP, Math.min(v, top - (arr.length - 1 - i) * GAP))
  for (let k = i + 1; k < arr.length; k++) arr[k] = Math.max(arr[k], arr[k - 1] + GAP)
  for (let k = i - 1; k >= 0; k--) arr[k] = Math.min(arr[k], arr[k + 1] - GAP)
  return arr
}

/** Saca lo vacío: un módulo sin nada propio deja de estar en la lista. */
function cleanMods(mods: Record<number, ModulePieces>): Record<number, ModulePieces> | undefined {
  const out: Record<number, ModulePieces> = {}
  for (const [k, v] of Object.entries(mods)) {
    const o = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as ModulePieces
    if (Object.keys(o).length) out[Number(k)] = o
  }
  return Object.keys(out).length ? out : undefined
}

const freeHint = (lv: LevelLayout | undefined) => !lv || !Number.isFinite(lv.clearHeight) ? undefined
  : lv.loadHeight < DESIGN_RULES.minLoadHeight ? `⚠ Libre hasta la de arriba: ${metros(lv.clearHeight)}: no entra un pallet`
  : `Libre hasta la de arriba: ${metros(lv.clearHeight)}`

export function RackParts({ r, rackLayer, config }: { r: RackPlacement; rackLayer: PlanRackLayer; config: RackConfiguration }) {
  const { plan, commit, piece, setPiece, isolate, setIsolate, view3d, setView3d } = usePlan()
  const [note, setNote] = useState<string | null>(null)
  const s = useMemo(() => placementStructure(config, r), [config, r])
  const mine = piece?.rack === r.id ? piece : null
  const all = profilesOf(config)
  const pickedKey = mine ? (mine.kind === 'beam' ? `b${mine.module}-${mine.plane}` : `u${mine.frame}`) : ''
  // al tocar una pieza en el 3D, su lugar en el panel queda a la vista
  useEffect(() => {
    if (!pickedKey) return
    requestAnimationFrame(() => document.querySelector('.rack-part.is-picked')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }, [pickedKey])

  const base = freezeRacks(plan, rackLayer.racks)
  /** Cambia piezas de este rack; si con la medida nueva no entra donde está, no se aplica y se avisa. */
  const set = (patch: Partial<RackPlacement>) => {
    const after = guarded(base, mapRacks(base, [r.id], (q) => ({ ...q, ...patch })), r.id, rackLayer.size)
    if (after === base) { setNote('Con esa medida el rack no entra donde está: pisaría una zona libre, un pasillo o saldría de la zona de racks.'); return }
    commit(() => after)
    setNote(null)
  }
  const setMod = (m: number, patch: Partial<ModulePieces>) => set({ mods: cleanMods({ ...r.mods, [m]: { ...r.mods?.[m], ...patch } }) })
  const setFrame = (f: number, h: number | undefined) => {
    const next = { ...r.frameHeights, [f]: h }
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as Record<number, number>
    set({ frameHeights: Object.keys(clean).length ? clean : undefined })
  }

  /** Cambia las riendas o las bases de un pórtico (lo que queda como "lo de siempre" no se guarda). */
  const setFrameParts = (f: number, patch: Partial<FrameParts>) => {
    const one = Object.fromEntries(Object.entries({ ...r.frameParts?.[f], ...patch }).filter(([, v]) => v !== undefined)) as FrameParts
    const next = { ...r.frameParts }
    if (Object.keys(one).length) next[f] = one; else delete next[f]
    set({ frameParts: Object.keys(next).length ? next : undefined })
  }

  const width = r.beamLength ?? config.width, depth = r.frameDepth ?? config.depth, height = r.height ?? config.height
  const row = s.rows[0]
  // módulo "como el resto" (sin vigas propias) para las alturas de todo el rack
  const plainMod = row?.modules.find((mod) => !r.mods?.[mod.key]) ?? row?.modules[0]
  const levels = plainMod?.levels ?? []
  const beams = levels.filter((l) => l.hasBeam)
  const ownElev = !!r.beamElevations && r.beamElevations.length === beams.length
  const own = OWN.some((k) => r[k] !== undefined)
  const changed = Object.keys(r.mods ?? {}).length + new Set([...Object.keys(r.frameHeights ?? {}), ...Object.keys(r.frameParts ?? {})]).size
  const inIso = view3d && !!isolate?.includes(r.id)
  const profileHint = (id: string | undefined, name: string) => (id === undefined ? `Como el resto · ahora ${name}` : id === 'auto' ? `Automático · ahora ${name}` : 'Propio')

  // la pieza tocada
  let pickedCard = null
  if (mine?.kind === 'beam' && row) {
    const mod = row.modules.find((x) => x.key === mine.module)
    const mbeams = mod?.levels.filter((l) => l.hasBeam) ?? []
    if (mod) {
      const m = mine.module, o = r.mods?.[m]
      const elevs = mbeams.map((x) => x.elevation)
      pickedCard = (
        <section className="rack-part is-picked" aria-label="Módulo elegido">
          <h4>Módulo {m + 1} de {r.modules}</h4>
          <p className="rack-part__sub">Sus vigas, de abajo hacia arriba</p>
          {mbeams.map((b, i) => (
            <div key={b.index} className={`rack-part__row rack-part__beam${mine.plane === i ? ' is-picked' : ''}`}
              onFocusCapture={() => { if (mine.plane !== i) setPiece({ rack: r.id, kind: 'beam', module: m, plane: i }) }}>
              <NumberStepper label={`Viga ${i + 1}${i === mbeams.length - 1 ? ' (la de arriba)' : ''}`} meters value={b.elevation} min={50} max={mod.height} step={50} typedStep={50}
                onChange={(v) => setMod(m, { beamElevations: withBeamAt(elevs, i, v, mod.height) })} hint={freeHint(mod.levels[b.index])} />
              {/* sacar sólo esta viga (por ejemplo, la de abajo para que pase el autoelevador) */}
              <button type="button" className="rack-part__x" disabled={mbeams.length <= 1} aria-label={`Sacar la viga ${i + 1} de este módulo`}
                title={mbeams.length <= 1 ? 'Es la última viga de este módulo: para dejar el hueco entero, partí el rack' : 'Sacar esta viga (y los pallets que apoyan en ella)'}
                onClick={() => { setMod(m, { beamElevations: elevs.filter((_, k) => k !== i) }); setPiece({ rack: r.id, kind: 'beam', module: m, plane: -1 }) }}>
                <Trash2 size={15} aria-hidden />
              </button>
            </div>
          ))}
          {config.floorStorage && (
            <Switch label="Paso libre abajo" checked={!!o?.noFloor} onChange={(v) => setMod(m, { noFloor: v || undefined })}
              hint="Sin pallets en el piso de este módulo, para que pase el autoelevador." />
          )}
          <NumberStepper label="Largo de las vigas de este módulo" meters value={mod.width} min={L.width.min} max={L.width.max} step={100} typedStep={10}
            onChange={(v) => setMod(m, { width: v === width ? undefined : v })}
            hint={o?.width ? 'Propio de este módulo' : `Como el resto (${metros(width)})`} />
          <Field label="Perfil de las vigas de este módulo" hint={o?.beamId ? 'Propio de este módulo' : `Como el resto · ahora ${mod.beam.name}`}>{(id) => (
            <Select id={id} value={o?.beamId ?? ''} onChange={(e) => setMod(m, { beamId: e.target.value || undefined })}>
              <option value="">Como el resto</option>
              {all.beams.map((p) => <option key={p.id} value={p.id}>{p.name}{isOwnProfile(config, p.id) ? ' (mía)' : ''}</option>)}
            </Select>
          )}</Field>
          {o && <button type="button" className="link-btn" onClick={() => setMod(m, { width: undefined, beamId: undefined, beamElevations: undefined, noFloor: undefined })}>Dejar este módulo como el resto</button>}
        </section>
      )
    }
  } else if (mine?.kind === 'upright' && row) {
    const f = row.frames.find((x) => x.key === mine.frame)
    if (f) {
      const k = mine.frame, ownH = r.frameHeights?.[k], op = r.frameParts?.[k]
      const bases = (f.bases[0] ? 1 : 0) + (f.bases[1] ? 1 : 0)
      pickedCard = (
        <section className="rack-part is-picked" aria-label="Pórtico elegido">
          <h4>Pórtico {k + 1} de {r.modules + 1}</h4>
          <p className="rack-part__sum">2 columnas · {bases === 1 ? '1 base' : `${bases} bases`} · {f.diagonals + f.horizontals} riendas</p>
          <NumberStepper label="Alto de las columnas" meters value={f.height} min={L.height.min} max={L.height.max} step={100} typedStep={10}
            onChange={(v) => setFrame(k, v)}
            hint={ownH ? 'Propio · no puede quedar más bajo que las vigas que sostiene' : `Como el resto (${metros(height)})`} />
          <div className="plan-xy">
            <NumberStepper label="Riendas diagonales" value={f.diagonals} min={0} max={60} step={1} onChange={(v) => setFrameParts(k, { diagonals: v })}
              hint={op?.diagonals === undefined ? 'Las de siempre' : 'Propias'} />
            <NumberStepper label="Riendas horizontales" value={f.horizontals} min={0} max={20} step={1} onChange={(v) => setFrameParts(k, { horizontals: v })}
              hint={op?.horizontals === undefined ? 'Las de siempre' : 'Propias'} />
          </div>
          <Switch label="Base de adelante" checked={f.bases[0]} onChange={(v) => setFrameParts(k, { noBaseFront: v ? undefined : true })} hint="La de la columna del lado del pasillo." />
          <Switch label="Base de atrás" checked={f.bases[1]} onChange={(v) => setFrameParts(k, { noBaseBack: v ? undefined : true })} />
          {(ownH !== undefined || op) && <button type="button" className="link-btn" onClick={() => { const fh = { ...r.frameHeights }, fp = { ...r.frameParts }; delete fh[k]; delete fp[k]; set({ frameHeights: Object.keys(fh).length ? fh : undefined, frameParts: Object.keys(fp).length ? fp : undefined }) }}>Dejar este pórtico como el resto</button>}
          <p className="muted small">El fondo y el perfil de las columnas son iguales en todo el rack: se cambian abajo, en "Todo este rack".</p>
        </section>
      )
    }
  }

  return (
    <div className="rack-parts">
      <h3 className="rack-list__t">Piezas de este rack</h3>
      {inIso
        ? !pickedCard && <p className="muted small">Tocá una viga o un parante en el 3D: se marca en amarillo y acá cambiás sólo esa pieza.</p>
        : <button type="button" className="vp-btn rack-parts__go" onClick={() => { setIsolate([r.id]); setView3d(true) }}>
            <Focus size={14} aria-hidden /> Verlo solo en 3D y tocar sus piezas
          </button>}
      {/* elegir un módulo del rack (sin ir al 3D) para cambiarle o sacarle vigas */}
      <div className="mod-chips" role="group" aria-label="Módulos de este rack">
        <span>Módulo</span>
        {Array.from({ length: r.modules }, (_, m) => {
          const on = mine?.kind === 'beam' && mine.module === m
          return (
            <button key={m} type="button" className={`mod-chip${on ? ' is-on' : ''}${r.mods?.[m] ? ' is-own' : ''}`} aria-pressed={on}
              title={r.mods?.[m] ? `Módulo ${m + 1} (con cambios propios)` : `Módulo ${m + 1}`}
              onClick={() => setPiece(on ? null : { rack: r.id, kind: 'beam', module: m, plane: -1 })}>{m + 1}</button>
          )
        })}
      </div>
      {/* elegir un pórtico (dos columnas con sus bases y sus riendas) */}
      <div className="mod-chips" role="group" aria-label="Pórticos de este rack">
        <span>Pórtico</span>
        {Array.from({ length: r.modules + 1 }, (_, f) => {
          const on = mine?.kind === 'upright' && mine.frame === f
          const own = r.frameHeights?.[f] !== undefined || !!r.frameParts?.[f]
          return (
            <button key={f} type="button" className={`mod-chip${on ? ' is-on' : ''}${own ? ' is-own' : ''}`} aria-pressed={on}
              title={own ? `Pórtico ${f + 1} (con cambios propios)` : `Pórtico ${f + 1}`}
              onClick={() => setPiece(on ? null : { rack: r.id, kind: 'upright', frame: f })}>{f + 1}</button>
          )
        })}
      </div>
      {!pickedCard && <p className="muted small">Elegí un módulo para cambiarle o sacarle vigas, o un pórtico para cambiarle las riendas o las bases.</p>}
      {pickedCard}
      {note && <p className="rack-editor__issue"><AlertTriangle size={14} aria-hidden /> {note}</p>}
      {changed > 0 && <p className="muted small">{changed === 1 ? 'Una pieza tiene' : `${changed} piezas tienen`} medidas propias.</p>}

      <details className="plan-more rack-parts__all">
        <summary>Todo este rack</summary>
        <section className="rack-part" aria-label="Vigas de todo el rack">
          <h4>Vigas (todas)</h4>
          <NumberStepper label="Largo de viga" meters value={width} min={L.width.min} max={L.width.max} step={100} typedStep={10}
            onChange={(v) => set({ beamLength: v === config.width ? undefined : v })}
            hint={r.beamLength === undefined ? `Como el resto del depósito (${metros(config.width)})` : `Propio · el depósito tiene ${metros(config.width)}`} />
          <Field label="Perfil de viga" hint={profileHint(r.beamId, s.beam.name)}>{(id) => (
            <Select id={id} value={r.beamId ?? ''} onChange={(e) => set({ beamId: e.target.value || undefined })}>
              <option value="">Como el resto</option>
              <option value="auto">Automática (la más liviana que alcanza)</option>
              {all.beams.map((b) => <option key={b.id} value={b.id}>{b.name}{isOwnProfile(config, b.id) ? ' (mía)' : ''}</option>)}
            </Select>
          )}</Field>
          <p className="rack-part__sub">Altura de cada viga (desde el piso)</p>
          {beams.map((b, i) => (
            <NumberStepper key={b.index} label={`Viga ${i + 1}${i === beams.length - 1 ? ' (la de arriba)' : ''}`} meters value={b.elevation} min={50} max={height} step={50} typedStep={50}
              onChange={(v) => set({ beamElevations: withBeamAt(beams.map((x) => x.elevation), i, v, height) })} hint={freeHint(levels[b.index])} />
          ))}
          {ownElev && <button type="button" className="link-btn" onClick={() => set({ beamElevations: undefined })}>Repartir las vigas parejas</button>}
        </section>
        <section className="rack-part" aria-label="Parantes de todo el rack">
          <h4>Parantes (todos)</h4>
          <NumberStepper label="Alto de los parantes" meters value={height} min={L.height.min} max={L.height.max} step={500} typedStep={10}
            onChange={(v) => set({ height: v === config.height ? undefined : v })}
            hint={r.height === undefined ? `Como el resto (${metros(config.height)})` : `Propio · el resto tiene ${metros(config.height)}`} />
          <NumberStepper label="Fondo del bastidor" meters value={depth} min={L.depth.min} max={L.depth.max} step={50} typedStep={10}
            onChange={(v) => set({ frameDepth: v === config.depth ? undefined : v })}
            hint={r.frameDepth === undefined ? `Como el resto (${metros(config.depth)})` : `Propio · el resto tiene ${metros(config.depth)}`} />
          <Field label="Perfil del parante" hint={profileHint(r.uprightId, s.upright.name)}>{(id) => (
            <Select id={id} value={r.uprightId ?? ''} onChange={(e) => set({ uprightId: e.target.value || undefined })}>
              <option value="">Como el resto</option>
              <option value="auto">Automático (el más liviano que alcanza)</option>
              {all.uprights.map((u) => <option key={u.id} value={u.id}>{u.name}{isOwnProfile(config, u.id) ? ' (mío)' : ''}</option>)}
            </Select>
          )}</Field>
        </section>
        <button type="button" className="link-btn" onClick={() => usePlan.getState().setSection('piezas')}>Crear mis propias piezas…</button>
      </details>

      {own && <button type="button" className="link-btn rack-editor__reset"
        onClick={() => { set({ beamLength: undefined, frameDepth: undefined, beamElevations: undefined, uprightId: undefined, beamId: undefined, height: undefined, mods: undefined, frameHeights: undefined, frameParts: undefined }); setPiece(null) }}>
        Volver todas las piezas a como el resto</button>}
    </div>
  )
}
