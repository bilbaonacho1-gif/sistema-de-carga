/**
 * COTIZADOR DE DEPÓSITOS, paso a paso:
 *   1 Depósito → 2 Rack → 3 Carga → 4 Distribución → 5 Accesorios → 6 Resumen
 * Primero se dibuja el lugar; el rack es el módulo que se repite; la distribución calcula
 * cuántos racks entran en ESE depósito (filas, pasillos, columnas y zonas) y todo lo demás
 * (materiales, presupuesto) sale del depósito completo.
 */
import { AlertTriangle, Calculator, ChevronLeft, ChevronRight, Download, Lightbulb, Mail, PenLine, Phone, Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { buildDepot, moduleSize, type Depot } from '../shared/plan/depot'
import { planArea } from '../shared/plan/geometry'
import { placementRect } from '../shared/plan/layout'
import { addRack, freezeRacks, rackSelection } from '../shared/plan/racks'
import { calculateRackStructure } from '../shared/rack/calculateRackStructure'
import { beamCapacityForSpan } from '../shared/rack/rules'
import { BEAM_PROFILES, CONTACT, DESIGN_RULES, OFFICIAL_REFERENCE, UPRIGHT_PROFILES } from '../shared/rack/technicalSpecs'
import type { RackStructure } from '../shared/rack/types'
import { NumberStepper, Switch } from '../web/components/fields'
import { Button, Field, KeyValue, Segmented, Select } from '../web/components/ui'
import { fmt, plural } from '../web/lib/format'
import { AccessoriesStep, BeamHeights, LoadStep, MaterialsList, downloadMaterials } from '../web/pages/designer/CotizadorPanel'
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
  rack: { title: 'Cómo es el rack', short: 'Rack', help: 'Elegí el módulo que se va a repetir en el depósito: largo de viga, profundidad, altura y niveles.' },
  carga: { title: 'Pallet y carga', short: 'Carga', help: 'El pallet define cuántos entran por módulo. Si el cliente usa uno especial, elegí "A medida".' },
  distribucion: { title: 'Cuántos racks entran', short: 'Distribución', help: 'El cotizador arma las filas dentro de tu depósito (o sólo en las zonas de racks que marques), respetando los pasillos y esquivando columnas y zonas libres. Después podés tocar cualquier rack (en el plano o en 3D) y arrastrarlo, girarlo, duplicarlo o borrarlo.' },
  accesorios: { title: 'Accesorios', short: 'Accesorios', help: 'Protección, seguridad y piso de los niveles, para todos los racks del depósito.' },
  resumen: { title: 'Resumen y materiales', short: 'Resumen', help: 'El depósito completo: racks, posiciones y todas las piezas. Desde acá se pide el presupuesto.' },
}

/** El depósito calculado con la configuración actual (lo usan el panel, el visor y el presupuesto). */
export function useDepot(): { depot: Depot; preview: RackStructure } {
  const plan = usePlan((s) => s.plan)
  const layout = usePlan((s) => s.layout)
  const config = useDesigner((s) => s.config)
  const depot = useMemo(() => buildDepot(plan, config, layout), [plan, config, layout])
  // vista previa del rack: una fila de 3 módulos con las medidas elegidas
  const preview = useMemo(() => {
    const { sample } = moduleSize(config)
    return calculateRackStructure({
      ...sample.config, sections: [], positions: sample.palletsPerModule * sample.storageLevels * 3,
      layout: { ...sample.config.layout, rows: 1, backToBack: false },
    })
  }, [config])
  return { depot, preview }
}

