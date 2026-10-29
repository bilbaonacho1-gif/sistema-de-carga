/**
 * PANEL DEL COTIZADOR (columna izquierda). Dos formas de usarlo:
 *  - Paso a paso: un paso por vez, con una ayuda corta y Anterior / Siguiente.
 *  - Ver todo: todas las opciones juntas, para quien ya sabe qué quiere.
 * Cada cambio rearma la estructura y el 3D al instante.
 */
import { Calculator, ChevronLeft, ChevronRight, Copy, Download, Lightbulb, Plus, Trash2, Warehouse } from 'lucide-react'
import { PRODUCT_TYPES, type ProductGroup } from '../../../shared/catalog'
import { materialsTotal } from '../../../shared/rack/bom'
import { beamCapacityForSpan } from '../../../shared/rack/rules'
import { BEAM_PROFILES, DESIGN_RULES, OFFICIAL_REFERENCE, PALLET_TYPES, UPRIGHT_PROFILES } from '../../../shared/rack/technicalSpecs'
import type { AccessoryConfig, ComponentCounts, MaterialLine, RackStructure } from '../../../shared/rack/types'

import { NumberStepper, Switch } from '../../components/fields'
import { Badge, Button, Field, KeyValue, Segmented, Select } from '../../components/ui'
import { fmt, plural } from '../../lib/format'
import { STEPS, useDesigner, type StepId } from './designerStore'

const L = DESIGN_RULES.limits
const mm = (n: number) => `${fmt(n)} mm`
const kg = (n: number) => `${fmt(n)} kg`

const META: Record<StepId, { title: string; short: string; help: string }> = {
  producto: { title: 'Qué querés cotizar', short: 'Producto', help: 'Elegí el sistema. Los que dicen "Próximamente" se van sumando al cotizador.' },
  medidas: { title: 'Medidas del rack', short: 'Medidas', help: 'Alto, profundidad y largo de viga. Si una parte del rack tiene otra altura u otro largo de viga, activá "Tramos con medidas distintas".' },
  carga: { title: 'Pallet y carga', short: 'Carga', help: 'El pallet define cuántos entran por módulo. Si el cliente usa uno especial, elegí "A medida" y cargá sus medidas.' },
  estructura: { title: 'Estructura y distribución', short: 'Estructura', help: 'El parante y la viga se eligen solos según la carga. Si querés otro, elegilo y el cotizador te avisa si no alcanza.' },
  accesorios: { title: 'Accesorios', short: 'Accesorios', help: 'Protección, seguridad y piso de los niveles. Cada accesorio suma sus piezas a la lista de materiales.' },
  resumen: { title: 'Resumen y materiales', short: 'Resumen', help: 'Todas las piezas que lleva el rack. Desde acá se pide el presupuesto o se agrega al almacén.' },
}

/** Qué puede hacer el resumen. Sin onWarehouse (cotizador suelto o sin permiso) no aparece "Agregar al almacén". */
export interface PanelActions { onQuote(): void; onWarehouse?: () => void; quoteLabel?: string }

export function CotizadorPanel({ s, actions }: { s: RackStructure; actions: PanelActions }) {
  const { mode, setMode } = useDesigner()
  return (
    <section className="designer__panel cotizador" aria-label="Cotizador">
      <Segmented label="Modo del panel" value={mode} onChange={setMode}
        options={[{ value: 'guiado', label: 'Paso a paso' }, { value: 'todo', label: 'Ver todo' }]} />
      {mode === 'guiado'
        ? <Guided s={s} actions={actions} />
        : STEPS.filter((id) => id !== 'producto').map((id) => (
          <div key={id} className="cot-block">
            <h2 className="section-label">{META[id].short}</h2>
            <StepBody id={id} s={s} actions={actions} />
          </div>
        ))}
    </section>
  )
}

