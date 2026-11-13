/**
 * MIS PIEZAS: la sección donde se crean los tipos de viga y de parante propios (el catálogo de la
 * empresa). A la izquierda la lista, en el medio todas las medidas de la pieza elegida y a la
 * derecha cómo queda: el corte con sus medidas y un rack de muestra en 3D armado con esa pieza.
 * Desde acá la pieza se mete en todos los racks o sólo en los racks elegidos en el plano.
 * Las piezas se guardan con el rack y no se borran al empezar de nuevo.
 */
import { ArrowLeft, Copy, Lock, MousePointerClick, PenTool, Plus, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { sanitizeObjectShape } from '../shared/plan/edit'
import { selectedRackIds } from '../shared/plan/racks'
import type { ObjectShape } from '../shared/plan/types'
import { calculateRackStructure } from '../shared/rack/calculateRackStructure'
import { beamName, PIECE_LIMITS as P, uprightName } from '../shared/rack/profiles'
import { presetShape, sectionSize, shapeFromDxf, type SectionShape } from '../shared/rack/section'
import { BEAM_PROFILES, UPRIGHT_PROFILES } from '../shared/rack/technicalSpecs'
import type { BeamProfile, ObjectType, UprightProfile } from '../shared/rack/types'
import { metros } from '../shared/units'
import { NumberStepper } from '../web/components/fields'
import { useToast } from '../web/components/overlays'
import { Button, Field, Input, Segmented } from '../web/components/ui'
import { fmt } from '../web/lib/format'
import { Warnings } from '../web/pages/designer/CotizadorView'
import { useDesigner } from '../web/pages/designer/designerStore'
import { ObjectFields } from '../web/plan/PlanPanel'
import { usePlan } from '../web/plan/planStore'
import { RackScene } from '../web/three/RackScene'
import { Object3D, Piece3D } from './Piece3D'
import { RackPicker } from './RackPicker'
import { SectionEditor } from './SectionEditor'

type Kind = 'beam' | 'upright' | 'object'
const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 7)}`
const kg = (n: number) => `${fmt(n)} kg`
const topCapacity = (b: BeamProfile) => Math.max(...b.capacityBySpan.map((c) => c.capacity))

export function PiecesSection() {
  const { config, update } = useDesigner()
  const toast = useToast()
  const { setSection, selection } = usePlan()
  const own = useMemo(() => ({ uprights: config.customProfiles?.uprights ?? [], beams: config.customProfiles?.beams ?? [], objects: config.customProfiles?.objects ?? [] }), [config.customProfiles])
  const [sel, setSel] = useState<{ kind: Kind; id: string } | null>(() => (own.beams[0] ? { kind: 'beam', id: own.beams[0].id } : own.uprights[0] ? { kind: 'upright', id: own.uprights[0].id } : null))
  const save = (next: typeof own, extra: Partial<typeof config> = {}) => update({ customProfiles: next, ...extra })
  // qué se ve en 3D: la pieza sola (para girarla y mirarla) o un rack armado con ella
  const [view3d, setView3d] = useState<'pieza' | 'rack'>('pieza')
  const dxf = useRef<HTMLInputElement>(null)

  const beam = sel?.kind === 'beam' ? own.beams.find((b) => b.id === sel.id) ?? BEAM_PROFILES.find((b) => b.id === sel.id) : undefined
  const upright = sel?.kind === 'upright' ? own.uprights.find((u) => u.id === sel.id) ?? UPRIGHT_PROFILES.find((u) => u.id === sel.id) : undefined
  const obj = sel?.kind === 'object' ? own.objects.find((o) => o.id === sel.id) : undefined
  const locked = !!sel && sel.kind !== 'object' && !own.beams.some((b) => b.id === sel.id) && !own.uprights.some((u) => u.id === sel.id)
  // objetos propios: cajas y cilindros con nombre, para poner donde se quiera en el depósito
  const setObj = (id: string, patch: Partial<ObjectShape>) => save({ ...own, objects: own.objects.map((o) => (o.id === id ? { ...o, ...sanitizeObjectShape({ ...o, ...patch }), name: patch.name ?? o.name } : o)) })
  const addObj = (from?: ObjectType) => {
    const o: ObjectType = from ? { ...from, id: newId('mo-'), name: `${from.name} (copia)` } : { id: newId('mo-'), name: `Objeto ${own.objects.length + 1}`, shape: 'caja', w: 1000, d: 1000, h: 1000, color: '#8f969d' }
    save({ ...own, objects: [...own.objects, o] })
    setSel({ kind: 'object', id: o.id })
  }
  const placedCount = usePlan((s) => (obj ? (s.plan.objects ?? []).filter((x) => x.typeId === obj.id).length : 0))
  const hasDepot = usePlan((s) => s.plan.outline.points.length >= 3)
  /** Pasa al depósito con el objeto en la mano: se pone con un clic donde se quiera (varias veces). */
  const placeObj = () => {
    if (!obj) return
    if (!hasDepot) { toast.error('Primero dibujá el depósito (en la sección Depósito), y después ponés el objeto.'); return }
    const st = usePlan.getState()
    if (st.flowStep === 'rack' || st.flowStep === 'carga') st.setFlowStep('distribucion')
    st.setWalk(null)
    st.setPlaceObject(obj)
    setSection('deposito')
  }

  const setBeam = (id: string, patch: Partial<BeamProfile>) => save({
    ...own, beams: own.beams.map((b) => {
      if (b.id !== id) return b
      const next = { ...b, ...patch }
      // la tabla de largos va siempre del más corto al más largo
      if (patch.capacityBySpan) next.capacityBySpan = [...patch.capacityBySpan].sort((x, y) => x.maxSpan - y.maxSpan)
      // el nombre sigue a las medidas mientras no se le haya puesto uno propio
      if (!('name' in patch) && b.name === beamName(b)) next.name = beamName(next)
      return next
    }),
  })
  const setUpright = (id: string, patch: Partial<UprightProfile>) => save({
    ...own, uprights: own.uprights.map((u) => {
      if (u.id !== id) return u
      const next = { ...u, ...patch }
      if (!('name' in patch) && u.name === uprightName(u)) next.name = uprightName(next)
      return next
    }),
  })
  const addBeam = (from?: BeamProfile) => {
    const b: BeamProfile = from
      ? { ...from, id: newId('mv-'), name: `${from.name} (copia)`, capacityBySpan: from.capacityBySpan.map((c) => ({ ...c })) }
      : { id: newId('mv-'), name: '', height: 110, depth: 50, capacityBySpan: [{ maxSpan: 2700, capacity: 3200 }, { maxSpan: P.beamSpan.max, capacity: 2400 }] }
    if (!b.name) b.name = beamName(b)
    save({ ...own, beams: [...own.beams, b] })
    setSel({ kind: 'beam', id: b.id })
  }
  const addUpright = (from?: UprightProfile) => {
    const u: UprightProfile = from ? { ...from, id: newId('mp-'), name: `${from.name} (copia)` } : { id: newId('mp-'), name: '', faceWidth: 90, depth: 75, thickness: 2.5, maxFrameLoad: 12_000 }
    if (!u.name) u.name = uprightName(u)
    save({ ...own, uprights: [...own.uprights, u] })
    setSel({ kind: 'upright', id: u.id })
  }
  // la forma (el corte dibujado con puntos): las medidas de la pieza salen del dibujo
  const setShape = (shape: SectionShape | undefined) => {
    if (!sel || locked) return
    const size = shape && sectionSize(shape)
    if (sel.kind === 'beam') setBeam(sel.id, size ? { shape, height: size.h, depth: size.w } : { shape: undefined })
    else setUpright(sel.id, size && shape ? { shape, faceWidth: size.w, depth: size.h, thickness: shape.thickness } : { shape: undefined })
  }
  /** Empieza a dibujar desde la forma de siempre: la caja de la viga o la C del parante, con sus medidas. */
  const startShape = () => {
    if (beam) setShape(presetShape('caja', beam.depth - 2, beam.height - 2, 2))
    else if (upright) setShape(presetShape('c', upright.faceWidth - upright.thickness, upright.depth - upright.thickness, upright.thickness))
  }
  const loadDxf = async (f: File | undefined) => {
    if (!f) return
    const s = shapeFromDxf(await f.text())
    if (s) { setShape(s); toast.ok('Dibujo cargado. Ajustá el tamaño en "Medida total".') }
    else toast.error('No encontré ningún dibujo en ese archivo. Guardalo como DXF con el corte dibujado con líneas o una polilínea.')
  }
  const shape = (beam ?? upright)?.shape

  // al borrar una pieza que se usaba en todos los racks, se vuelve a la elección automática
  const remove = () => {
    if (!sel || locked) return
    if (sel.kind === 'object') save({ ...own, objects: own.objects.filter((o) => o.id !== sel.id) })
    else if (sel.kind === 'beam') save({ ...own, beams: own.beams.filter((b) => b.id !== sel.id) }, config.beamId === sel.id ? { beamId: 'auto' } : {})
    else save({ ...own, uprights: own.uprights.filter((u) => u.id !== sel.id) }, config.uprightId === sel.id ? { uprightId: 'auto' } : {})
    setSel(null)
  }

  // meter la pieza en los racks
  const key = sel?.kind === 'beam' ? 'beamId' : 'uprightId'
  const usedByAll = !!sel && config[key] === sel.id
  const rackIds = selectedRackIds(selection)
  const useInAll = () => { if (sel) { update({ [key]: sel.id }); toast.ok('Listo: todos los racks usan esta pieza.') } }
  // elegir los racks en un plano chico (vienen marcados los que ya la usan y los elegidos en el plano)
  const [picking, setPicking] = useState(false)
  const usedBy = usePlan((s) => (sel ? (s.plan.racks ?? []).filter((r) => r[key] === sel.id).length : 0))

  // un rack de muestra (2 módulos) armado con la pieza elegida
  const sample = useMemo(() => {
    if (!sel) return null
    const base = calculateRackStructure({ ...config, sections: [], positions: 1, layout: { ...config.layout, rows: 1, backToBack: false } })
    return calculateRackStructure({
      ...base.config, sections: [], positions: base.palletsPerModule * base.storageLevels * 2,
      layout: { ...base.config.layout, rows: 1, backToBack: false }, [key]: sel.id,
    })
  }, [config, sel, key])

  // la vista 3D (va al lado del dibujo de la forma)
  const view3dBlock = sample && (
    <div className="pieces__3dwrap">
      <div className="pieces__3d-bar">
        <Segmented label="Qué se ve en 3D" value={view3d} onChange={setView3d} options={[{ value: 'pieza', label: 'La pieza sola' }, { value: 'rack', label: 'En un rack' }]} />
      </div>
      <div className="pieces__3d">
        {view3d === 'pieza' ? <Piece3D beam={beam} upright={upright} /> : <RackScene structure={sample} />}
        <span className="pieces__3d-t">{view3d === 'pieza' ? 'Un tramo de 1 m · arrastrá para girarlo' : `Rack de muestra · ${metros(sample.config.width)} de viga, ${metros(sample.config.height)} de alto`}</span>
      </div>
    </div>
  )

  const item = (kind: Kind, id: string, name: string, info: string, factory = false) => (
    <li key={id}>
      <button type="button" className={`pieces__item${sel?.id === id ? ' is-on' : ''}`} onClick={() => setSel({ kind, id })}>
        <strong>{name}</strong>
        <span>{factory && <Lock size={11} aria-hidden />} {info}{kind !== 'object' && config[kind === 'beam' ? 'beamId' : 'uprightId'] === id ? ' · en todos los racks' : ''}</span>
      </button>
    </li>
  )

  return (
    <div className="pieces">
      {/* ---------- la lista ---------- */}
      <aside className="pieces__list" aria-label="Mis piezas">
        <button type="button" className="link-btn pieces__back" onClick={() => setSection('deposito')}><ArrowLeft size={14} aria-hidden /> Volver al depósito</button>
        <h2 className="pieces__h">Mis vigas</h2>
        {!own.beams.length && <p className="muted small">Todavía no creaste ninguna.</p>}
        <ul>{own.beams.map((b) => item('beam', b.id, b.name || beamName(b), `aguanta ${kg(topCapacity(b))}`))}</ul>
        <Button icon={Plus} onClick={() => addBeam()} block>Nueva viga</Button>
        <h2 className="pieces__h">Mis parantes</h2>
        {!own.uprights.length && <p className="muted small">Todavía no creaste ninguno.</p>}
        <ul>{own.uprights.map((u) => item('upright', u.id, u.name || uprightName(u), `aguanta ${kg(u.maxFrameLoad)}`))}</ul>
        <Button icon={Plus} onClick={() => addUpright()} block>Nuevo parante</Button>
        <h2 className="pieces__h">Mis objetos</h2>
        {!own.objects.length && <p className="muted small">Cajas, mesas, máquinas… lo que quieras poner en el depósito.</p>}
        <ul>{own.objects.map((o) => item('object', o.id, o.name, `${metros(o.w)}${o.shape === 'caja' ? ` × ${metros(o.d)}` : ''} × ${metros(o.h)}`))}</ul>
        <Button icon={Plus} onClick={() => addObj()} block>Nuevo objeto</Button>
        <details className="plan-more pieces__factory">
          <summary>Piezas de fábrica</summary>
          <p className="muted small">No se cambian, pero se pueden copiar para hacer una propia.</p>
          <ul>
            {BEAM_PROFILES.map((b) => item('beam', b.id, b.name, `aguanta ${kg(topCapacity(b))}`, true))}
            {UPRIGHT_PROFILES.map((u) => item('upright', u.id, u.name, `aguanta ${kg(u.maxFrameLoad)}`, true))}
          </ul>
        </details>
      </aside>

      {/* ---------- las medidas ---------- */}
      <section className="pieces__edit" aria-label="Medidas de la pieza">
        {obj ? <>
          <h2 className="pieces__title">Objeto</h2>
          <div className="pieces__fields">
            <Field label="Nombre">{(id) => <Input id={id} value={obj.name} maxLength={40} onChange={(e) => setObj(obj.id, { name: e.target.value })} />}</Field>
            <ObjectFields o={obj} onChange={(patch) => setObj(obj.id, patch)} />
          </div>
          <h3 className="pieces__sub">Ponerlo en el depósito</h3>
          <div className="pieces__use">
            <Button variant="primary" icon={MousePointerClick} onClick={placeObj}>Poner en el depósito</Button>
          </div>
          <p className="muted small">
            Vas al plano con el objeto y lo ponés con un clic donde quieras, las veces que quieras (también en el 3D). Ahí lo movés, lo girás, lo subís del piso o le cambiás las medidas.
            {placedCount ? ` Ya hay ${placedCount === 1 ? 'uno puesto' : `${placedCount} puestos`}.` : ''}
          </p>
          <div className="pieces__use pieces__use--minor">
            <Button size="sm" icon={Copy} onClick={() => addObj(obj)}>Duplicar</Button>
            <Button size="sm" icon={Trash2} onClick={remove}>Borrar</Button>
          </div>
        </> : !sel || (!beam && !upright) ? (
          <div className="pieces__empty">
            <h2>Creá tus propias piezas</h2>
            <p>Armá tus tipos de viga y de parante con las medidas que quieras y metelos en los racks. O creá objetos (cajas, mesas, máquinas) y ponelos donde quieras en el depósito.</p>
            <div className="pieces__empty-actions">
              <Button variant="primary" icon={Plus} onClick={() => addBeam()}>Nueva viga</Button>
              <Button icon={Plus} onClick={() => addUpright()}>Nuevo parante</Button>
              <Button icon={Plus} onClick={() => addObj()}>Nuevo objeto</Button>
            </div>
          </div>
        ) : <>
          <h2 className="pieces__title">{beam ? 'Viga' : 'Parante'}{locked ? ' de fábrica' : ''}</h2>
          {locked && <p className="note note--blue">Esta pieza es de fábrica y no se cambia. Copiala para hacer una propia con otras medidas.</p>}
          <fieldset className="pieces__fields" disabled={locked}>
            {beam && <>
              <Field label="Nombre">{(id) => <Input id={id} value={beam.name} maxLength={40} onChange={(e) => setBeam(beam.id, { name: e.target.value })} />}</Field>
              {beam.shape
                ? <p className="pieces__dims">Mide <b>{beam.height} × {beam.depth} mm</b> (alto × ancho). Sale de la forma dibujada a la derecha.</p>
                : <div className="cot-inline">
                    <NumberStepper label="Alto" unit="mm" value={beam.height} min={P.beamHeight.min} max={P.beamHeight.max} step={10} typedStep={1} onChange={(height) => setBeam(beam.id, { height })} />
                    <NumberStepper label="Ancho" unit="mm" value={beam.depth} min={P.beamDepth.min} max={P.beamDepth.max} step={10} typedStep={1} onChange={(depth) => setBeam(beam.id, { depth })} />
                  </div>}
              <h3 className="pieces__sub">Cuánto aguanta, según el largo de la viga</h3>
              <p className="muted small">Lo que aguanta el par de vigas de un nivel, con la carga repartida. Cuanto más larga la viga, menos aguanta.</p>
              {beam.capacityBySpan.map((c, i) => (
                <div key={i} className="pieces__span">
                  <NumberStepper label="Hasta un largo de" meters value={c.maxSpan} min={P.beamSpan.min} max={P.beamSpan.max} step={100} typedStep={10}
                    onChange={(maxSpan) => setBeam(beam.id, { capacityBySpan: beam.capacityBySpan.map((x, j) => (j === i ? { ...x, maxSpan } : x)) })} />
                  <NumberStepper label="Aguanta" unit="kg" value={c.capacity} min={P.beamCapacity.min} max={P.beamCapacity.max} step={100} typedStep={10}
                    onChange={(capacity) => setBeam(beam.id, { capacityBySpan: beam.capacityBySpan.map((x, j) => (j === i ? { ...x, capacity } : x)) })} />
                  {beam.capacityBySpan.length > 1 && !locked && (
                    <button type="button" className="pieces__x" title="Quitar este largo" aria-label="Quitar este largo"
                      onClick={() => setBeam(beam.id, { capacityBySpan: beam.capacityBySpan.filter((_, j) => j !== i) })}><Trash2 size={15} aria-hidden /></button>
                  )}
                </div>
              ))}
              {!locked && beam.capacityBySpan.length < 6 && (
                <button type="button" className="link-btn" onClick={() => {
                  const first = beam.capacityBySpan[0], last = beam.capacityBySpan[beam.capacityBySpan.length - 1]
                  // si ya llega al largo máximo, el nuevo va antes (más corto, aguanta más); si no, después
                  const row = last.maxSpan >= P.beamSpan.max
                    ? { maxSpan: Math.max(P.beamSpan.min, first.maxSpan - 500), capacity: Math.min(P.beamCapacity.max, Math.round(first.capacity * 1.2 / 100) * 100) }
                    : { maxSpan: Math.min(P.beamSpan.max, last.maxSpan + 500), capacity: Math.max(P.beamCapacity.min, Math.round(last.capacity * 0.8 / 100) * 100) }
                  setBeam(beam.id, { capacityBySpan: [...beam.capacityBySpan, row] })
                }}>+ Agregar otro largo</button>
              )}
            </>}
            {upright && <>
              <Field label="Nombre">{(id) => <Input id={id} value={upright.name} maxLength={40} onChange={(e) => setUpright(upright.id, { name: e.target.value })} />}</Field>
              {upright.shape
                ? <p className="pieces__dims">Mide <b>{upright.faceWidth} × {upright.depth} mm</b> (frente × fondo). Sale de la forma dibujada a la derecha.</p>
                : <>
                    <div className="cot-inline">
                      <NumberStepper label="Frente" unit="mm" value={upright.faceWidth} min={P.uprightFace.min} max={P.uprightFace.max} step={10} typedStep={1} onChange={(faceWidth) => setUpright(upright.id, { faceWidth })} />
                      <NumberStepper label="Fondo" unit="mm" value={upright.depth} min={P.uprightDepth.min} max={P.uprightDepth.max} step={5} typedStep={1} onChange={(depth) => setUpright(upright.id, { depth })} />
                    </div>
                    <NumberStepper label="Espesor de la chapa" unit="mm" value={upright.thickness} min={P.uprightThickness.min} max={P.uprightThickness.max} step={0.5} onChange={(thickness) => setUpright(upright.id, { thickness })} />
                  </>}
              <NumberStepper label="Cuánto aguanta cada pórtico" unit="kg" value={upright.maxFrameLoad} min={P.uprightLoad.min} max={P.uprightLoad.max} step={500} typedStep={100}
                onChange={(maxFrameLoad) => setUpright(upright.id, { maxFrameLoad })} />
            </>}
          </fieldset>

          <h3 className="pieces__sub">Meterla en los racks</h3>
          <div className="pieces__use">
            <Button variant="primary" onClick={useInAll} disabled={usedByAll}>{usedByAll ? 'Ya está en todos los racks' : 'Usar en todos los racks'}</Button>
            <Button icon={MousePointerClick} onClick={() => setPicking(true)}>Elegir los racks…</Button>
          </div>
          <p className="muted small">
            {usedByAll ? 'Ahora la usan todos los racks del depósito.' : usedBy ? `Ahora la ${usedBy === 1 ? 'usa un rack' : `usan ${usedBy} racks`} del depósito.` : 'Todavía no la usa ningún rack.'}
            {' '}También se puede elegir desde el plano: tocás un rack, "Editar" y la buscás en "Piezas de este rack".
          </p>
          {usedByAll && <button type="button" className="link-btn" onClick={() => { update({ [key]: 'auto' }); toast.ok('Listo: los racks vuelven a elegir la pieza solos.') }}>Sacarla de todos los racks</button>}
          <div className="pieces__use pieces__use--minor">
            <Button size="sm" icon={Copy} onClick={() => (beam ? addBeam(beam) : upright && addUpright(upright))}>{locked ? 'Copiar para editar' : 'Duplicar'}</Button>
            {!locked && <Button size="sm" icon={Trash2} onClick={remove}>Borrar</Button>}
          </div>
        </>}
      </section>

      {picking && sel && <RackPicker id={sel.id} field={key} name={(beam ?? upright)?.name || 'la pieza'} preselect={rackIds} onClose={() => setPicking(false)} />}

      {/* ---------- cómo queda ---------- */}
      <section className="pieces__view" aria-label="Cómo queda la pieza">
        {obj ? <>
          <h3 className="pieces__sub">Cómo queda</h3>
          <div className="pieces__3d pieces__3d--solo">
            <Object3D o={obj} />
            <span className="pieces__3d-t">Arrastrá para girarlo</span>
          </div>
        </> : sel && (beam || upright) && sample ? <>
          <div className="pieces__cut">
            <h3 className="pieces__sub">La forma (el corte de la pieza) y cómo queda en 3D</h3>
            {shape && !locked
              ? <SectionEditor kind={sel.kind === 'beam' ? 'beam' : 'upright'} shape={shape} onChange={setShape} onRemove={() => setShape(undefined)} onError={toast.error} aside={view3dBlock} />
              : <>
                  <div className="sect__top">
                    <div className="pieces__cutbox">{beam ? <BeamCut b={beam} /> : upright && <UprightCut u={upright} />}</div>
                    {view3dBlock}
                  </div>
                  {!locked && <div className="pieces__shape-go">
                    <Button variant="primary" icon={PenTool} onClick={startShape}>Dibujar la forma con puntos</Button>
                    <Button icon={Upload} onClick={() => dxf.current?.click()}>Cargar dibujo de AutoCAD (DXF)</Button>
                    <input ref={dxf} type="file" accept=".dxf" hidden onChange={(e) => { void loadDxf(e.target.files?.[0]); e.target.value = '' }} />
                  </div>}
                </>}
          </div>

          <Warnings warnings={sample.warnings.filter((w) => w.level === 'validation')} />
        </> : <p className="pieces__hint">Elegí o creá una pieza para ver cómo queda.</p>}
      </section>
    </div>
  )
}

/* ------------------------------ Cortes ------------------------------ */

const DIM = '#2f6fb8'
const dimText = { fontFamily: 'var(--f-mono)', fontSize: 12, fontWeight: 700, fill: DIM } as const

/** Corte de una viga caja: el rectángulo hueco con su alto y su ancho. */
function BeamCut({ b }: { b: BeamProfile }) {
  const k = Math.min(140 / b.depth, 124 / b.height)
  const w = b.depth * k, h = b.height * k, x = 140 - w / 2, y = 84 - h / 2, t = Math.max(3, 3 * k)
  return (
    <svg viewBox="0 0 260 200" role="img" aria-label={`Viga de ${b.height} por ${b.depth} milímetros`}>
      <rect x={x} y={y} width={w} height={h} rx={2} fill="#be1e30" />
      <rect x={x + t} y={y + t} width={Math.max(0, w - 2 * t)} height={Math.max(0, h - 2 * t)} fill="#fff" />
      <line x1={x} y1={y + h + 14} x2={x + w} y2={y + h + 14} stroke={DIM} strokeWidth={1.5} />
      <text x={140} y={y + h + 30} textAnchor="middle" style={dimText}>{b.depth} mm</text>
      <line x1={x - 14} y1={y} x2={x - 14} y2={y + h} stroke={DIM} strokeWidth={1.5} />
      <text x={x - 20} y={84} textAnchor="end" dominantBaseline="middle" style={dimText}>{b.height} mm</text>
    </svg>
  )
}

/** Corte de un parante: la "C" con su frente, su fondo y el espesor de la chapa. */
function UprightCut({ u }: { u: UprightProfile }) {
  const k = Math.min(150 / u.faceWidth, 130 / u.depth)
  const w = u.faceWidth * k, d = u.depth * k, x = 130 - w / 2, y = 96 - d / 2, lip = w * 0.18, t = Math.max(3, u.thickness * k)
  return (
    <svg viewBox="0 0 260 200" role="img" aria-label={`Parante de ${u.faceWidth} por ${u.depth} milímetros`}>
      <path d={`M ${x + lip} ${y + d} L ${x} ${y + d} L ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + d} L ${x + w - lip} ${y + d}`} fill="none" stroke="#6b7480" strokeWidth={t} strokeLinejoin="miter" strokeLinecap="butt" />
      <line x1={x} y1={y - 14} x2={x + w} y2={y - 14} stroke={DIM} strokeWidth={1.5} />
      <text x={130} y={y - 20} textAnchor="middle" style={dimText}>frente {u.faceWidth} mm</text>
      <line x1={x - 16} y1={y} x2={x - 16} y2={y + d} stroke={DIM} strokeWidth={1.5} />
      <text x={x - 22} y={y + d / 2} textAnchor="end" dominantBaseline="middle" style={dimText}>{u.depth}</text>
      <text x={130} y={y + d + 26} textAnchor="middle" style={{ ...dimText, fill: '#5b616a' }}>chapa de {String(u.thickness).replace('.', ',')} mm</text>
    </svg>
  )
}
