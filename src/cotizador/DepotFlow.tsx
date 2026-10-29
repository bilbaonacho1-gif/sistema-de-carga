/**
 * COTIZADOR DE DEPÓSITOS, paso a paso:
 *   1 Depósito → 2 Rack → 3 Carga → 4 Distribución → 5 Accesorios → 6 Resumen
 * Primero se dibuja el lugar; el rack es el módulo que se repite; la distribución calcula
 * cuántos racks entran en ESE depósito (filas, pasillos, columnas y zonas) y todo lo demás
 * (materiales, presupuesto) sale del depósito completo.
 */
import { Calculator, ChevronLeft, ChevronRight, Download, Lightbulb, Mail, Phone } from 'lucide-react'
import { useMemo } from 'react'
import { buildDepot, moduleSize, type Depot } from '../shared/plan/depot'
import { planArea } from '../shared/plan/geometry'
import { placementRect } from '../shared/plan/layout'
import { calculateRackStructure } from '../shared/rack/calculateRackStructure'
import { beamCapacityForSpan } from '../shared/rack/rules'
import { BEAM_PROFILES, CONTACT, DESIGN_RULES, OFFICIAL_REFERENCE, UPRIGHT_PROFILES } from '../shared/rack/technicalSpecs'
import type { RackStructure } from '../shared/rack/types'
import { NumberStepper, Switch } from '../web/components/fields'
import { Button, Field, KeyValue, Segmented, Select } from '../web/components/ui'
import { fmt, plural } from '../web/lib/format'
import { AccessoriesStep, LoadStep, MaterialsList, downloadMaterials } from '../web/pages/designer/CotizadorPanel'
import { Viewport, Warnings } from '../web/pages/designer/CotizadorView'
import { useDesigner } from '../web/pages/designer/designerStore'
import { PlanTools } from '../web/plan/PlanPanel'
import { FLOW, usePlan, type FlowStep } from '../web/plan/planStore'
import { PlanStage } from '../web/plan/PlanWorkspace'

const L = DESIGN_RULES.limits
const mm = (n: number) => `${fmt(n)} mm`
const kg = (n: number) => `${fmt(n)} kg`