export function DepotFlow({ onQuote }: { onQuote(): void }) {
  const { flowStep } = usePlan()
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
  const defaults = { height: config.height, levels: config.levels }
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
  const defs: { id: string; title: string; collapsed?: boolean; body: React.ReactNode }[] = [
    { id: 'pasos', title: `Paso ${FLOW.indexOf(flowStep) + 1} · ${META[flowStep].title}`, body: <>
      <Steps />
      <StepNav />
      <button type="button" className="link-btn dock-reset" onClick={() => useDock.getState().reset()}>Volver a ordenar los paneles</button>
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
  rack: [{ id: 'paso', title: 'El rack' }],
  carga: [{ id: 'paso', title: 'Pallet y carga' }],
  distribucion: [
    { id: 'marcar', title: 'Dónde van los racks' }, { id: 'paso', title: 'Distribución' },
    { id: 'herramientas', title: 'Herramientas', collapsed: true }, { id: 'capas', title: 'Capas', collapsed: true },
    { id: 'revision', title: 'Revisión del plano' }, { id: 'exportar', title: 'Exportar', collapsed: true },
  ],
  accesorios: [{ id: 'paso', title: 'Accesorios' }],
  resumen: [{ id: 'paso', title: 'Resumen y materiales' }, { id: 'revision', title: 'Revisión del plano' }, { id: 'exportar', title: 'Exportar' }],
}

/* ------------------------------ Pasos ------------------------------ */

function Steps() {
  const { flowStep, setFlowStep } = usePlan()
  const i = FLOW.indexOf(flowStep)
  return (
    <>
      <ol className="cot-steps" aria-label="Pasos">
        {FLOW.map((id, j) => (
          <li key={id}>
            <button type="button" className={`cot-step${j === i ? ' is-current' : ''}${j < i ? ' is-done' : ''}`} aria-current={j === i ? 'step' : undefined} onClick={() => setFlowStep(id)} title={META[id].title}>
              <span className="cot-step__n">{j + 1}</span>
              <span className="cot-step__t">{META[id].short}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="cot-help"><Lightbulb size={16} aria-hidden /><span>{META[flowStep].help}</span></p>
    </>
  )
}

function StepNav() {
  const { flowStep, setFlowStep } = usePlan()
  const i = FLOW.indexOf(flowStep)
  const next = FLOW[i + 1]
  return (
    <div className="cot-nav">
      <Button variant="ghost" icon={ChevronLeft} disabled={i === 0} onClick={() => setFlowStep(FLOW[i - 1])}>Anterior</Button>
      {next && <Button variant="primary" onClick={() => setFlowStep(next)}>{META[next].short} <ChevronRight size={16} aria-hidden /></Button>}
    </div>
  )
}

function StepBody({ step, depot, preview, onQuote }: { step: FlowStep; depot: Depot; preview: RackStructure; onQuote(): void }) {
  switch (step) {
    case 'deposito': return null
    case 'rack': return <RackStep s={preview} />
    case 'carga': return <LoadStep s={preview} />
    case 'distribucion': return <LayoutStep depot={depot} />
    case 'accesorios': return <AccessoriesStep s={depot.sample} counts={depot.counts} multiRow={depot.layout.rows > 1} />
    case 'resumen': return <SummaryStep depot={depot} onQuote={onQuote} />
  }
}

/* ------------------------------ 2. Rack ------------------------------ */

function RackStep({ s }: { s: RackStructure }) {
  const { config, update } = useDesigner()
  const minLevels = config.floorStorage ? 2 : 1
  const autoUpright = !config.uprightId || config.uprightId === 'auto'
  const autoBeam = !config.beamId || config.beamId === 'auto'
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
      <Switch label="Usar el piso como primer nivel" checked={config.floorStorage}
        onChange={(floorStorage) => update({ floorStorage, levels: Math.max(config.levels, floorStorage ? 2 : 1) })}
        hint={`${plural(s.beamLevels, 'plano', 'planos')} de vigas`} />
      <BeamHeights s={s} />
      <details className="plan-more">
        <summary>Parante y viga</summary>
        <Field label="Parante" hint={autoUpright ? `Automático: ${s.upright.name}.` : undefined}>{(id) => (
          <Select id={id} value={config.uprightId ?? 'auto'} onChange={(e) => update({ uprightId: e.target.value })}>
            <option value="auto">Automático (el más liviano que alcanza)</option>
            {UPRIGHT_PROFILES.map((u) => <option key={u.id} value={u.id}>{u.name} · hasta {kg(u.maxFrameLoad)}</option>)}
          </Select>
        )}</Field>
        <Field label="Viga" hint={autoBeam ? `Automática: ${s.beam.name} para ${kg(s.levelLoad)} por nivel.` : `Carga por nivel: ${kg(s.levelLoad)}.`}>{(id) => (
          <Select id={id} value={config.beamId ?? 'auto'} onChange={(e) => update({ beamId: e.target.value })}>
            <option value="auto">Automática (la más liviana que alcanza)</option>
            {BEAM_PROFILES.map((b) => <option key={b.id} value={b.id}>{b.name} · {kg(beamCapacityForSpan(b, s.config.width))} con {mm(s.config.width)}</option>)}
          </Select>
        )}</Field>
      </details>
    </div>
  )
}

/* ------------------------------ 4. Distribución ------------------------------ */

function LayoutStep({ depot }: { depot: Depot }) {
  const { layout, setLayout, plan, commit, select, multi, setMulti, tool, setTool, rackDrawPair, setRackDrawPair } = usePlan()
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

  // cómo se ubican los racks: solos (la distribución automática) o a mano
  const mode = (
    <Field label="¿Cómo se ubican los racks?">{() => (
      <Segmented label="Cómo se ubican los racks" value={depot.manual ? 'mano' : 'solos'}
        onChange={(v) => {
          if (v === 'mano') { commit((p) => freezeRacks(p, depot.layout.placements)); return }
          if (!window.confirm('¿Volver a ubicarlos solos? Se pierden los racks que moviste o dibujaste a mano.')) return
          commit((p) => ({ ...p, racks: undefined })); select(null); if (tool === 'rackdraw') setTool('select')
        }}
        options={[{ value: 'solos', label: 'Se ubican solos' }, { value: 'mano', label: 'Los ubico yo' }]} />
    )}</Field>
  )

  if (depot.manual) return (
    <div className="cot-fields">
      {mode}
      <p className="muted small">Arrancás con lo que había. Arrastrá cualquier rack: se alinea con las otras filas y se pega dejando el pasillo justo (Alt: libre). Al elegir uno ves a cuánto queda de las paredes y de los otros racks.</p>
      <div className="rack-tools">
        <Button icon={PenLine} variant={tool === 'rackdraw' ? 'primary' : undefined} onClick={() => setTool(tool === 'rackdraw' ? 'select' : 'rackdraw')} block>
          {tool === 'rackdraw' ? 'Dibujando filas… (Esc termina)' : 'Dibujar una fila de racks'}
        </Button>
        {tool === 'rackdraw' && (
          <Segmented label="Fila simple o doble" value={rackDrawPair ? 'doble' : 'simple'} onChange={(v) => setRackDrawPair(v === 'doble')}
            options={[{ value: 'simple', label: 'Simple' }, { value: 'doble', label: 'Doble (espalda con espalda)' }]} />
        )}
      </div>
      {results}
      <Button variant="ghost" icon={Trash2} block onClick={() => { if (window.confirm('¿Sacar todos los racks y empezar de cero?')) { commit((p) => ({ ...p, racks: [] })); select(null) } }}>
        Empezar de cero (sacar todos)
      </Button>
      <p className="muted small">Si marcás o cambiás una zona libre, una zona de racks o un pasillo, los racks se vuelven a ubicar solos.</p>
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
      <p className="muted small">Si movés un rack, pasa solo a "Los ubico yo". También podés elegir "Los ubico yo" y dibujar las filas vos.</p>
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
