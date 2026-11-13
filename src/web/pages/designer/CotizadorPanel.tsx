/**
 * PANEL DEL COTIZADOR (columna izquierda). Dos formas de usarlo:
 *  - Paso a paso: un paso por vez, con una ayuda corta y Anterior / Siguiente.
 *  - Ver todo: todas las opciones juntas, para quien ya sabe qué quiere.
 * Cada cambio rearma la estructura y el 3D al instante.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Calculator, ChevronLeft, ChevronRight, Copy, Download, Lightbulb, Plus, Trash2, Warehouse } from 'lucide-react'
import { PRODUCT_TYPES, type ProductGroup } from '../../../shared/catalog'
import { materialsTotal } from '../../../shared/rack/bom'
import { beamCapacityForSpan } from '../../../shared/rack/rules'
import { colorName, DESIGN_RULES, GALVANIZED, OFFICIAL_REFERENCE, PAINT_COLORS, PALLET_TYPES } from '../../../shared/rack/technicalSpecs'
import type { AccessoryConfig, ComponentCounts, MaterialLine, RackStructure } from '../../../shared/rack/types'

import { NumberStepper, Switch } from '../../components/fields'
import { Badge, Button, Field, KeyValue, Segmented, Select } from '../../components/ui'
import { fmt, plural } from '../../lib/format'
import { STEPS, useDesigner, type StepId } from './designerStore'
import { metros } from '../../../shared/units'
import { profilesOf } from '../../../shared/rack/profiles'
import { loadOf, PALLET_TARE, stackBoxes } from '../../../shared/rack/load'

const L = DESIGN_RULES.limits
const mm = metros
const kg = (n: number) => `${fmt(n)} kg`

const META: Record<StepId, { title: string; short: string; help: string }> = {
  producto: { title: 'Qué querés cotizar', short: 'Producto', help: 'Elegí el sistema. Los que dicen "Próximamente" se van sumando al sistema.' },
  medidas: { title: 'Medidas del rack', short: 'Medidas', help: 'Alto, profundidad y largo de viga. Si una parte del rack tiene otra altura u otro largo de viga, activá "Tramos con medidas distintas".' },
  carga: { title: 'Pallet y carga', short: 'Carga', help: 'El pallet define cuántos entran por módulo. Si el cliente usa uno especial, elegí "A medida" y cargá sus medidas.' },
  estructura: { title: 'Estructura y distribución', short: 'Estructura', help: 'El parante y la viga se eligen solos según la carga. Si querés otro, elegilo y el sistema te avisa si no alcanza.' },
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
      <NumberStepper label="Profundidad del bastidor" meters value={config.depth} min={L.depth.min} max={L.depth.max} step={50} typedStep={10} slider onChange={(depth) => update({ depth })} />
      <Switch label="Tramos con medidas distintas" checked={multi} onChange={toggleSections}
        hint="Partes del rack con otra altura, otro largo de viga u otra cantidad de niveles." />
      {multi ? <Sections s={s} /> : <>
        <NumberStepper label="Largo de viga (ancho del módulo)" meters value={config.width} min={L.width.min} max={L.width.max} step={50} typedStep={10} slider onChange={(width) => update({ width })} />
        <NumberStepper label="Altura" meters value={config.height} min={L.height.min} max={L.height.max} step={100} typedStep={10} slider onChange={(height) => update({ height })}
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
            <NumberStepper label="Largo de viga" meters value={sec.width} min={L.width.min} max={L.width.max} step={50} typedStep={10} onChange={(width) => updateSection(i, { width })} />
            <NumberStepper label="Altura" meters value={sec.height} min={L.height.min} max={L.height.max} step={100} typedStep={10} onChange={(height) => updateSection(i, { height })} />
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
          {PALLET_TYPES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="custom">A medida…</option>
        </Select>
      )}</Field>
      {custom && <div className="cot-inline">
        <NumberStepper label="Frente" meters value={cp.front} min={L.palletFront.min} max={L.palletFront.max} step={10} onChange={(front) => update({ customPallet: { ...cp, front } })} />
        <NumberStepper label="Fondo" meters value={cp.deep} min={L.palletDeep.min} max={L.palletDeep.max} step={10} onChange={(deep) => update({ customPallet: { ...cp, deep } })} />
        <NumberStepper label="Alto del pallet" meters value={cp.height} min={L.palletHeight.min} max={L.palletHeight.max} step={5} onChange={(height) => update({ customPallet: { ...cp, height } })} />
      </div>}
      <LoadEditor s={s} />
      {loadOf(config).mode !== 'boxes' && <NumberStepper label="Carga por pallet" unit="kg" value={config.palletWeight} min={L.palletWeight.min} max={L.palletWeight.max} step={50} onChange={(palletWeight) => update({ palletWeight })}
        hint={config.palletWeight > OFFICIAL_REFERENCE.maxPalletWeight ? <span className="late">Supera la referencia de {kg(OFFICIAL_REFERENCE.maxPalletWeight)}.</span> : `Referencia publicada: hasta ${kg(OFFICIAL_REFERENCE.maxPalletWeight)} por pallet.`} />}
      <Field label="Pallets por módulo" hint={`${plural(s.palletsPerLevel, 'pallet', 'pallets')} por nivel en todo el rack`}>{() => (
        <Segmented label="Pallets por módulo" value={String(config.palletsPerModule)} onChange={(v) => update({ palletsPerModule: v === 'auto' ? 'auto' : Number(v) })}
          options={[{ value: 'auto', label: 'Auto' }, ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))]} />
      )}</Field>
    </div>
  )
}

/* ------------------------------ Altura de cada viga ------------------------------ */