function Guided({ s, actions }: { s: RackStructure; actions: PanelActions }) {
  const { step, goTo } = useDesigner()
  const i = STEPS.indexOf(step)
  const next = STEPS[i + 1]
  return (
    <>
      <ol className="cot-steps" aria-label="Pasos">
        {STEPS.map((id, j) => (
          <li key={id}>
            <button type="button" className={`cot-step${j === i ? ' is-current' : ''}${j < i ? ' is-done' : ''}`} aria-current={j === i ? 'step' : undefined} onClick={() => goTo(id)} title={META[id].title}>
              <span className="cot-step__n">{j + 1}</span>
              <span className="cot-step__t">{META[id].short}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="cot-head">
        <span className="cot-head__k">Paso {i + 1} de {STEPS.length}</span>
        <h2 className="cot-head__t">{META[step].title}</h2>
      </div>
      <p className="cot-help"><Lightbulb size={16} aria-hidden /><span>{META[step].help}</span></p>
      <StepBody id={step} s={s} actions={actions} />
      <div className="cot-nav">
        <Button variant="ghost" icon={ChevronLeft} disabled={i === 0} onClick={() => goTo(STEPS[i - 1])}>Anterior</Button>
        {next && <Button variant="primary" onClick={() => goTo(next)}>{META[next].short} <ChevronRight size={16} aria-hidden /></Button>}
      </div>
    </>
  )
}

function StepBody({ id, s, actions }: { id: StepId; s: RackStructure; actions: PanelActions }) {
  switch (id) {
    case 'producto': return <ProductStep />
    case 'medidas': return <DimensionsStep s={s} />
    case 'carga': return <LoadStep s={s} />
    case 'estructura': return <StructureStep s={s} />
    case 'accesorios': return <AccessoriesStep s={s} />
    case 'resumen': return <SummaryStep s={s} actions={actions} />
  }
}

/* ------------------------------ 1. Producto ------------------------------ */

function ProductStep() {
  const { productId, setProduct, goTo } = useDesigner()
  const groups = [...new Set(PRODUCT_TYPES.map((p) => p.group))] as ProductGroup[]
  return (
    <div className="cot-products">
      {groups.map((g) => (
        <div key={g} className="cot-products__group">
          <h3 className="cot-products__title">{g}</h3>
          {PRODUCT_TYPES.filter((p) => p.group === g).map((p) => (
            <button key={p.id} type="button" disabled={!p.available}
              className={`cot-product${productId === p.id ? ' is-selected' : ''}`}
              aria-pressed={productId === p.id}
              onClick={() => { setProduct(p.id); goTo('medidas') }}>
              <span className="cot-product__name">{p.name}{!p.available && <Badge>Próximamente</Badge>}</span>
              <span className="cot-product__summary">{p.summary}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------ 2. Medidas ------------------------------ */

function DimensionsStep({ s }: { s: RackStructure }) {
  const { config, update, setSections } = useDesigner()
  const multi = (config.sections?.length ?? 0) > 0
  const minLevels = config.floorStorage ? 2 : 1
  const toggleSections = (on: boolean) => {
    if (on) setSections([{ modules: s.modulesPerRow, width: s.config.width, height: s.config.height, levels: s.config.levels }])
    // al volver a un rack uniforme se conservan las medidas del primer tramo y las posiciones que había
    else update({ sections: [], width: s.sections[0].width, height: s.sections[0].height, levels: s.sections[0].levels, positions: s.positionsAvailable })
  }
  return (
    <div className="cot-fields">
      <NumberStepper label="Profundidad del bastidor" unit="mm" value={config.depth} min={L.depth.min} max={L.depth.max} step={50} slider onChange={(depth) => update({ depth })} />
      <Switch label="Tramos con medidas distintas" checked={multi} onChange={toggleSections}
        hint="Partes del rack con otra altura, otro largo de viga u otra cantidad de niveles." />
      {multi ? <Sections s={s} /> : <>
        <NumberStepper label="Largo de viga (ancho del módulo)" unit="mm" value={config.width} min={L.width.min} max={L.width.max} step={50} slider onChange={(width) => update({ width })} />
        <NumberStepper label="Altura" unit="mm" value={config.height} min={L.height.min} max={L.height.max} step={100} slider onChange={(height) => update({ height })}
          hint={config.height > OFFICIAL_REFERENCE.maxHeight ? <span className="late">Supera los {mm(OFFICIAL_REFERENCE.maxHeight)} publicados.</span> : undefined} />
        <NumberStepper label="Cantidad de posiciones" value={config.positions} min={L.positions.min} max={L.positions.max} step={1} slider onChange={(positions) => update({ positions })}
          hint={`${plural(s.palletsPerModule * s.storageLevels, 'posición', 'posiciones')} por módulo · crece hacia la derecha`} />
        <Field label="Niveles de almacenamiento">{() => (
          <Segmented label="Niveles" value={String(config.levels)} onChange={(v) => update({ levels: Number(v) })}
            options={Array.from({ length: L.levels.max }, (_, i) => i + 1).filter((n) => n >= minLevels).map((n) => ({ value: String(n), label: String(n) }))} />
        )}</Field>
      </>}
      <Switch label="Usar el piso como primer nivel" checked={config.floorStorage}
        onChange={(floorStorage) => update({
          floorStorage,
          levels: Math.max(config.levels, floorStorage ? 2 : 1),
          sections: (config.sections ?? []).map((x) => ({ ...x, levels: Math.max(x.levels, floorStorage ? 2 : 1) })),
        })}
        hint={`${plural(s.beamLevels, 'plano', 'planos')} de vigas`} />
    </div>
  )
}

function Sections({ s }: { s: RackStructure }) {
  const { config, updateSection, addSection, duplicateSection, removeSection } = useDesigner()
  const sections = config.sections ?? []
  const minLevels = config.floorStorage ? 2 : 1
  return (
    <div className="cot-sections">
      {sections.map((sec, i) => {
        const mod = s.modules.find((m) => m.section === i && m.row === 0)
        const positions = mod ? sec.modules * mod.palletsPerModule * sec.levels : 0
        return (
          <div key={i} className="cot-section">
            <div className="cot-section__head">
              <strong>Tramo {i + 1}</strong>
              <span className="muted small">{plural(positions, 'posición', 'posiciones')}{mod && ` · ${mod.beam.name}`}</span>
              <span className="cot-section__tools">
                <button type="button" className="icon-btn" onClick={() => duplicateSection(i)} aria-label={`Duplicar tramo ${i + 1}`} title="Duplicar"><Copy size={15} /></button>
                {sections.length > 1 && <button type="button" className="icon-btn" onClick={() => removeSection(i)} aria-label={`Quitar tramo ${i + 1}`} title="Quitar"><Trash2 size={15} /></button>}
              </span>
            </div>
            <NumberStepper label="Módulos" value={sec.modules} min={L.sectionModules.min} max={L.sectionModules.max} step={1} onChange={(modules) => updateSection(i, { modules })} />
            <NumberStepper label="Largo de viga" unit="mm" value={sec.width} min={L.width.min} max={L.width.max} step={50} onChange={(width) => updateSection(i, { width })} />
            <NumberStepper label="Altura" unit="mm" value={sec.height} min={L.height.min} max={L.height.max} step={100} onChange={(height) => updateSection(i, { height })} />
            <NumberStepper label="Niveles" value={sec.levels} min={minLevels} max={L.levels.max} step={1} onChange={(levels) => updateSection(i, { levels })} />
          </div>
        )
      })}
      {sections.length < L.sections.max && <Button icon={Plus} onClick={addSection} block>Agregar tramo</Button>}
    </div>
  )
}

/* ------------------------------ 3. Pallet y carga ------------------------------ */

export function LoadStep({ s }: { s: RackStructure }) {
  const { config, update } = useDesigner()
  const custom = config.palletTypeId === 'custom'
  const cp = config.customPallet ?? { front: 1000, deep: 1200, height: 144 }
  return (
    <div className="cot-fields">
      <Field label="Tipo de pallet">{(id) => (
        <Select id={id} value={config.palletTypeId} onChange={(e) => update({ palletTypeId: e.target.value })}>
          {PALLET_TYPES.map((p) => <option key={p.id} value={p.id}>{p.name} mm</option>)}
          <option value="custom">A medida…</option>
        </Select>
      )}</Field>
      {custom && <div className="cot-inline">
        <NumberStepper label="Frente" unit="mm" value={cp.front} min={L.palletFront.min} max={L.palletFront.max} step={10} onChange={(front) => update({ customPallet: { ...cp, front } })} />
        <NumberStepper label="Fondo" unit="mm" value={cp.deep} min={L.palletDeep.min} max={L.palletDeep.max} step={10} onChange={(deep) => update({ customPallet: { ...cp, deep } })} />
        <NumberStepper label="Alto del pallet" unit="mm" value={cp.height} min={L.palletHeight.min} max={L.palletHeight.max} step={5} onChange={(height) => update({ customPallet: { ...cp, height } })} />
      </div>}
      <NumberStepper label="Carga por pallet" unit="kg" value={config.palletWeight} min={L.palletWeight.min} max={L.palletWeight.max} step={50} onChange={(palletWeight) => update({ palletWeight })}
        hint={config.palletWeight > OFFICIAL_REFERENCE.maxPalletWeight ? <span className="late">Supera la referencia de {kg(OFFICIAL_REFERENCE.maxPalletWeight)}.</span> : `Referencia publicada: hasta ${kg(OFFICIAL_REFERENCE.maxPalletWeight)} por pallet.`} />
      <Field label="Pallets por módulo" hint={`${plural(s.palletsPerLevel, 'pallet', 'pallets')} por nivel en todo el rack`}>{() => (
        <Segmented label="Pallets por módulo" value={String(config.palletsPerModule)} onChange={(v) => update({ palletsPerModule: v === 'auto' ? 'auto' : Number(v) })}
          options={[{ value: 'auto', label: 'Auto' }, ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))]} />
      )}</Field>
    </div>
  )
}

/* ------------------------------ 4. Estructura ------------------------------ */

function StructureStep({ s }: { s: RackStructure }) {
  const { config, update, updateLayout } = useDesigner()
  const autoUpright = config.uprightId === 'auto' || !config.uprightId
  const autoBeam = config.beamId === 'auto' || !config.beamId
  return (
    <div className="cot-fields">
      <Field label="Parante" hint={autoUpright ? `Automático: ${s.upright.name}. El bastidor más cargado lleva ${kg(s.maxFrameLoad)}.` : `El bastidor más cargado lleva ${kg(s.maxFrameLoad)}.`}>{(id) => (
        <Select id={id} value={config.uprightId ?? 'auto'} onChange={(e) => update({ uprightId: e.target.value })}>
          <option value="auto">Automático (el más liviano que alcanza)</option>
          {UPRIGHT_PROFILES.map((u) => <option key={u.id} value={u.id}>{u.name} · hasta {kg(u.maxFrameLoad)}</option>)}
        </Select>
      )}</Field>
      <Field label="Viga" hint={autoBeam ? `Automático: se elige por tramo según la luz y la carga del nivel (${kg(s.levelLoad)}).` : `Carga por nivel: ${kg(s.levelLoad)}.`}>{(id) => (
        <Select id={id} value={config.beamId ?? 'auto'} onChange={(e) => update({ beamId: e.target.value })}>
          <option value="auto">Automática (la más liviana que alcanza)</option>
          {BEAM_PROFILES.map((b) => <option key={b.id} value={b.id}>{b.name} · {kg(beamCapacityForSpan(b, s.config.width))} con {mm(s.config.width)}</option>)}
        </Select>
      )}</Field>
      <NumberStepper label="Filas de rack" value={config.layout.rows} min={L.rows.min} max={L.rows.max} step={1} onChange={(rows) => updateLayout({ rows })} />
      {config.layout.rows > 1 && <>
        <NumberStepper label="Ancho de pasillo" unit="mm" value={config.layout.aisleWidth} min={L.aisleWidth.min} max={L.aisleWidth.max} step={100} onChange={(aisleWidth) => updateLayout({ aisleWidth })} />
        <Switch label="Filas espalda con espalda" checked={config.layout.backToBack} onChange={(backToBack) => updateLayout({ backToBack })}
          hint="Dos filas unidas por la espalda con distanciadores: un solo pasillo para las dos." />
      </>}
      <KeyValue items={[
        ['Módulos por fila', fmt(s.modulesPerRow)],
        ['Bastidores', fmt(s.counts.frames)],
        ['Vigas', fmt(s.counts.beams)],
        ['Posiciones totales', fmt(s.positionsAvailable)],
        ['Medidas', `${fmt(s.totalWidth)} × ${fmt(s.totalDepth)} × ${fmt(s.config.height)} mm`],
      ]} />
    </div>
  )
}

/* ------------------------------ 5. Accesorios ------------------------------ */

/** Accesorios. En el depósito, `counts` trae las cantidades de todos los racks juntos. */
export function AccessoriesStep({ s, counts, multiRow }: { s: RackStructure; counts?: ComponentCounts; multiRow?: boolean }) {
  const { updateAccessories, config } = useDesigner()
  const a = s.accessories
  const c = counts ?? s.counts
  const set = (patch: Partial<AccessoryConfig>) => updateAccessories(patch)
  const qty = (n: number) => (n ? ` · ${plural(n, 'pieza', 'piezas')}` : '')
  return (
    <div className="cot-fields">
      <Field label="Protectores de columna" hint={`Del lado del pasillo, contra golpes de autoelevador${qty(c.protectors)}.`}>{() => (
        <Segmented label="Protectores" value={a.protectors} onChange={(protectors) => set({ protectors })}
          options={[{ value: 'none', label: 'Sin' }, { value: 'ends', label: 'Extremos' }, { value: 'all', label: 'Todos' }]} />
      )}</Field>
      <Switch label="Guardarraíles de cabecera" checked={a.guardrails} onChange={(guardrails) => set({ guardrails })}
        hint={`Barrera en los extremos de cada fila${qty(c.guardrails)}.`} />
      <Switch label="Conectores superiores" checked={a.topTies} onChange={(topTies) => set({ topTies })}
        hint={(multiRow ?? config.layout.rows > 1) ? `Unen las filas por arriba y les dan rigidez${qty(c.topTies)}.` : 'Unen filas entre sí: sirven con dos filas o más.'} />
      <Switch label="Cruces de arriostramiento" checked={a.crossBracing} onChange={(crossBracing) => set({ crossBracing })}
        hint={`Cruz en la cara posterior, una cada ${DESIGN_RULES.modulesPerCrossBrace} módulos${qty(c.crossBraces)}.`} />
      <Switch label="Carteles de capacidad" checked={a.capacitySigns} onChange={(capacitySigns) => set({ capacitySigns })}
        hint={`Uno por módulo con la carga máxima por nivel${qty(c.capacitySigns)}.`} />
      <Field label="Piso en los niveles" hint={`Para mercadería suelta o pallets que no apoyan bien${qty(c.deckPanels)}.`}>{() => (
        <Segmented label="Piso" value={a.decking} onChange={(decking) => set({ decking })}
          options={[{ value: 'none', label: 'Sin piso' }, { value: 'wood', label: 'Madera' }, { value: 'mesh', label: 'Malla' }]} />
      )}</Field>
      <Switch label="Travesaños de apoyo de pallet" checked={a.palletSupports} onChange={(palletSupports) => set({ palletSupports })}
        hint={`Refuerzo de viga a viga debajo de cada pallet${qty(c.palletSupports)}.`} />
      {c.spacers > 0 && <p className="note note--blue">Las filas espalda con espalda llevan {plural(c.spacers, 'distanciador', 'distanciadores')} (se suman solos).</p>}
    </div>
  )
}

/* ------------------------------ 6. Resumen ------------------------------ */

function SummaryStep({ s, actions }: { s: RackStructure; actions: PanelActions }) {
  const multi = s.sections.length > 1
  return (
    <div className="cot-fields">
      <MaterialsList lines={s.materials} />
      <Button icon={Download} onClick={() => downloadMaterials(s.materials, `materiales-rack-${s.positionsAvailable}-posiciones`)} block>Descargar lista (CSV)</Button>
      <Button variant="primary" icon={Calculator} onClick={actions.onQuote} block>{actions.quoteLabel ?? 'Solicitar presupuesto'}</Button>
      {actions.onWarehouse && (
        <Button icon={Warehouse} onClick={actions.onWarehouse} block disabled={multi}
          title={multi ? 'Por ahora el almacén acepta racks de un solo tramo' : undefined}>Agregar al almacén</Button>
      )}
      {multi && actions.onWarehouse && <p className="muted small">Por ahora sólo los racks de un tramo se pueden agregar al mapa del almacén.</p>}
    </div>
  )
}

const money = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })

export function MaterialsList({ lines }: { lines: MaterialLine[] }) {
  const total = materialsTotal(lines)
  const groups = ['Estructura', 'Fijación', 'Accesorios'] as const
  return (
    <div className="bom">
      {groups.map((g) => {
        const ls = lines.filter((l) => l.group === g)
        if (!ls.length) return null
        return (
          <div key={g} className="bom__group">
            <h3 className="bom__title">{g}</h3>
            <ul>
              {ls.map((l) => (
                <li key={l.code} className="bom__line">
                  <span className="bom__name">{l.name}{l.detail && <small>{l.detail}</small>}</span>
                  <span className="bom__qty">{fmt(l.qty)}{l.unitPrice !== undefined && <small>{money(l.unitPrice * l.qty)}</small>}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      {total !== null
        ? <p className="bom__total"><span>Total estimado</span><strong>{money(total)}</strong></p>
        : <p className="bom__note">Sin precios cargados: el presupuesto se arma con esta lista de materiales.</p>}
    </div>
  )
}

/** Descarga la lista de materiales como CSV (se abre en Excel). */
export function downloadMaterials(lines: MaterialLine[], name: string) {
  const rows = [['Grupo', 'Código', 'Pieza', 'Detalle', 'Cantidad'], ...lines.map((l) => [l.group, l.code, l.name, l.detail ?? '', String(l.qty)])]
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