const META: Record<FlowStep, { title: string; short: string; help: string }> = {
  deposito: { title: 'Tu depósito', short: 'Depósito', help: 'Dibujá el lugar: contorno, columnas, portones y las zonas donde no van racks. Todo lo demás se calcula a partir de este plano.' },
  rack: { title: 'Cómo es el rack', short: 'Rack', help: 'Elegí el módulo que se va a repetir en el depósito: largo de viga, profundidad, altura y niveles.' },
  carga: { title: 'Pallet y carga', short: 'Carga', help: 'El pallet define cuántos entran por módulo. Si el cliente usa uno especial, elegí "A medida".' },
  distribucion: { title: 'Cuántos racks entran', short: 'Distribución', help: 'El cotizador arma las filas dentro de tu depósito, esquivando columnas y zonas libres. Probá la orientación y el ancho de pasillo para ver qué conviene.' },
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
  const showRacks = FLOW.indexOf(flowStep) >= FLOW.indexOf('distribucion')
  const rackView = flowStep === 'rack' || flowStep === 'carga'

  return (
    <div className="designer depot">
      <section className="designer__panel cotizador" aria-label="Cotizador de depósitos">
        <Steps />
        <StepBody step={flowStep} depot={depot} preview={preview} onQuote={onQuote} />
        <StepNav />
      </section>
      {rackView
        ? <Viewport s={preview} />
        : <PlanStage rackLayer={showRacks ? { racks: depot.layout.placements, size } : undefined} racks={showRacks ? depot.racks : undefined} />}
      <aside className="designer__side">
        <DepotPlate depot={depot} area={planArea(plan.outline)} />
        <Warnings warnings={preview.warnings.filter((w) => w.code !== 'free-positions')} />
        <p className="disclaimer">Simulación de referencia: no reemplaza el cálculo estructural. Toda configuración la valida el departamento técnico.</p>
        <div className="cz-contact">
          <strong>{CONTACT.company}</strong>
          <a href={`tel:${CONTACT.phone.replace(/\D/g, '')}`}><Phone size={14} aria-hidden /> {CONTACT.phone}</a>
          <a href={`mailto:${CONTACT.email}`}><Mail size={14} aria-hidden /> {CONTACT.email}</a>
          <span>{CONTACT.address}</span>
        </div>
      </aside>
    </div>
  )
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
      <div className="cot-head">
        <span className="cot-head__k">Paso {i + 1} de {FLOW.length}</span>
        <h2 className="cot-head__t">{META[flowStep].title}</h2>
      </div>
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
    case 'deposito': return <div className="cot-fields plan-panel"><PlanTools /></div>
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
      <NumberStepper label="Largo de viga (ancho del módulo)" unit="mm" value={config.width} min={L.width.min} max={L.width.max} step={50} slider onChange={(width) => update({ width })}
        hint={`${plural(s.palletsPerModule, 'pallet', 'pallets')} por nivel en cada módulo`} />
      <NumberStepper label="Profundidad del bastidor" unit="mm" value={config.depth} min={L.depth.min} max={L.depth.max} step={50} slider onChange={(depth) => update({ depth })} />
      <NumberStepper label="Altura" unit="mm" value={config.height} min={L.height.min} max={L.height.max} step={100} slider onChange={(height) => update({ height })}
        hint={config.height > OFFICIAL_REFERENCE.maxHeight ? <span className="late">Supera los {mm(OFFICIAL_REFERENCE.maxHeight)} publicados.</span> : undefined} />
      <Field label="Niveles de almacenamiento">{() => (
        <Segmented label="Niveles" value={String(config.levels)} onChange={(v) => update({ levels: Number(v) })}
          options={Array.from({ length: L.levels.max }, (_, i) => i + 1).filter((n) => n >= minLevels).map((n) => ({ value: String(n), label: String(n) }))} />
      )}</Field>
      <Switch label="Usar el piso como primer nivel" checked={config.floorStorage}
        onChange={(floorStorage) => update({ floorStorage, levels: Math.max(config.levels, floorStorage ? 2 : 1) })}
        hint={`${plural(s.beamLevels, 'plano', 'planos')} de vigas`} />
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
  const { layout, setLayout, plan } = usePlan()
  const config = useDesigner((s) => s.config)
  // la otra orientación, para comparar
  const other = useMemo(() => buildDepot(plan, config, { ...layout, orientation: layout.orientation === 'x' ? 'y' : 'x' }), [plan, config, layout])
  const area = planArea(plan.outline)
  const used = depot.layout.placements.reduce((n, p) => { const r = placementRect(p); return n + (r.w * r.h) / 1e6 }, 0)
  return (
    <div className="cot-fields">
      <Field label="Filas">{() => (
        <Segmented label="Orientación de las filas" value={layout.orientation} onChange={(orientation) => setLayout({ orientation })}
          options={[{ value: 'x', label: 'Horizontales' }, { value: 'y', label: 'Verticales' }]} />
      )}</Field>
      {other.positions > depot.positions && (
        <button type="button" className="note note--blue depot-tip" onClick={() => setLayout({ orientation: layout.orientation === 'x' ? 'y' : 'x' })}>
          Con filas {layout.orientation === 'x' ? 'verticales' : 'horizontales'} entran <strong>{fmt(other.positions)} posiciones</strong> ({fmt(other.positions - depot.positions)} más). Tocá para cambiar.
        </button>
      )}
      <NumberStepper label="Ancho de pasillo" unit="mm" value={layout.aisle} min={1200} max={6000} step={100} onChange={(aisle) => setLayout({ aisle })}
        hint="Para autoelevador común se usan unos 3.000 mm; para equipos de pasillo angosto, menos." />
      <Switch label="Filas espalda con espalda" checked={layout.backToBack} onChange={(backToBack) => setLayout({ backToBack })}
        hint="Dos filas unidas por la espalda comparten un pasillo: entran más racks." />
      <details className="plan-more">
        <summary>Separaciones</summary>
        <NumberStepper label="Pasillo de cabecera (contra las paredes)" unit="mm" value={layout.endGap} min={0} max={8000} step={100} onChange={(endGap) => setLayout({ endGap })} />
        <NumberStepper label="Separación de la pared" unit="mm" value={layout.wallGap} min={0} max={2000} step={50} onChange={(wallGap) => setLayout({ wallGap })} />
        <NumberStepper label="Separación de columnas y zonas" unit="mm" value={layout.obstacleGap} min={0} max={2000} step={50} onChange={(obstacleGap) => setLayout({ obstacleGap })} />
      </details>
      <KeyValue items={[
        ['Filas de rack', fmt(depot.layout.rows)],
        ['Módulos', fmt(depot.layout.modules)],
        ['Posiciones de pallet', fmt(depot.positions)],
        ['Capacidad estimada', kg(depot.capacity)],
        ['Piso ocupado por racks', area ? `${fmt(Math.round((used / area) * 100))} %` : '—'],
      ]} />
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
        <div className="plate__row"><dt>Rack</dt><dd>{fmt(s.config.width)} × {fmt(s.config.depth)} × {fmt(s.config.height)}</dd></div>
        <div className="plate__row"><dt>Carga por pallet</dt><dd>{kg(s.config.palletWeight)}</dd></div>
        <div className="plate__row plate__row--strong"><dt>Capacidad total estimada</dt><dd>{kg(depot.capacity)}</dd></div>
      </dl>
      <div className="plate__foot">{s.upright.name} · {s.beam.name} · Pallet {s.pallet.name}</div>
    </div>
  )
}