/**
 * Edición fina: la altura de cada plano de vigas (desde el piso), uno por uno. Tocando una viga en
 * el 3D se elige acá. "Repartir parejas" vuelve a la distribución automática.
 */
export function BeamHeights({ s }: { s: RackStructure }) {
  const { config, update, pickedBeam, pickBeam } = useDesigner()
  const levels = s.rows[0]?.modules[0]?.levels ?? []
  const beams = levels.filter((l) => l.hasBeam)
  const custom = !!config.beamElevations && config.beamElevations.length === beams.length
  // al tocar una viga en el 3D, su campo queda a la vista
  useEffect(() => { if (pickedBeam !== null) document.querySelector('.beam-heights__row.is-picked')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [pickedBeam])
  const setAt = (i: number, v: number) => {
    const arr = beams.map((b) => b.elevation)
    arr[i] = v
    // las de arriba no pueden quedar por debajo: se corren lo justo
    for (let k = i + 1; k < arr.length; k++) arr[k] = Math.max(arr[k], arr[k - 1] + 200)
    update({ beamElevations: arr })
  }
  return (
    <details className="plan-more beam-heights" open={pickedBeam !== null || custom}>
      <summary>Altura de cada viga{custom ? ' (a mano)' : ''}</summary>
      <p className="muted small">De abajo hacia arriba, medida desde el piso hasta la viga. También podés tocar una viga en el 3D.</p>
      {beams.map((b, i) => {
        const lv = levels[b.index]
        return (
          <div key={b.index} className={`beam-heights__row beam-heights__row--x${pickedBeam === i ? ' is-picked' : ''}`} onFocusCapture={() => pickBeam(i)}>
            <NumberStepper label={`Viga ${i + 1}${i === beams.length - 1 ? ' (la de arriba)' : ''}`} meters value={b.elevation} min={50} max={s.config.height} step={50} typedStep={50}
              onChange={(v) => setAt(i, v)}
              hint={Number.isFinite(lv.clearHeight) ? `Libre hasta la viga de arriba: ${metros(lv.clearHeight)}` : undefined} />
            {/* sacar esta viga: queda un nivel menos (las demás no se mueven) */}
            <button type="button" className="rack-part__x" disabled={beams.length <= 1} aria-label={`Sacar la viga ${i + 1}`}
              title={beams.length <= 1 ? 'Es la última viga' : 'Sacar esta viga (queda un nivel menos)'}
              onClick={() => { update({ levels: config.levels - 1, beamElevations: beams.filter((_, k) => k !== i).map((x) => x.elevation) }); pickBeam(null) }}>
              <Trash2 size={15} aria-hidden />
            </button>
          </div>
        )
      })}
      {custom && <Button size="sm" variant="ghost" onClick={() => { update({ beamElevations: undefined }); pickBeam(null) }}>Repartir parejas otra vez</Button>}
      <p className="muted small">Esto vale para todos los módulos. Para sacarle una viga a un módulo solo (por ejemplo, para que pase el autoelevador), andá a Distribución, tocá el rack y elegí el módulo.</p>
    </details>
  )
}

/* ------------------------------ La carga: bloque o cajas apiladas ------------------------------ */

/** Cómo es la carga del pallet: un bloque, o cajas que se apilan solas sobre la tarima. */
function LoadEditor({ s }: { s: RackStructure }) {
  const { config, update } = useDesigner()
  const load = loadOf(config)
  const stack = stackBoxes(s.pallet, load)
  // alto libre en cada nivel (sobre la tarima): las capas que no entran no se ponen
  const frees = s.rows[0]?.modules[0]?.levels.map((l) => l.loadHeight).filter((h) => h > 0) ?? []
  const free = frees.length ? Math.min(...frees) : 0
  const fitLayers = Math.min(stack.layers, Math.floor(free / Math.max(1, load.boxH)))
  const set = (patch: Partial<typeof load>) => {
    const next = { ...load, ...patch }
    const st = stackBoxes(s.pallet, next)
    // con cajas, el peso del pallet sale de las cajas (más la tarima)
    update({ load: next, ...(next.mode === 'boxes' ? { palletWeight: Math.max(L.palletWeight.min, Math.min(L.palletWeight.max, st.weight + PALLET_TARE)) } : {}) })
  }
  return <>
    <Field label="Cómo es la carga">{() => (
      <Segmented label="Cómo es la carga" value={load.mode} onChange={(mode) => set({ mode })}
        options={[{ value: 'block', label: 'Un bloque' }, { value: 'boxes', label: 'Cajas apiladas' }]} />
    )}</Field>
    {load.mode === 'boxes' && <>
      <div className="cot-inline">
        <NumberStepper label="Ancho de la caja" meters value={load.boxW} min={50} max={2000} step={50} typedStep={10} onChange={(boxW) => set({ boxW })} />
        <NumberStepper label="Fondo de la caja" meters value={load.boxD} min={50} max={2000} step={50} typedStep={10} onChange={(boxD) => set({ boxD })} />
      </div>
      <div className="cot-inline">
        <NumberStepper label="Alto de la caja" meters value={load.boxH} min={50} max={2000} step={50} typedStep={10} onChange={(boxH) => set({ boxH })} />
        <NumberStepper label="Peso de cada caja" unit="kg" value={load.boxKg} min={1} max={500} step={1} onChange={(boxKg) => set({ boxKg })} />
      </div>
      <NumberStepper label="Alto máximo de la carga" meters value={load.maxHeight} min={200} max={3000} step={100} typedStep={10} onChange={(maxHeight) => set({ maxHeight })}
        hint={free ? `Cada nivel del rack deja ${metros(free)} libres arriba del pallet.` : undefined} />
      <LoadDiagram pallet={s.pallet} stack={stack} boxH={load.boxH} fitLayers={fitLayers} />
      <KeyValue items={[
        ['Cajas por capa', stack.perLayer ? `${stack.perLayer} (${stack.cols} × ${stack.rows}${stack.rotated ? ', giradas' : ''})` : 'no entra ninguna'],
        ['Capas', fmt(stack.layers)],
        ['Cajas por pallet', fmt(stack.total)],
        ['Alto de la carga', metros(stack.height)],
        ['Peso por pallet', `${kg(stack.weight + PALLET_TARE)} (con la tarima)`],
      ]} />
      {stack.perLayer === 0 && <p className="note note--amber">La caja es más grande que el pallet: no entra ninguna.</p>}
      {stack.layers > fitLayers && stack.perLayer > 0 && (
        <p className="note note--amber">Las cajas llegan a {metros(stack.height)} y en cada nivel hay {metros(free)} libres: entran {fitLayers} {fitLayers === 1 ? 'capa' : 'capas'}. Bajá el alto máximo, o poné menos niveles o más alto el rack.</p>
      )}
      {stack.weight + PALLET_TARE > OFFICIAL_REFERENCE.maxPalletWeight && <p className="note note--amber">El pallet pesa {kg(stack.weight + PALLET_TARE)}: supera la referencia de {kg(OFFICIAL_REFERENCE.maxPalletWeight)}.</p>}
    </>}
  </>
}

/** Dibujo de la carga: vista de arriba (cómo van las cajas en la tarima) y de costado (las capas). */
function LoadDiagram({ pallet, stack, boxH, fitLayers }: { pallet: { front: number; deep: number; height: number }; stack: ReturnType<typeof stackBoxes>; boxH: number; fitLayers: number }) {
  const k = 130 / Math.max(pallet.front, pallet.deep)
  const PW = pallet.front * k, PD = pallet.deep * k
  const ox = (PW - stack.cols * stack.w * k) / 2, oz = (PD - stack.rows * stack.d * k) / 2
  const shown = Math.min(stack.layers, 10)
  const sideK = Math.min(k, 120 / Math.max(1, shown * boxH + pallet.height))
  const SW = pallet.front * sideK, PH = pallet.height * sideK, BH = boxH * sideK
  return (
    <div className="load-diagram" aria-label="Dibujo de cómo van las cajas">
      <figure>
        <svg width={PW + 2} height={PD + 2} viewBox={`-1 -1 ${PW + 2} ${PD + 2}`}>
          <rect width={PW} height={PD} fill="#e8c9a0" stroke="#8a5a2b" />
          {Array.from({ length: stack.cols * stack.rows }, (_, n) => {
            const i = n % stack.cols, j = Math.floor(n / stack.cols)
            return <rect key={n} x={ox + i * stack.w * k + 0.6} y={oz + j * stack.d * k + 0.6} width={stack.w * k - 1.2} height={stack.d * k - 1.2} fill="#d9a86c" stroke="#7a5230" strokeWidth={0.8} />
          })}
        </svg>
        <figcaption>De arriba</figcaption>
      </figure>
      <figure>
        <svg width={SW + 2} height={PH + shown * BH + 2} viewBox={`-1 -1 ${SW + 2} ${PH + shown * BH + 2}`}>
          {Array.from({ length: shown }, (_, l) => (
            <g key={l} opacity={l < fitLayers ? 1 : 0.3}>
              {Array.from({ length: stack.cols }, (_, i) => (
                <rect key={i} x={(SW - stack.cols * stack.w * sideK) / 2 + i * stack.w * sideK + 0.5} y={(shown - 1 - l) * BH + 0.5} width={stack.w * sideK - 1} height={BH - 1} fill="#d9a86c" stroke="#7a5230" strokeWidth={0.8} />
              ))}
            </g>
          ))}
          <rect x={0} y={shown * BH} width={SW} height={PH} fill="#b07a45" />
        </svg>
        <figcaption>De costado{stack.layers > fitLayers ? ' (en claro, lo que no entra)' : ''}</figcaption>
      </figure>
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
          {profilesOf(config).uprights.map((u) => <option key={u.id} value={u.id}>{u.name} · hasta {kg(u.maxFrameLoad)}</option>)}
        </Select>
      )}</Field>
      <Field label="Viga" hint={autoBeam ? `Automático: se elige por tramo según la luz y la carga del nivel (${kg(s.levelLoad)}).` : `Carga por nivel: ${kg(s.levelLoad)}.`}>{(id) => (
        <Select id={id} value={config.beamId ?? 'auto'} onChange={(e) => update({ beamId: e.target.value })}>
          <option value="auto">Automática (la más liviana que alcanza)</option>
          {profilesOf(config).beams.map((b) => <option key={b.id} value={b.id}>{b.name} · {kg(beamCapacityForSpan(b, s.config.width))} con {mm(s.config.width)}</option>)}
        </Select>
      )}</Field>
      <NumberStepper label="Filas de rack" value={config.layout.rows} min={L.rows.min} max={L.rows.max} step={1} onChange={(rows) => updateLayout({ rows })} />
      {config.layout.rows > 1 && <>
        <NumberStepper label="Ancho de pasillo" meters value={config.layout.aisleWidth} min={L.aisleWidth.min} max={L.aisleWidth.max} step={100} onChange={(aisleWidth) => updateLayout({ aisleWidth })} />
        <Switch label="Filas espalda con espalda" checked={config.layout.backToBack} onChange={(backToBack) => updateLayout({ backToBack })}
          hint="Dos filas unidas por la espalda con distanciadores: un solo pasillo para las dos." />
      </>}
      <KeyValue items={[
        ['Módulos por fila', fmt(s.modulesPerRow)],
        ['Bastidores', fmt(s.counts.frames)],
        ['Vigas', fmt(s.counts.beams)],
        ['Posiciones totales', fmt(s.positionsAvailable)],
        ['Medidas', `${metros(s.totalWidth)} × ${metros(s.totalDepth)} × ${metros(s.config.height)}`],
      ]} />
    </div>
  )
}

