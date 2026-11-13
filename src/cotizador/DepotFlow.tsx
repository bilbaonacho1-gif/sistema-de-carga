/**
 * COTIZADOR DE DEPÓSITOS, paso a paso:
 *   1 Depósito → 2 Rack (el módulo inicial y sus accesorios) → 3 Carga → 4 Distribución → 5 Resumen
 * Primero se dibuja el lugar; el rack es el módulo que se repite; la distribución calcula
 * cuántos racks entran en ESE depósito (filas, pasillos, columnas y zonas) y todo lo demás
 * (materiales, presupuesto) sale del depósito completo.
 */
import { AlertTriangle, Calculator, ChevronLeft, ClipboardPaste, ChevronRight, Download, Lightbulb, Mail, Phone, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { buildDepot, moduleSize, type Depot } from '../shared/plan/depot'
import { planArea } from '../shared/plan/geometry'
import { placementRect } from '../shared/plan/layout'
import { addRack, freezeRacks, rackSelection } from '../shared/plan/racks'
import { calculateRackStructure } from '../shared/rack/calculateRackStructure'
import { beamCapacityForSpan } from '../shared/rack/rules'
import { CONTACT, DESIGN_RULES, OFFICIAL_REFERENCE } from '../shared/rack/technicalSpecs'
import { beamName, isOwnProfile, PIECE_LIMITS as P, profilesOf, uprightName } from '../shared/rack/profiles'
import type { BeamProfile, FrameParts, RackStructure, UprightProfile } from '../shared/rack/types'
import { NumberStepper, Switch } from '../web/components/fields'
import { Button, Field, KeyValue, Segmented, Select } from '../web/components/ui'
import { fmt, plural } from '../web/lib/format'
import { AccessoriesStep, AccGroup, BeamHeights, LoadStep, MaterialsList, downloadMaterials } from '../web/pages/designer/CotizadorPanel'
import { Viewport, Warnings } from '../web/pages/designer/CotizadorView'
import { useDesigner } from '../web/pages/designer/designerStore'
import { MarkTools, PlanDepotData, PlanToolbar, Selection } from '../web/plan/PlanPanel'
import { ColumnResizer, DockPanel, DropZones, useDock, useDockLayout } from '../web/components/dock'
import { CalcoPanel, ChecksPanel, ExportPanel, LayersPanel } from '../web/plan/PlanModules'
import { planChecks } from '../shared/plan/checks'
import { FLOW, usePlan, type FlowStep } from '../web/plan/planStore'
import { MultiRackEditor, PlanStage, RackEditor } from '../web/plan/PlanWorkspace'
import { metros, metrosNum } from '../shared/units'

const L = DESIGN_RULES.limits
const mm = metros
const kg = (n: number) => `${fmt(n)} kg`

const META: Record<FlowStep, { title: string; short: string; help: string }> = {
  deposito: { title: 'Tu depósito', short: 'Depósito', help: 'Dibujá el lugar: contorno, columnas, portones y las zonas donde no van racks. Si ya sabés dónde van los racks y los pasillos, marcalos con "Zona de racks" y "Pasillo". Todo lo demás se calcula a partir de este plano.' },
  rack: { title: 'El módulo inicial', short: 'Rack', help: 'Este es el módulo inicial, el más importante: acá le cambiás todo (medidas, cada viga, los pórticos, los perfiles y los accesorios). Después lo ponés en el depósito, le sumás módulos y lo copiás.' },
  carga: { title: 'Pallet y carga', short: 'Carga', help: 'El pallet define cuántos entran por módulo. Si el cliente usa uno especial, elegí "A medida".' },
  distribucion: { title: 'Cuántos racks entran', short: 'Distribución', help: 'Armá los racks desde un módulo inicial: lo ponés en el plano, le sumás módulos y lo copiás y pegás donde quieras. Si preferís, el sistema también llena el depósito solo.' },
  resumen: { title: 'Resumen y materiales', short: 'Resumen', help: 'El depósito completo: racks, posiciones y todas las piezas. Desde acá se pide el presupuesto.' },
}

/** El depósito calculado con la configuración actual (lo usan el panel, el visor y el presupuesto). */
export function useDepot(): { depot: Depot; preview: RackStructure } {
  const plan = usePlan((s) => s.plan)
  const layout = usePlan((s) => s.layout)
  const config = useDesigner((s) => s.config)
  const depot = useMemo(() => buildDepot(plan, config, layout), [plan, config, layout])
  // vista previa del rack: el módulo inicial (un solo módulo, con sus dos bastidores) con las medidas elegidas
  const preview = useMemo(() => {
    const { sample } = moduleSize(config)
    return calculateRackStructure({
      ...sample.config, sections: [], positions: sample.palletsPerModule * sample.storageLevels,
      layout: { ...sample.config.layout, rows: 1, backToBack: false },
    })
  }, [config])
  return { depot, preview }
}

export function DepotFlow({ onQuote }: { onQuote(): void }) {
  const { flowStep } = usePlan()
  // al cambiar de paso se vuelven a ver todos los racks
  useEffect(() => {
    usePlan.getState().setIsolate(null)
    // cada paso arranca con sus paneles desde arriba
    for (const col of document.querySelectorAll('.dock-col__scroll')) col.scrollTo({ top: 0 })
  }, [flowStep])
  const { depot, preview } = useDepot()
  const plan = usePlan((s) => s.plan)
  const config = useDesigner((s) => s.config)
  const { size } = useMemo(() => moduleSize(config), [config])
  // los racks se ven en el plano desde el primer paso (mientras se dibuja el depósito ya se ve cuántos entran)
  const showRacks = flowStep !== 'rack' && flowStep !== 'carga'
  const rackView = flowStep === 'rack' || flowStep === 'carga'
  const rackLayer = showRacks ? { racks: depot.layout.placements, size, issues: depot.issues } : undefined
  // lo que se está editando en el plano va arriba de todo en el panel (en lugar de la ayuda del paso)
  const selection = usePlan((s) => s.selection)
  const editing = !rackView && !!selection && ((selection.kind !== 'rack' && selection.kind !== 'racks') || !!rackLayer)
  const defaults = { height: config.height, levels: config.levels, config }
  // al tocar algo en el plano, su panel "Editando" sube a la vista (en pantallas bajas quedaba escondido abajo)
  const selKey = !editing || !selection ? '' : `${selection.kind}:${'id' in selection ? selection.id : 'ids' in selection ? selection.ids.join() : 'index' in selection ? selection.index : ''}`
  useEffect(() => {
    if (!selKey) return
    const t = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-dock-id="editar"]'), col = el?.closest<HTMLElement>('.dock-col__scroll')
      if (!el || !col) return
      const top = el.getBoundingClientRect().top - col.getBoundingClientRect().top + col.scrollTop - 6
      col.scrollTo({ top, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(t)
  }, [selKey])
  const area = planArea(plan.outline)
  // revisión del plano (sólo con racks a la vista se revisan los racks)
  const layoutOpts = usePlan((s) => s.layout)
  const checks = useMemo(() => planChecks(plan, {
    racks: showRacks ? depot.racks.map((r) => ({ placement: r.placement, height: r.structure.config.height })) : [],
    issues: showRacks ? depot.issues : {},
    aisle: layoutOpts.aisle,
  }), [plan, depot, showRacks, layoutOpts.aisle])
  // datos del rótulo de la lámina
  const sheet = {
    title: 'Plano de depósito · rack selectivo',
    rows: [
      ['Fecha', new Date().toLocaleDateString('es-AR')],
      ['Superficie', `${fmt(Math.round(area))} m²`],
      ['Posiciones de pallet', fmt(depot.positions)],
      ['Filas de rack', fmt(depot.layout.rows)],
      ['Módulos', fmt(depot.layout.modules)],
      ['Rack', `${metrosNum(depot.sample.config.width)} × ${metrosNum(depot.sample.config.depth)} × ${metros(depot.sample.config.height)}`],
      ['Capacidad estimada', kg(depot.capacity)],
      ['Pasillos', metros(layoutOpts.aisle)],
    ] as [string, string][],
    note: 'Simulación de referencia: no reemplaza el cálculo estructural. Medidas en metros.',
  }
  // módulos del panel en este paso (como en Photoshop: cada uno se achica o se saca por separado)
  const modules = MODULES[flowStep]
  const panelsMoved = useDock((st) => Object.keys(st.panels).length > 0)
  const defs: { id: string; title: string; collapsed?: boolean; body: React.ReactNode }[] = [
    { id: 'pasos', title: `Paso ${FLOW.indexOf(flowStep) + 1} · ${META[flowStep].title}`, body: <>
      <Steps />
      <StepNav />
      {/* sólo si se movió o se achicó algún panel */}
      {panelsMoved && <button type="button" className="link-btn dock-reset" onClick={() => useDock.getState().reset()}>Volver a ordenar los paneles</button>}
    </> },
    ...(editing ? [{ id: 'editar', title: 'Editando', body: selection?.kind === 'rack' && rackLayer ? <RackEditor rackLayer={rackLayer} defaults={defaults} />
      : selection?.kind === 'racks' && rackLayer ? <MultiRackEditor rackLayer={rackLayer} defaults={defaults} /> : <Selection /> }] : []),
    ...modules.map((m) => ({ ...m, body: <>
      {m.id === 'herramientas' && <div className="plan-panel"><PlanToolbar showSelection={false} /></div>}
      {m.id === 'deposito-datos' && <div className="plan-panel"><PlanDepotData /></div>}
      {m.id === 'marcar' && <MarkTools />}
      {m.id === 'capas' && <LayersPanel />}
      {m.id === 'calco' && <CalcoPanel />}
      {m.id === 'revision' && <ChecksPanel checks={checks} />}
      {m.id === 'exportar' && <ExportPanel racks={showRacks ? depot.layout.placements : []} size={size} sheet={sheet} />}
      {m.id === 'accesorios' && <>
        <p className="muted small">Protección, pisos, refuerzos, señalización y colores. Van en todos los racks del depósito.</p>
        <AccessoriesStep s={depot.sample} counts={depot.counts} multiRow={depot.layout.rows > 1} closed />
      </>}
      {m.id === 'paso' && <>
        <StepBody step={flowStep} depot={depot} preview={preview} onQuote={onQuote} />
        {rackView && <Warnings warnings={preview.warnings.filter((w) => w.code !== 'free-positions')} />}
        {flowStep === 'resumen' && <>
          <p className="disclaimer">Simulación de referencia: no reemplaza el cálculo estructural. Toda configuración la valida el departamento técnico.</p>
          <div className="cz-contact">
            <strong>{CONTACT.company}</strong>
            <a href={`tel:${CONTACT.phone.replace(/\D/g, '')}`}><Phone size={14} aria-hidden /> {CONTACT.phone}</a>
            <a href={`mailto:${CONTACT.email}`}><Mail size={14} aria-hidden /> {CONTACT.email}</a>
            <span>{CONTACT.address}</span>
          </div>
        </>}
      </>}
    </> })),
  ]
  // como en Adobe: cada módulo va en la columna de la izquierda, en la de la derecha o suelto
  const place = useDockLayout(defs.map((d) => d.id))
  const cols = useDock((st) => st.cols)
  const byId = new Map(defs.map((d) => [d.id, d]))
  const panel = (id: string) => { const d = byId.get(id)!; return <DockPanel key={id} id={id} title={d.title} defaultCollapsed={d.collapsed}>{d.body}</DockPanel> }
  const hasL = place.left.length > 0, hasR = place.right.length > 0

  return (
    <div className={`designer depot depot--cols${hasL ? ' has-left' : ''}${hasR ? ' has-right' : ''}`}
      style={{ '--dock-l': `${cols.left}px`, '--dock-r': `${cols.right}px` } as React.CSSProperties}>
      {hasL && <aside className="dock-col dock-col--left" data-dock-col="left" aria-label="Paneles de la izquierda">
        <div className="dock-col__scroll">{place.left.map(panel)}</div>
        <ColumnResizer side="left" />
      </aside>}
      {rackView
        ? <Viewport s={preview} />
        : <PlanStage rackLayer={rackLayer} racks={showRacks ? depot.racks : undefined}
            summary={area > 0 && <DepotStrip depot={depot} area={area} />} />}
      {hasR && <aside className="dock-col dock-col--right" data-dock-col="right" aria-label="Paneles de la derecha">
        <div className="dock-col__scroll">{place.right.map(panel)}</div>
        <ColumnResizer side="right" />
      </aside>}
      {place.float.map(panel)}
      <DropZones />
    </div>
  )
}

/** Los módulos de cada paso (además de "Pasos" y, si hay algo elegido, "Editando"). */
const MODULES: Record<FlowStep, { id: string; title: string; collapsed?: boolean }[]> = {
  deposito: [
    { id: 'herramientas', title: 'Herramientas' }, { id: 'deposito-datos', title: 'Datos del depósito' },
    { id: 'calco', title: 'Calcar un plano', collapsed: true }, { id: 'capas', title: 'Capas', collapsed: true },
    { id: 'revision', title: 'Revisión del plano' }, { id: 'exportar', title: 'Exportar', collapsed: true },
  ],
  rack: [{ id: 'paso', title: 'El módulo inicial' }, { id: 'accesorios', title: 'Accesorios' }],
  carga: [{ id: 'paso', title: 'Pallet y carga' }],
  distribucion: [
    { id: 'marcar', title: 'Dónde van los racks' }, { id: 'paso', title: 'Distribución' },
    { id: 'herramientas', title: 'Herramientas', collapsed: true }, { id: 'capas', title: 'Capas', collapsed: true },
    { id: 'revision', title: 'Revisión del plano' }, { id: 'exportar', title: 'Exportar', collapsed: true },
  ],
  resumen: [{ id: 'paso', title: 'Resumen y materiales' }, { id: 'revision', title: 'Revisión del plano' }, { id: 'exportar', title: 'Exportar' }],
}

/* ------------------------------ Pasos ------------------------------ */

/** Cambiar de paso a mano: lo que estaba elegido en el plano se suelta (cada paso arranca limpio). */
const goStep = (id: FlowStep) => { const s = usePlan.getState(); s.select(null); s.setFlowStep(id) }

function Steps() {
  const flowStep = usePlan((s) => s.flowStep)
  const i = FLOW.indexOf(flowStep)
  // la ayuda del paso se puede esconder (queda como se dejó); en una pantalla baja arranca escondida para dejar lugar
  const [help, setHelp] = useState(() => {
    const roomy = typeof window === 'undefined' || window.innerHeight >= 720
    try { const saved = localStorage.getItem('sdc-ayuda-paso'); return saved === null ? roomy : saved === '1' } catch { return roomy }
  })
  const toggleHelp = () => { setHelp(!help); try { localStorage.setItem('sdc-ayuda-paso', help ? '0' : '1') } catch { /* sin memoria */ } }
  return (
    <>
      <ol className="cot-steps" aria-label="Pasos">
        {FLOW.map((id, j) => (
          <li key={id}>
            <button type="button" className={`cot-step${j === i ? ' is-current' : ''}${j < i ? ' is-done' : ''}`} aria-current={j === i ? 'step' : undefined} onClick={() => goStep(id)} title={META[id].title}>
              <span className="cot-step__n">{j + 1}</span>
              <span className="cot-step__t">{META[id].short}</span>
            </button>
          </li>
        ))}
      </ol>
      {help
        ? <p className="cot-help"><Lightbulb size={16} aria-hidden /><span>{META[flowStep].help}</span>
            <button type="button" className="cot-help__x" onClick={toggleHelp} aria-label="Esconder la ayuda de este paso" title="Esconder la ayuda">×</button></p>
        : <button type="button" className="cot-help-more" onClick={toggleHelp}><Lightbulb size={14} aria-hidden /> ¿Qué hago en este paso?</button>}
    </>
  )
}

function StepNav() {
  const flowStep = usePlan((s) => s.flowStep)
  const i = FLOW.indexOf(flowStep)
  const next = FLOW[i + 1]
  return (
    <div className="cot-nav">
      <Button variant="ghost" icon={ChevronLeft} disabled={i === 0} onClick={() => goStep(FLOW[i - 1])}>Anterior</Button>
      {next && <Button variant="primary" onClick={() => goStep(next)}>{META[next].short} <ChevronRight size={16} aria-hidden /></Button>}
    </div>
  )
}

function StepBody({ step, depot, preview, onQuote }: { step: FlowStep; depot: Depot; preview: RackStructure; onQuote(): void }) {
  switch (step) {
    case 'deposito': return null
    case 'rack': return <RackStep s={preview} />
    case 'carga': return <LoadStep s={preview} />
    case 'distribucion': return <LayoutStep depot={depot} />
    case 'resumen': return <SummaryStep depot={depot} onQuote={onQuote} />
  }
}

/* ------------------------------ 2. Rack ------------------------------ */

function RackStep({ s }: { s: RackStructure }) {
  const { config, update } = useDesigner()
  const minLevels = config.floorStorage ? 2 : 1
  const autoUpright = !config.uprightId || config.uprightId === 'auto'
  const autoBeam = !config.beamId || config.beamId === 'auto'
  const all = profilesOf(config)
  // parante y viga: se eligen de la lista o se ponen a mano (quedan guardados en "Mis piezas")
  const own = { uprights: config.customProfiles?.uprights ?? [], beams: config.customProfiles?.beams ?? [], objects: config.customProfiles?.objects }
  const myBeam = own.beams.find((b) => b.id === config.beamId), myUpright = own.uprights.find((u) => u.id === config.uprightId)
  const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 7)}`
  const fit = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, Math.round(v)))
  /** Una viga propia que arranca con las medidas de la que está puesta ahora. */
  const newBeam = () => {
    const b: BeamProfile = {
      id: newId('mv-'), name: '', height: fit(s.beam.height, P.beamHeight), depth: fit(s.beam.depth, P.beamDepth),
      capacityBySpan: [{ maxSpan: P.beamSpan.max, capacity: fit(beamCapacityForSpan(s.beam, s.config.width) || 2000, P.beamCapacity) }],
    }
    b.name = beamName(b)
    update({ customProfiles: { ...own, beams: [...own.beams, b] }, beamId: b.id })
  }
  const newUpright = () => {
    const u: UprightProfile = {
      id: newId('mp-'), name: '', faceWidth: fit(s.upright.faceWidth, P.uprightFace), depth: fit(s.upright.depth, P.uprightDepth),
      thickness: s.upright.thickness, maxFrameLoad: fit(s.upright.maxFrameLoad, P.uprightLoad),
    }
    u.name = uprightName(u)
    update({ customProfiles: { ...own, uprights: [...own.uprights, u] }, uprightId: u.id })
  }
  // el nombre sigue a las medidas mientras no se le haya puesto uno propio
  const setBeam = (patch: Partial<BeamProfile>) => myBeam && update({ customProfiles: { ...own, beams: own.beams.map((b) => {
    if (b.id !== myBeam.id) return b
    const next = { ...b, ...patch }
    return b.name === beamName(b) ? { ...next, name: beamName(next) } : next
  }) } })
  const setUpright = (patch: Partial<UprightProfile>) => myUpright && update({ customProfiles: { ...own, uprights: own.uprights.map((u) => {
    if (u.id !== myUpright.id) return u
    const next = { ...u, ...patch }
    return u.name === uprightName(u) ? { ...next, name: uprightName(next) } : next
  }) } })
  // lo que aguanta la viga con el largo de este módulo (el renglón de su tabla que le toca)
  const spanRow = myBeam ? Math.max(0, myBeam.capacityBySpan.findIndex((c) => s.config.width <= c.maxSpan)) : 0
  const toPieces = () => usePlan.getState().setSection('piezas')
  return (
    <div className="cot-fields">
      <NumberStepper label="Largo de viga (ancho del módulo)" meters value={config.width} min={L.width.min} max={L.width.max} step={50} typedStep={10} slider onChange={(width) => update({ width })}
        hint={`${plural(s.palletsPerModule, 'pallet', 'pallets')} por nivel en cada módulo`} />
      <NumberStepper label="Profundidad del bastidor" meters value={config.depth} min={L.depth.min} max={L.depth.max} step={50} typedStep={10} slider onChange={(depth) => update({ depth })} />
      <NumberStepper label="Altura" meters value={config.height} min={L.height.min} max={L.height.max} step={100} typedStep={10} slider onChange={(height) => update({ height })}
        hint={config.height > OFFICIAL_REFERENCE.maxHeight ? <span className="late">Supera los {mm(OFFICIAL_REFERENCE.maxHeight)} publicados.</span> : undefined} />
      <Field label="Niveles de almacenamiento">{() => (
        <Segmented label="Niveles" value={String(config.levels)} onChange={(v) => update({ levels: Number(v) })}
          options={Array.from({ length: L.levels.max }, (_, i) => i + 1).filter((n) => n >= minLevels).map((n) => ({ value: String(n), label: String(n) }))} />
      )}</Field>
      {/* al sacar o poner el piso, las vigas quedan como están: sólo cambia si hay pallets abajo */}
      <Switch label="Pallets en el piso" checked={config.floorStorage}
        onChange={(floorStorage) => update({ floorStorage, levels: floorStorage ? Math.min(L.levels.max, config.levels + 1) : Math.max(1, config.levels - 1) })}
        hint={config.floorStorage ? `El piso es el primer nivel · ${plural(s.beamLevels, 'plano', 'planos')} de vigas arriba` : `Abajo queda libre · ${plural(s.beamLevels, 'plano', 'planos')} de vigas`} />
      <BeamHeights s={s} />
      <FrameDefaults s={s} />
      <AccGroup title="Parante y viga" summary={`${autoUpright ? 'parante automático' : s.upright.name} · ${autoBeam ? 'viga automática' : s.beam.name}`}>
        <Field label="Parante" hint={autoUpright ? `Automático: ${s.upright.name}.` : undefined}>{(id) => (
          <Select id={id} value={config.uprightId ?? 'auto'} onChange={(e) => (e.target.value === 'nuevo' ? newUpright() : update({ uprightId: e.target.value }))}>
            <option value="auto">Automático (el más liviano que alcanza)</option>
            {all.uprights.map((u) => <option key={u.id} value={u.id}>{u.name}{isOwnProfile(config, u.id) ? ' (mío)' : ''} · hasta {kg(u.maxFrameLoad)}</option>)}
            <option value="nuevo">+ Poner las medidas yo…</option>
          </Select>
        )}</Field>
        {myUpright && (
          <div className="own-piece">
            <strong>Tu parante</strong>
            {myUpright.shape
              ? <p className="muted small">Mide {myUpright.faceWidth} × {myUpright.depth} mm: sale de la forma que dibujaste en "Mis piezas".</p>
              : <>
                  <div className="own-fields">
                    <NumberStepper label="Frente" unit="mm" value={myUpright.faceWidth} min={P.uprightFace.min} max={P.uprightFace.max} step={10} typedStep={1} onChange={(faceWidth) => setUpright({ faceWidth })} />
                    <NumberStepper label="Fondo" unit="mm" value={myUpright.depth} min={P.uprightDepth.min} max={P.uprightDepth.max} step={5} typedStep={1} onChange={(depth) => setUpright({ depth })} />
                  </div>
                  <NumberStepper label="Espesor de la chapa" unit="mm" value={myUpright.thickness} min={P.uprightThickness.min} max={P.uprightThickness.max} step={0.5} onChange={(thickness) => setUpright({ thickness })} />
                </>}
            <NumberStepper label="Cuánto aguanta cada pórtico" unit="kg" value={myUpright.maxFrameLoad} min={P.uprightLoad.min} max={P.uprightLoad.max} step={500} typedStep={100} onChange={(maxFrameLoad) => setUpright({ maxFrameLoad })} />
            <button type="button" className="link-btn" onClick={toPieces}>Nombre y forma, en "Mis piezas"…</button>
          </div>
        )}
        <Field label="Viga" hint={autoBeam ? `Automática: ${s.beam.name} para ${kg(s.levelLoad)} por nivel.` : `Carga por nivel: ${kg(s.levelLoad)}.`}>{(id) => (
          <Select id={id} value={config.beamId ?? 'auto'} onChange={(e) => (e.target.value === 'nueva' ? newBeam() : update({ beamId: e.target.value }))}>
            <option value="auto">Automática (la más liviana que alcanza)</option>
            {all.beams.map((b) => <option key={b.id} value={b.id}>{b.name}{isOwnProfile(config, b.id) ? ' (mía)' : ''} · {kg(beamCapacityForSpan(b, s.config.width))} con {mm(s.config.width)}</option>)}
            <option value="nueva">+ Poner las medidas yo…</option>
          </Select>
        )}</Field>
        {myBeam && (
          <div className="own-piece">
            <strong>Tu viga</strong>
            {myBeam.shape
              ? <p className="muted small">Mide {myBeam.height} × {myBeam.depth} mm (alto × ancho): sale de la forma que dibujaste en "Mis piezas".</p>
              : <div className="own-fields">
                  <NumberStepper label="Alto" unit="mm" value={myBeam.height} min={P.beamHeight.min} max={P.beamHeight.max} step={10} typedStep={1} onChange={(height) => setBeam({ height })} />
                  <NumberStepper label="Ancho" unit="mm" value={myBeam.depth} min={P.beamDepth.min} max={P.beamDepth.max} step={10} typedStep={1} onChange={(depth) => setBeam({ depth })} />
                </div>}
            <NumberStepper label={`Cuánto aguanta el par, con ${mm(s.config.width)} de largo`} unit="kg" value={myBeam.capacityBySpan[spanRow]?.capacity ?? 0} min={P.beamCapacity.min} max={P.beamCapacity.max} step={100} typedStep={10}
              onChange={(capacity) => setBeam({ capacityBySpan: myBeam.capacityBySpan.map((c, i) => (i === spanRow ? { ...c, capacity } : c)) })} />
            <button type="button" className="link-btn" onClick={toPieces}>Nombre, forma y otros largos, en "Mis piezas"…</button>
          </div>
        )}
        {!myBeam && !myUpright && <p className="muted small">Elegí una de la lista o poné vos las medidas con la última opción. Las tuyas quedan guardadas en "Mis piezas".</p>}
      </AccGroup>
    </div>
  )
}

/**
 * Los pórticos del módulo inicial: dos columnas, sus bases y sus riendas. Lo que se elige acá vale
 * para todos los pórticos; después, en el plano, cada pórtico se puede cambiar por separado.
 */
function FrameDefaults({ s }: { s: RackStructure }) {
  const { config, update } = useDesigner()
  const d = config.frameDefault
  const f = s.rows[0]?.frames[0]
  if (!f) return null
  const set = (patch: Partial<FrameParts>) => {
    const next: FrameParts = { ...d, ...patch }
    for (const k of Object.keys(next) as (keyof FrameParts)[]) if (next[k] === undefined || next[k] === false) delete next[k]
    update({ frameDefault: Object.keys(next).length ? next : undefined })
  }
  const bases = (f.bases[0] ? 1 : 0) + (f.bases[1] ? 1 : 0)
  const cols = f.columns[0] === f.columns[1] ? mm(f.columns[0]) : `${mm(f.columns[0])} y ${mm(f.columns[1])}`
  return (
    <AccGroup title="Pórticos" summary={`2 columnas (${cols}) · ${bases === 1 ? '1 base' : `${bases} bases`} · ${f.diagonals + f.horizontals} riendas`} defaultOpen={!!d}>
      <p className="muted small">Cada pórtico son dos columnas, sus bases y sus riendas. Lo que elijas acá vale para todos; después, en el plano, podés cambiar un pórtico solo.</p>
      <div className="own-fields">
        <NumberStepper label="Riendas diagonales" value={f.diagonals} min={0} max={60} step={1} onChange={(diagonals) => set({ diagonals })}
          hint={d?.diagonals === undefined ? 'Las de siempre' : 'Elegidas'} />
        <NumberStepper label="Riendas horizontales" value={f.horizontals} min={0} max={20} step={1} onChange={(horizontals) => set({ horizontals })}
          hint={d?.horizontals === undefined ? 'Las de siempre' : 'Elegidas'} />
      </div>
      <div className="own-fields">
        <NumberStepper label="Columna de adelante" meters value={f.columns[0]} min={L.height.min} max={L.height.max} step={100} typedStep={10}
          onChange={(frontHeight) => set({ frontHeight })} hint={d?.frontHeight === undefined ? 'El alto del rack' : 'Propia'} />
        <NumberStepper label="Columna de atrás" meters value={f.columns[1]} min={L.height.min} max={L.height.max} step={100} typedStep={10}
          onChange={(backHeight) => set({ backHeight })} hint={d?.backHeight === undefined ? 'El alto del rack' : 'Propia'} />
      </div>
      <p className="muted small">Una columna puede ser más alta que la otra, por ejemplo donde va un arriostre superior. La de adelante es la del lado del pasillo.</p>
      <Switch label="Base de adelante" checked={f.bases[0]} onChange={(v) => set({ noBaseFront: v ? undefined : true })} hint="La de la columna del lado del pasillo." />
      <Switch label="Base de atrás" checked={f.bases[1]} onChange={(v) => set({ noBaseBack: v ? undefined : true })} />
      {d && <button type="button" className="link-btn" onClick={() => update({ frameDefault: undefined })}>Volver a los pórticos de siempre</button>}
    </AccGroup>
  )
}

/* ------------------------------ 4. Distribución ------------------------------ */

function LayoutStep({ depot }: { depot: Depot }) {
  const { layout, setLayout, plan, commit, select, multi, setMulti, tool, setTool, rackDrawPair, setRackDrawPair, clipRacks } = usePlan()
  const config = useDesigner((s) => s.config)
  // la otra orientación, para comparar
  const other = useMemo(() => buildDepot(plan, config, { ...layout, orientation: layout.orientation === 'x' ? 'y' : 'x' }), [plan, config, layout])
  const area = planArea(plan.outline)
  const used = depot.layout.placements.reduce((n, p) => { const r = placementRect(p); return n + (r.w * r.h) / 1e6 }, 0)
  const issues = Object.entries(depot.issues)
  const add = () => {
    let id = ''
    commit((p) => { const r = addRack(freezeRacks(p, depot.layout.placements), moduleSize(config).size); id = r.id; return r.plan })
    if (id) select({ kind: 'rack', id })
  }
  const results = (
    <>
      <KeyValue items={[
        ['Filas de rack', fmt(depot.layout.rows)],
        ['Módulos', fmt(depot.layout.modules)],
        ['Posiciones de pallet', fmt(depot.positions)],
        ['Capacidad estimada', kg(depot.capacity)],
        ['Piso ocupado por racks', area ? `${fmt(Math.round((used / area) * 100))} %` : '—'],
      ]} />
      {issues.length > 0 && (
        <div className="note note--amber depot-issues">
          <strong><AlertTriangle size={14} aria-hidden /> {plural(issues.length, 'rack con problemas', 'racks con problemas')}</strong>
          <ul>{issues.slice(0, 6).map(([id, why]) => (
            <li key={id}><button type="button" onClick={() => select({ kind: 'rack', id })}>{why}</button></li>
          ))}</ul>
        </div>
      )}
      <div className="multi-pick">
        <label className="plan-snap"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> Elegir varios racks</label>
        <button type="button" className="link-btn" onClick={() => select(rackSelection(depot.layout.placements.map((p) => p.id)))}>Elegir todos</button>
      </div>
      <p className="muted small">{multi ? 'Tocá cada rack para sumarlo, o arrastrá un recuadro sobre el plano.' : 'Para elegir varios: Shift + clic en cada rack, o Shift + arrastrar un recuadro.'} Después cambiás módulos, altura o niveles de todos juntos, o de cada uno por separado.</p>
      <Button icon={Plus} onClick={add} block>Agregar un rack</Button>
    </>
  )

  // cómo se arman los racks: a mano desde un módulo inicial (lo normal) o llenando el depósito solo
  const mode = (
    <Field label="¿Cómo armás los racks?">{() => (
      <Segmented label="Cómo se arman los racks" value={depot.manual ? 'mano' : 'solos'}
        onChange={(v) => {
          if (v === 'mano') { commit((p) => freezeRacks(p, depot.layout.placements)); return }
          if (depot.layout.placements.length && !window.confirm('¿Llenar el depósito solo? Se pierden los racks que armaste a mano.')) return
          commit((p) => ({ ...p, racks: undefined })); select(null); if (tool === 'rackdraw' || tool === 'rackpaste') setTool('select')
        }}
        options={[{ value: 'mano', label: 'Lo armo yo' }, { value: 'solos', label: 'Se llena solo' }]} />
    )}</Field>
  )

  if (depot.manual) return (
    <div className="cot-fields">
      {mode}
      <ol className="mod-steps">
        <li><b>Poné el módulo inicial</b> tocando el plano donde va.</li>
        <li><b>Sumale módulos</b> con el <i>+</i> de cada punta.</li>
        <li><b>Copialo y pegalo</b> (Ctrl+C y Ctrl+V): si lo pegás a continuación de otro, se unen.</li>
      </ol>
      <div className="rack-tools">
        <Button icon={Plus} variant={tool === 'rackdraw' ? 'primary' : undefined} onClick={() => setTool(tool === 'rackdraw' ? 'select' : 'rackdraw')} block>
          {tool === 'rackdraw' ? 'Tocá el plano… (Esc termina)' : 'Poner un módulo inicial'}
        </Button>
        <Segmented label="Simple o doble" value={rackDrawPair ? 'doble' : 'simple'} onChange={(v) => setRackDrawPair(v === 'doble')}
          options={[{ value: 'simple', label: 'Simple' }, { value: 'doble', label: 'Doble (espalda con espalda)' }]} />
        {!!clipRacks?.length && (
          <Button icon={ClipboardPaste} variant={tool === 'rackpaste' ? 'primary' : undefined} onClick={() => setTool(tool === 'rackpaste' ? 'select' : 'rackpaste')} block>
            {tool === 'rackpaste' ? 'Tocá donde va la copia… (Esc termina)' : 'Pegar lo copiado'}
          </Button>
        )}
      </div>
      {!depot.layout.placements.length
        ? <p className="note note--blue">Todavía no hay racks. Poné el módulo inicial, o elegí "Se llena solo" para ver rápido cuántos entran.</p>
        : results}
      {depot.layout.placements.length > 0 && (
        <Button variant="ghost" icon={Trash2} block onClick={() => { if (window.confirm('¿Sacar todos los racks y empezar de cero?')) { commit((p) => ({ ...p, racks: [] })); select(null) } }}>
          Sacar todos los racks
        </Button>
      )}
    </div>
  )

  return (
    <div className="cot-fields">
      {mode}
      <Field label={plan.rackAreas?.length ? 'Filas (de las zonas sin orientación propia)' : 'Filas'}>{() => (
        <Segmented label="Orientación de las filas" value={layout.orientation} onChange={(orientation) => setLayout({ orientation })}
          options={[{ value: 'x', label: 'Horizontales' }, { value: 'y', label: 'Verticales' }]} />
      )}</Field>
      {other.positions > depot.positions && (
        <button type="button" className="note note--blue depot-tip" onClick={() => setLayout({ orientation: layout.orientation === 'x' ? 'y' : 'x' })}>
          Con filas {layout.orientation === 'x' ? 'verticales' : 'horizontales'} entran <strong>{fmt(other.positions)} posiciones</strong> ({fmt(other.positions - depot.positions)} más). Tocá para cambiar.
        </button>
      )}
      <NumberStepper label="Ancho de pasillo" meters value={layout.aisle} min={1200} max={6000} step={500} typedStep={10} onChange={(aisle) => setLayout({ aisle })}
        hint={layout.aisle === 3000 ? 'Lo habitual: 3 m.' : <>Lo habitual es 3 m. <button type="button" className="link-btn" onClick={() => setLayout({ aisle: 3000 })}>Volver a 3 m</button></>} />
      <Switch label="Filas espalda con espalda" checked={layout.backToBack} onChange={(backToBack) => setLayout({ backToBack })}
        hint="Dos filas unidas por la espalda comparten un pasillo: entran más racks." />
      <details className="plan-more">
        <summary>Separaciones</summary>
        <NumberStepper label="Pasillo de cabecera (contra las paredes)" meters value={layout.endGap} min={0} max={8000} step={500} typedStep={10} onChange={(endGap) => setLayout({ endGap })}
          hint={layout.endGap === 3000 ? 'Lo habitual: 3 m, para dar la vuelta con el autoelevador.' : <>Lo habitual es 3 m. <button type="button" className="link-btn" onClick={() => setLayout({ endGap: 3000 })}>Volver a 3 m</button></>} />
        <NumberStepper label="Separación de la pared" meters value={layout.wallGap} min={0} max={2000} step={50} onChange={(wallGap) => setLayout({ wallGap })} />
        <NumberStepper label="Separación de columnas y zonas" meters value={layout.obstacleGap} min={0} max={2000} step={50} onChange={(obstacleGap) => setLayout({ obstacleGap })} />
      </details>
      {results}
      <p className="muted small">Si movés un rack, pasa solo a "Lo armo yo". Ahí podés partirlo, sumarle módulos o copiarlo y pegarlo.</p>
      {!depot.layout.placements.length && <p className="note note--amber">No entra ningún rack: revisá el plano, el ancho de pasillo o las separaciones.</p>}
    </div>
  )
}

/* ------------------------------ 6. Resumen ------------------------------ */

function SummaryStep({ depot, onQuote }: { depot: Depot; onQuote(): void }) {
  return (
    <div className="cot-fields">
      <KeyValue items={[
        ['Filas de rack', fmt(depot.layout.rows)],
        ['Módulos', fmt(depot.layout.modules)],
        ['Posiciones', fmt(depot.positions)],
        ['Capacidad estimada', kg(depot.capacity)],
      ]} />
      <MaterialsList lines={depot.materials} />
      <Button icon={Download} onClick={() => downloadMaterials(depot.materials, `materiales-deposito-${depot.positions}-posiciones`)} block>Descargar lista (CSV)</Button>
      <Button variant="primary" icon={Calculator} onClick={onQuote} block>Pedir presupuesto</Button>
    </div>
  )
}

/* ------------------------------ Placa del depósito ------------------------------ */

/** Los números del depósito en una franja, arriba del plano. */
function DepotStrip({ depot, area }: { depot: Depot; area: number }) {
  return (
    <dl className="depot-strip">
      <div><dt>Posiciones</dt><dd>{fmt(depot.positions)}</dd></div>
      <div><dt>Filas</dt><dd>{fmt(depot.layout.rows)}</dd></div>
      <div><dt>Módulos</dt><dd>{fmt(depot.layout.modules)}</dd></div>
      <div><dt>Superficie</dt><dd>{fmt(Math.round(area))} m²</dd></div>
      <div className="depot-strip__strong"><dt>Capacidad</dt><dd>{kg(depot.capacity)}</dd></div>
    </dl>
  )
}

export function DepotPlate({ depot, area, compact }: { depot: Depot; area: number; compact?: boolean }) {
  const s = depot.sample
  return (
    <div className={`plate${compact ? ' plate--compact' : ''}`}>
      <span className="plate__rivet plate__rivet--tl" aria-hidden /><span className="plate__rivet plate__rivet--tr" aria-hidden />
      <span className="plate__rivet plate__rivet--bl" aria-hidden /><span className="plate__rivet plate__rivet--br" aria-hidden />
      <div className="plate__band"><span>Tu depósito</span><span className="plate__band-sub">Rack selectivo</span></div>
      <div className="plate__grid">
        <div className="plate__figure"><span className="plate__figure-value">{fmt(depot.positions)}</span><span className="plate__figure-label">Posiciones</span></div>
        <div className="plate__figure"><span className="plate__figure-value">{fmt(depot.layout.rows)}</span><span className="plate__figure-label">Filas de rack</span></div>
        <div className="plate__figure"><span className="plate__figure-value">{fmt(depot.layout.modules)}</span><span className="plate__figure-label">Módulos</span></div>
        <div className="plate__figure"><span className="plate__figure-value">{fmt(s.storageLevels)}</span><span className="plate__figure-label">Niveles</span></div>
      </div>
      <dl className="plate__rows">
        <div className="plate__row"><dt>Superficie</dt><dd>{fmt(Math.round(area))} m²</dd></div>
        <div className="plate__row"><dt>Rack</dt><dd>{metrosNum(s.config.width)} × {metrosNum(s.config.depth)} × {metros(s.config.height)}</dd></div>
        <div className="plate__row"><dt>Carga por pallet</dt><dd>{kg(s.config.palletWeight)}</dd></div>
        <div className="plate__row plate__row--strong"><dt>Capacidad total estimada</dt><dd>{kg(depot.capacity)}</dd></div>
      </dl>
      <div className="plate__foot">{s.upright.name} · {s.beam.name} · Pallet {s.pallet.name}</div>
    </div>
  )
}
