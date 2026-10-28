/**
 * Piezas del cotizador que no dependen de la app de gestión: visor 3D con sus cotas,
 * placa "Tu configuración" y advertencias. Las usan la página de la app y el cotizador suelto.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RackStructure, RackWarning } from '../../../shared/rack/types'
import { fmt, plural } from '../../lib/format'
import { useIsMobile } from '../../lib/useMediaQuery'
import { sceneLabels, bindLabel } from '../../three/labels'
import { RackScene } from '../../three/RackScene'
import type { CameraPreset } from '../../three/types'
import { useDesigner } from './designerStore'

const mm = (n: number) => `${fmt(n)} mm`
const kg = (n: number) => `${fmt(n)} kg`

/* ------------------------------ Visor 3D ------------------------------ */

const VIEWS: { id: CameraPreset; label: string }[] = [
  { id: 'front', label: 'Frontal' }, { id: 'side', label: 'Lateral' }, { id: 'top', label: 'Superior' }, { id: 'iso', label: '3D' },
]

export function Viewport({ s }: { s: RackStructure }) {
  const { showDimensions, view, viewRequest, setView, releaseView, toggleDimensions } = useDesigner()
  const labels = useMemo(() => sceneLabels(s, showDimensions, view), [s, showDimensions, view])
  const delta = useStructureDelta(s)
  const isMobile = useIsMobile()
  return (
    <section className="designer__view" aria-label="Vista 3D del rack">
      <RackScene structure={s} showDimensions={showDimensions} view={view} viewRequest={viewRequest} onUserControl={releaseView} />
      <div className="label-layer" aria-hidden="true">
        {labels.map((l) => l.kind === 'dim' ? (
          <div key={l.id} ref={bindLabel(l.id)} className={`dim-label dim-label--${l.spec.tone}`}>
            <span className="dim-label__caption">{l.spec.caption}</span>
            <span className="dim-label__value">{l.spec.value.toLocaleString('es-AR')} mm</span>
          </div>
        ) : <div key={l.id} ref={bindLabel(l.id)} className="warehouse-label">{l.text}</div>)}
      </div>
      <div className="vp-toolbar" role="toolbar" aria-label="Vistas">
        <div className="vp-toolbar__group">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className={`vp-btn${view === v.id ? ' is-active' : ''}`} aria-pressed={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>
          ))}
        </div>
        <div className="vp-toolbar__group">
          <button type="button" className={`vp-btn vp-btn--measure${showDimensions ? ' is-active' : ''}`} aria-pressed={showDimensions} onClick={toggleDimensions}>
            <span className="measure-icon" aria-hidden /> Medidas
          </button>
          <button type="button" className="vp-btn" onClick={() => setView('iso')}>Reiniciar</button>
        </div>
      </div>
      {delta && (
        <div className="delta" key={delta.id} role="status">
          {delta.items.map((d) => <span key={d.text} className={`delta__item${d.sign < 0 ? ' delta__item--minus' : ''}`}>{d.text}</span>)}
        </div>
      )}
      {!isMobile && <p className="vp-hint">Arrastrá para girar · rueda para acercar · clic derecho para mover</p>}
    </section>
  )
}

function useStructureDelta(s: RackStructure) {
  const prev = useRef<RackStructure | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [delta, setDelta] = useState<{ id: number; items: { text: string; sign: number }[] } | null>(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    const p = prev.current
    prev.current = s
    if (!p) return
    const diffs: [number, string, string][] = [
      [s.modules.length - p.modules.length, 'módulo', 'módulos'],
      [s.counts.frames - p.counts.frames, 'bastidor', 'bastidores'],
      [s.storageLevels - p.storageLevels, 'nivel', 'niveles'],
      [s.counts.beams - p.counts.beams, 'viga', 'vigas'],
      [s.positionsAvailable - p.positionsAvailable, 'posición', 'posiciones'],
    ]
    const items = diffs.filter(([n]) => n).map(([n, one, many]) => ({ text: `${n > 0 ? '+' : '−'}${plural(Math.abs(n), one, many)}`, sign: Math.sign(n) }))
    if (!items.length) return
    setDelta({ id: Date.now(), items })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setDelta(null), 3200)
  }, [s])
  return delta
}

/* ------------------------------ Placa de carga ------------------------------ */

export function LoadPlate({ s, compact }: { s: RackStructure; compact?: boolean }) {
  return (
    <div className={`plate${compact ? ' plate--compact' : ''}`}>
      <span className="plate__rivet plate__rivet--tl" aria-hidden /><span className="plate__rivet plate__rivet--tr" aria-hidden />
      <span className="plate__rivet plate__rivet--bl" aria-hidden /><span className="plate__rivet plate__rivet--br" aria-hidden />
      <div className="plate__band"><span>Tu configuración</span><span className="plate__band-sub">Rack selectivo</span></div>
      <div className="plate__grid">
        <div className="plate__figure"><span className="plate__figure-value">{fmt(s.positionsRequested)}</span><span className="plate__figure-label">Posiciones</span></div>
        <div className="plate__figure"><span className="plate__figure-value">{fmt(s.storageLevels)}</span><span className="plate__figure-label">Niveles</span></div>
        <div className="plate__figure"><span className="plate__figure-value">{fmt(s.palletsPerLevel)}</span><span className="plate__figure-label">Pallets por nivel</span></div>
        <div className="plate__figure"><span className="plate__figure-value">{fmt(s.config.palletWeight)}<small> kg</small></span><span className="plate__figure-label">Por pallet</span></div>
      </div>
      <dl className="plate__rows">
        <div className="plate__row"><dt>Altura</dt><dd>{mm(s.config.height)}</dd></div>
        <div className="plate__row"><dt>Ancho total</dt><dd>{mm(s.totalWidth)}</dd></div>
        <div className="plate__row"><dt>Profundidad</dt><dd>{mm(s.totalDepth)}</dd></div>
        <div className="plate__row"><dt>Carga por plano</dt><dd>{kg(s.levelLoad)}</dd></div>
        <div className="plate__row plate__row--strong"><dt>Capacidad total estimada</dt><dd>{kg(s.totalCapacity)}</dd></div>
      </dl>
      <dl className="plate__rows plate__rows--parts">
        <div className="plate__row"><dt>Bastidores</dt><dd>{fmt(s.counts.frames)}</dd></div>
        <div className="plate__row"><dt>Vigas</dt><dd>{fmt(s.counts.beams)}</dd></div>
        <div className="plate__row"><dt>Posiciones disponibles</dt><dd>{fmt(s.positionsAvailable)}</dd></div>
      </dl>
      <div className="plate__foot">{s.upright.name} · {s.beam.name} · Pallet {s.pallet.name}</div>
    </div>
  )
}

const TAG: Record<RackWarning['level'], string> = { validation: 'Validación técnica', warning: 'Atención', info: 'Dato' }

export function Warnings({ warnings }: { warnings: RackWarning[] }) {
  if (!warnings.length) return null
  const order = { validation: 0, warning: 1, info: 2 }
  return (
    <ul className="warnings" aria-live="polite">
      {[...warnings].sort((a, b) => order[a.level] - order[b.level]).map((w) => (
        <li key={w.code} className={`warning warning--${w.level}`}><span className="warning__tag">{TAG[w.level]}</span><span>{w.message}</span></li>
      ))}
    </ul>
  )
}