/* ------------------------------ 5. Accesorios ------------------------------ */

/**
 * Accesorios, en grupos que se abren y se cierran: a la vista queda la protección (lo de todos los
 * días) y lo demás plegado, con un resumen de lo elegido. En el depósito, `counts` trae las
 * cantidades de todos los racks juntos.
 */
export function AccessoriesStep({ s, counts, multiRow }: { s: RackStructure; counts?: ComponentCounts; multiRow?: boolean }) {
  const { updateAccessories, config } = useDesigner()
  const a = s.accessories
  const c = counts ?? s.counts
  const set = (patch: Partial<AccessoryConfig>) => updateAccessories(patch)
  const qty = (n: number) => (n ? ` · ${plural(n, 'pieza', 'piezas')}` : '')
  const on = (...flags: boolean[]) => { const n = flags.filter(Boolean).length; return n ? `${n} ${n === 1 ? 'elegido' : 'elegidos'}` : 'nada elegido' }
  return (
    <div className="cot-fields">
      <AccGroup title="Protección" summary={on(a.protectors !== 'none', a.guardrails)} defaultOpen>
        <Field label="Protectores de columna" hint={`Del lado del pasillo, contra golpes de autoelevador${qty(c.protectors)}.`}>{() => (
          <Segmented label="Protectores" value={a.protectors} onChange={(protectors) => set({ protectors })}
            options={[{ value: 'none', label: 'Sin' }, { value: 'ends', label: 'Extremos' }, { value: 'all', label: 'Todos' }]} />
        )}</Field>
        {a.protectors !== 'none' && (
          <Field label="Tipo de protector" hint={{ angulo: 'Chapa plegada con la punta en V, abulonada al piso.', u: 'Chapa en U que envuelve el parante, abulonada al piso.', poste: 'Poste de tubo cuadrado delante del parante, con su placa al piso.', bajo: 'Protector petiso de seis caras, abulonado al piso.' }[a.protectorType]}>{() => (
            <Segmented label="Tipo de protector" value={a.protectorType} onChange={(protectorType) => set({ protectorType })}
              options={[{ value: 'angulo', label: 'En ángulo' }, { value: 'u', label: 'En U' }, { value: 'poste', label: 'Poste' }, { value: 'bajo', label: 'Bajo' }]} />
          )}</Field>
        )}
        <Switch label="Defensas de cabecera" checked={a.guardrails} onChange={(guardrails) => set({ guardrails })}
          hint={`Barrera en los extremos de cada fila${qty(c.guardrails)}.`} />
        {a.guardrails && (
          <Field label="Tipo de defensa" hint={a.guardrailType === 'arco' ? 'Marco de tubo en arco delante de la cabecera.' : 'Dos postes con una baranda de tres largueros.'}>{() => (
            <Segmented label="Tipo de defensa" value={a.guardrailType} onChange={(guardrailType) => set({ guardrailType })}
              options={[{ value: 'baranda', label: 'Baranda' }, { value: 'arco', label: 'Arco' }]} />
          )}</Field>
        )}
      </AccGroup>

      <AccGroup title="Pisos y niveles" summary={on(a.decking !== 'none', a.backMesh, a.palletSupports)} defaultOpen={a.decking !== 'none' || a.backMesh || a.palletSupports}>
        <Field label="Piso en los niveles" hint={`Para mercadería suelta o pallets que no apoyan bien${qty(c.deckPanels)}.`}>{() => (
          <Segmented label="Piso" value={a.decking} onChange={(decking) => set({ decking })}
            options={[{ value: 'none', label: 'Sin piso' }, { value: 'wood', label: 'Madera' }, { value: 'mesh', label: 'Malla' }, { value: 'steel', label: 'Chapa' }]} />
        )}</Field>
        <Switch label="Malla de fondo" checked={a.backMesh} onChange={(backMesh) => set({ backMesh })}
          hint={`Cierra la cara de atrás para que no se caiga mercadería${qty(c.backMesh)}.`} />
        <Switch label="Travesaños de apoyo de pallet" checked={a.palletSupports} onChange={(palletSupports) => set({ palletSupports })}
          hint={`Refuerzo de viga a viga debajo de cada pallet${qty(c.palletSupports)}.`} />
      </AccGroup>

      <AccGroup title="Refuerzos" summary={on(a.topTies, a.crossBracing)} defaultOpen={a.topTies || a.crossBracing}>
        <Switch label="Conectores superiores" checked={a.topTies} onChange={(topTies) => set({ topTies })}
          hint={(multiRow ?? config.layout.rows > 1) ? `Unen las filas por arriba y les dan rigidez${qty(c.topTies)}.` : 'Unen filas entre sí: sirven con dos filas o más.'} />
        <Switch label="Cruces de arriostramiento" checked={a.crossBracing} onChange={(crossBracing) => set({ crossBracing })}
          hint={`Cruz en la cara posterior, una cada ${DESIGN_RULES.modulesPerCrossBrace} módulos${qty(c.crossBraces)}.`} />
      </AccGroup>

      <AccGroup title="Señalización" summary={on(a.capacitySigns, a.rowSigns, a.floorGuide)} defaultOpen={a.capacitySigns || a.rowSigns || a.floorGuide}>
        <Switch label="Carteles de capacidad" checked={a.capacitySigns} onChange={(capacitySigns) => set({ capacitySigns })}
          hint={`Uno por módulo con la carga máxima por nivel${qty(c.capacitySigns)}.`} />
        <Switch label="Carteles de fila" checked={a.rowSigns} onChange={(rowSigns) => set({ rowSigns })}
          hint={`Un cartel en cada cabecera, para la letra o el número de la fila${qty(c.rowSigns)}.`} />
        <Switch label="Guía en el piso" checked={a.floorGuide} onChange={(floorGuide) => set({ floorGuide })}
          hint={`Perfil en el piso a lo largo de cada fila, para guiar al autoelevador${qty(c.floorGuides)}.`} />
      </AccGroup>

      <AccGroup title="Colores" summary={`vigas ${colorName(a.beamColor).toLowerCase()} · parantes ${colorName(a.uprightColor).toLowerCase()}`}
        defaultOpen={a.beamColor !== 'rojo' || a.uprightColor !== 'galvanizado' || a.protectorColor !== 'rojo'}>
        <ColorSwatches label="Vigas" value={a.beamColor} options={PAINT_COLORS} onChange={(beamColor) => set({ beamColor })} />
        <ColorSwatches label="Parantes" value={a.uprightColor} options={[GALVANIZED, ...PAINT_COLORS]} onChange={(uprightColor) => set({ uprightColor })} />
        <ColorSwatches label="Protecciones" value={a.protectorColor} options={PAINT_COLORS} onChange={(protectorColor) => set({ protectorColor })} />
      </AccGroup>
      {c.spacers > 0 && <p className="note note--blue">Las filas espalda con espalda llevan {plural(c.spacers, 'distanciador', 'distanciadores')} (se suman solos).</p>}
    </div>
  )
}

/** Un grupo de accesorios que se abre y se cierra; cerrado muestra un resumen de lo elegido. */
function AccGroup({ title, summary, defaultOpen = false, children }: { title: string; summary: string; defaultOpen?: boolean; children: ReactNode }) {
  // se abre solo la primera vez si ya tiene algo elegido; después manda quien lo usa
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details className="plan-more acc-group" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary><span>{title}</span><small>{summary}</small></summary>
      <div className="acc-group__b">{children}</div>
    </details>
  )
}

/** Elegir un color: una fila de muestras redondas con su nombre. */
function ColorSwatches<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; name: string; hex: string }[]; onChange(v: T): void }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={`swatch${value === o.id ? ' is-on' : ''}`} title={o.name} onClick={() => onChange(o.id)}>
            <i style={{ background: o.hex }} aria-hidden /><span>{o.name}</span>
          </button>
        ))}
      </div>
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
