/**
 * Panel izquierdo del depósito: herramientas con su instructivo, arranque rápido,
 * grilla de columnas y las medidas de lo que esté seleccionado.
 */
import { Box, Circle, DoorOpen, Footprints, Grid3x3, LayoutGrid, Minus as WallIcon, MousePointer2, MoveHorizontal, PenLine, Redo2, RotateCcw, RotateCw, Ruler, Shapes, Square, Trash2, Type, Undo2, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { columnGrid, itemsOutside, removeItem, removeOutside, removeVertex, rotateAisle, setEdgeLength, setSag, splitEdge, updateObject, updateRect } from '../../shared/plan/edit'
import { arcOf, edgeLength, edges, planArea, planPerimeter, rectanglePlan } from '../../shared/plan/geometry'
import type { ObjectShape, Plan } from '../../shared/plan/types'
import { OBJECT_COLORS } from '../../shared/rack/technicalSpecs'
import { NumberStepper } from '../components/fields'
import { Button, Field, Input, KeyValue, Segmented, Select } from '../components/ui'
import { fmt } from '../lib/format'
import { usePlan, type PlanTool } from './planStore'
import { SYMBOLS, SYMBOL_KINDS } from './PlanAnnotations'
import { metros } from '../../shared/units'

export const TOOLS: { id: PlanTool; label: string; icon: LucideIcon; help: string }[] = [
  { id: 'select', label: 'Seleccionar', icon: MousePointer2, help: 'Arrastrá los puntos rojos para mover las esquinas. Tocá una pared para escribir su largo o curvarla (arrastrando su manija del medio). Doble clic en una pared agrega un punto. Arrastrá el fondo para moverte y usá la rueda para acercar.' },
  { id: 'outline', label: 'Dibujar contorno', icon: PenLine, help: 'Hacé clic en la primera esquina. Después escribí el largo de cada pared (ej. 40) y Enter: va hacia donde apunta el mouse. También podés hacer clic en cada esquina. Para cerrar, tocá el primer punto o Enter. Esc cancela.' },
  { id: 'column', label: 'Columna', icon: Square, help: 'Clic donde va cada columna. Después la podés arrastrar o escribir su medida. Para muchas columnas iguales usá "Grilla de columnas".' },
  { id: 'wall', label: 'Tabique', icon: WallIcon, help: 'Clic donde empieza la pared interna; después clic donde termina, o escribí su largo y Enter. Sigue encadenando la siguiente desde donde terminó; Esc termina.' },
  { id: 'door', label: 'Portón', icon: DoorOpen, help: 'Clic sobre una pared del contorno para poner un portón. Arrastralo para correrlo a lo largo de la pared.' },
  { id: 'zone', label: 'Zona libre', icon: Box, help: 'Clic para marcar un área donde no van racks (oficinas, carga y descarga). Después ajustá su medida y su nombre.' },
  { id: 'area', label: 'Zona de racks', icon: LayoutGrid, help: 'Arrastrá un rectángulo donde querés los racks: se llenan solos con filas y pasillos. Podés marcar varias zonas, cada una con filas horizontales o verticales. Si no marcás ninguna, se usa todo el depósito.' },
  { id: 'aisle', label: 'Pasillo', icon: Footprints, help: 'Arrastrá de punta a punta por donde pasa el pasillo (sale con el ancho de pasillo elegido) o marcá un rectángulo. Un clic solo hace un pasillo de lado a lado. Ahí no van racks: las filas se acomodan a cada lado o se cortan.' },
]

/** Herramientas para medir y anotar el plano (como en AutoCAD). */
export const NOTE_TOOLS: { id: PlanTool; label: string; icon: LucideIcon; help: string }[] = [
  { id: 'measure', label: 'Medir', icon: Ruler, help: 'Clic en un punto y clic en el otro: te dice la distancia, y cuánto es en horizontal y en vertical. No queda dibujado. El clic se pega a esquinas, puntas y centros (cuadradito naranja).' },
  { id: 'dim', label: 'Cota', icon: MoveHorizontal, help: 'Clic en un extremo y clic en el otro: queda una cota dibujada con su medida. Después la podés correr, borrar o cambiarle la separación.' },
  { id: 'text', label: 'Texto', icon: Type, help: 'Clic donde va el texto, escribilo y Enter. Sirve para nombrar sectores (Oficina, Expedición, Recepción…).' },
  { id: 'symbol', label: 'Símbolo', icon: Shapes, help: 'Elegí el símbolo de abajo y hacé clic donde va cada uno: matafuegos, salidas de emergencia, baños, tablero, carga de autoelevadores…' },
]
const CALIBRATE = { id: 'calibrate' as PlanTool, label: 'Escala del fondo', icon: Ruler, help: 'Clic en dos puntos de una medida que conozcas del plano de fondo y escribí cuánto mide en la realidad.' }

/** El panel del depósito completo (con su marco). */
export function PlanPanel() {
  return <section className="designer__panel plan-panel" aria-label="Plano del depósito"><PlanTools /></section>
}

/** Herramientas, instructivo, lo seleccionado y los datos del depósito (sin el marco). */
/** `showSelection`: las medidas de lo seleccionado van acá (si no, las muestra quien lo usa, arriba de todo). */
export function PlanTools({ showSelection = true }: { showSelection?: boolean } = {}) {
  return (
    <>
      <PlanToolbar showSelection={showSelection} />
      <h2 className="section-label">Depósito</h2>
      <PlanDepotData />
    </>
  )
}

/** Herramientas de dibujo, su instructivo, deshacer, imán y cotas. */
export function PlanToolbar({ showSelection = true }: { showSelection?: boolean } = {}) {
  const { tool, setTool, plan, undo, redo, past, future, snap, setSnap, snapStep, setSnapStep, showCotas, setShowCotas, osnap, setOsnap, symbolKind, setSymbolKind } = usePlan()
  const current = [...TOOLS, ...NOTE_TOOLS].find((t) => t.id === tool) ?? CALIBRATE
  return (
    <>
      <div className="plan-tools" role="toolbar" aria-label="Herramientas">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={`plan-tool${tool === t.id ? ' is-active' : ''}`} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} title={t.label}>
            <t.icon size={18} aria-hidden /><span>{t.label}</span>
          </button>
        ))}
      </div>
      <span className="plan-tools__k">Medir y anotar</span>
      <div className="plan-tools" role="toolbar" aria-label="Medir y anotar">
        {NOTE_TOOLS.map((t) => (
          <button key={t.id} type="button" className={`plan-tool${tool === t.id ? ' is-active' : ''}`} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} title={t.label}>
            <t.icon size={18} aria-hidden /><span>{t.label}</span>
          </button>
        ))}
      </div>
      {tool === 'symbol' && (
        <div className="symbol-pick" role="radiogroup" aria-label="Qué símbolo poner">
          {SYMBOL_KINDS.map((k) => {
            const d = SYMBOLS[k]
            return (
              <button key={k} type="button" role="radio" aria-checked={symbolKind === k} className={`symbol-pick__b${symbolKind === k ? ' is-active' : ''}`}
                onClick={() => setSymbolKind(k)} title={d.label} style={{ color: d.color }}>
                <d.icon size={18} aria-hidden /><span>{d.label}</span>
              </button>
            )
          })}
        </div>
      )}
      <p className="cot-help"><current.icon size={16} aria-hidden /><span>{current.help}</span></p>
      <div className="plan-history">
        <Button size="sm" variant="ghost" icon={Undo2} onClick={undo} disabled={!past.length}>Deshacer</Button>
        <Button size="sm" variant="ghost" icon={Redo2} onClick={redo} disabled={!future.length}>Rehacer</Button>
        <span className="plan-toggles">
          <label className="plan-snap" title="Lo que dibujás o arrastrás se acomoda a esta medida (Alt para mover libre)">Imán
            <select className="plan-snap__select" value={snap ? snapStep : 0}
              onChange={(e) => { const v = Number(e.target.value); setSnap(v > 0); if (v > 0) setSnapStep(v) }}>
              <option value={1000}>1 m</option>
              <option value={500}>50 cm</option>
              <option value={100}>10 cm</option>
              <option value={0}>Sin imán</option>
            </select>
          </label>
          <label className="plan-snap" title="El clic se pega a esquinas, puntas, medios y centros de lo que ya está dibujado"><input type="checkbox" checked={osnap} onChange={(e) => setOsnap(e.target.checked)} /> Imán a objetos</label>
          <label className="plan-snap"><input type="checkbox" checked={showCotas} onChange={(e) => setShowCotas(e.target.checked)} /> Cotas</label>
        </span>
      </div>

      {plan.outline.points.length < 3 && tool !== 'outline'
        ? <p className="note note--blue">Empezá escribiendo el largo y el ancho del depósito en el plano, o dibujalo a mano con "Dibujar contorno" (clic en cada esquina y escribís el largo de cada pared).</p>
        : showSelection && <Selection />}

    </>
  )
}

/** Datos del depósito: superficie, paredes, arranque rápido y grilla de columnas. */
export function PlanDepotData() {
  const { plan, commit } = usePlan()
  const outside = itemsOutside(plan).size
  return (
    <>
      <KeyValue items={[
        ['Superficie', `${fmt(Math.round(planArea(plan.outline)))} m²`],
        ['Perímetro', `${(planPerimeter(plan.outline) / 1000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} m`],
        ['Paredes', fmt(plan.outline.points.length)],
        ['Columnas', fmt(plan.columns.length)],
        ...(plan.rackAreas?.length ? [['Zonas de racks', fmt(plan.rackAreas.length)] as [string, string]] : []),
        ...(plan.aisles?.length ? [['Pasillos marcados', fmt(plan.aisles.length)] as [string, string]] : []),
      ]} />
      {outside > 0 && (
        <div className="note note--amber plan-outside">
          <span>{outside === 1 ? 'Quedó 1 elemento' : `Quedaron ${outside} elementos`} fuera del contorno (marcados en rojo punteado).</span>
          <Button size="sm" onClick={() => commit(removeOutside)}>Quitar lo que quedó afuera</Button>
        </div>
      )}
      <NumberStepper label="Altura de las paredes" meters value={plan.wallHeight} min={2500} max={20_000} step={1000} typedStep={10}
        onChange={(wallHeight) => commit((p) => ({ ...p, wallHeight }))} />
      <NumberStepper label="Espesor de las paredes" meters value={plan.wallThickness} min={100} max={600} step={10}
        onChange={(wallThickness) => commit((p) => ({ ...p, wallThickness }))} />

      <QuickStart />
      <ColumnGrid />
    </>
  )
}

/* ------------------------------ Lo seleccionado ------------------------------ */

/** Las medidas de lo seleccionado en el plano (pared, esquina, columna, zona, pasillo…). */
export function Selection() {
  const { plan, selection, commit, select, layout } = usePlan()
  if (!selection) return <p className="muted small">Tocá una pared, una esquina, una columna, una zona o un pasillo para ver y escribir sus medidas.</p>
  const del = (fn: (p: Plan) => Plan) => { commit(fn); select(null) }

  if (selection.kind === 'vertex') {
    const p = plan.outline.points[selection.index]
    if (!p) return null
    return (
      <div className="plan-sel">
        <h2 className="section-label">Esquina {selection.index + 1}</h2>
        <NumberStepper label="Posición X" meters value={p.x} min={-500_000} max={500_000} step={1000} typedStep={10}
          onChange={(x) => commit((pl) => ({ ...pl, outline: { ...pl.outline, points: pl.outline.points.map((q, j) => (j === selection.index ? { ...q, x } : q)) } }))} />
        <NumberStepper label="Posición Y" meters value={p.y} min={-500_000} max={500_000} step={1000} typedStep={10}
          onChange={(y) => commit((pl) => ({ ...pl, outline: { ...pl.outline, points: pl.outline.points.map((q, j) => (j === selection.index ? { ...q, y } : q)) } }))} />
        <Button size="sm" variant="ghost" icon={Trash2} disabled={plan.outline.points.length <= 3} onClick={() => del((pl) => removeVertex(pl, selection.index))}>Quitar esquina</Button>
      </div>
    )
  }

  if (selection.kind === 'edge') {
    const e = edges(plan.outline)[selection.index]
    if (!e) return null
    const curved = !!arcOf(e)
    const chord = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y)
    return (
      <div className="plan-sel">
        <h2 className="section-label">Pared {selection.index + 1}</h2>
        <Field label="Forma">{() => (
          <Segmented label="Forma" value={curved ? 'curva' : 'recta'}
            onChange={(v) => commit((pl) => setSag(pl, selection.index, v === 'recta' ? 0 : -Math.round(chord / 6)))}
            options={[{ value: 'recta', label: 'Recta' }, { value: 'curva', label: 'Curva' }]} />
        )}</Field>
        {curved ? <>
          <NumberStepper label="Flecha (cuánto se curva)" meters value={Math.abs(e.sag)} min={50} max={Math.round(chord / 2)} step={1000} typedStep={10}
            onChange={(v) => commit((pl) => setSag(pl, selection.index, Math.sign(e.sag || -1) * v))}
            hint={`Largo del arco: ${metros(edgeLength(e))} · cuerda ${metros(chord)}`} />
          <Button size="sm" variant="ghost" onClick={() => commit((pl) => setSag(pl, selection.index, -e.sag))}>Curvar para el otro lado</Button>
        </> : (
          <NumberStepper label="Largo" meters value={Math.round(chord)} min={100} max={500_000} step={1000} typedStep={10}
            onChange={(v) => commit((pl) => setEdgeLength(pl, selection.index, v))}
            hint="La pared siguiente se corre: si el depósito es rectangular, sigue siendo rectángulo. También podés tocar la medida en el plano y escribirla." />
        )}
        <Button size="sm" variant="ghost" onClick={() => { commit((pl) => splitEdge(pl, selection.index)); select({ kind: 'vertex', index: selection.index + 1 }) }}>Agregar esquina en el medio</Button>
      </div>
    )
  }

  if (selection.kind === 'column') {
    const c = plan.columns.find((x) => x.id === selection.id)
    if (!c) return null
    const upd = (patch: Partial<typeof c>) => commit((pl) => ({ ...pl, columns: pl.columns.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }))
    return (
      <div className="plan-sel">
        <h2 className="section-label">Columna</h2>
        <Field label="Forma">{() => (
          <Segmented label="Forma" value={c.shape} onChange={(shape) => upd({ shape })}
            options={[{ value: 'rect', label: <><Square size={14} aria-hidden /> Cuadrada</> }, { value: 'round', label: <><Circle size={14} aria-hidden /> Redonda</> }]} />
        )}</Field>
        <NumberStepper label={c.shape === 'round' ? 'Diámetro' : 'Ancho'} meters value={c.w} min={100} max={3000} step={50} onChange={(w) => upd(c.shape === 'round' ? { w, d: w } : { w })} />
        {c.shape === 'rect' && <NumberStepper label="Fondo" meters value={c.d} min={100} max={3000} step={50} onChange={(d) => upd({ d })} />}
        <div className="plan-xy">
          <NumberStepper label="X" meters value={c.x} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(x) => upd({ x })} />
          <NumberStepper label="Y" meters value={c.y} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(y) => upd({ y })} />
        </div>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del((pl) => removeItem(pl, 'column', c.id))}>Quitar columna</Button>
      </div>
    )
  }

  if (selection.kind === 'wall') {
    const w = plan.walls.find((x) => x.id === selection.id)
    if (!w) return null
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
    return (
      <div className="plan-sel">
        <h2 className="section-label">Tabique</h2>
        <NumberStepper label="Largo" meters value={Math.round(len)} min={100} max={500_000} step={1000} typedStep={10}
          onChange={(v) => commit((pl) => ({ ...pl, walls: pl.walls.map((x) => {
            if (x.id !== w.id) return x
            const k = v / (len || 1)
            return { ...x, b: { x: Math.round(x.a.x + (x.b.x - x.a.x) * k), y: Math.round(x.a.y + (x.b.y - x.a.y) * k) } }
          }) }))} />
        <div className="plan-xy">
          <NumberStepper label="Desde X" meters value={w.a.x} min={-500_000} max={500_000} step={1000} typedStep={10}
            onChange={(x) => commit((pl) => ({ ...pl, walls: pl.walls.map((q) => (q.id === w.id ? { ...q, a: { x, y: q.a.y }, b: { x: q.b.x + x - q.a.x, y: q.b.y } } : q)) }))} />
          <NumberStepper label="Desde Y" meters value={w.a.y} min={-500_000} max={500_000} step={1000} typedStep={10}
            onChange={(y) => commit((pl) => ({ ...pl, walls: pl.walls.map((q) => (q.id === w.id ? { ...q, a: { x: q.a.x, y }, b: { x: q.b.x, y: q.b.y + y - q.a.y } } : q)) }))} />
        </div>
        <NumberStepper label="Espesor" meters value={w.thickness} min={50} max={600} step={10}
          onChange={(thickness) => commit((pl) => ({ ...pl, walls: pl.walls.map((x) => (x.id === w.id ? { ...x, thickness } : x)) }))} />
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del((pl) => removeItem(pl, 'wall', w.id))}>Quitar tabique</Button>
      </div>
    )
  }

  if (selection.kind === 'door') {
    const d = plan.doors.find((x) => x.id === selection.id)
    if (!d) return null
    const upd = (patch: Partial<typeof d>) => commit((pl) => ({ ...pl, doors: pl.doors.map((x) => (x.id === d.id ? { ...x, ...patch } : x)) }))
    return (
      <div className="plan-sel">
        <h2 className="section-label">Portón</h2>
        <NumberStepper label="Ancho" meters value={d.width} min={800} max={12_000} step={500} typedStep={10} onChange={(width) => upd({ width })} />
        {(() => {
          const e = edges(plan.outline)[d.edge]
          if (!e) return null
          const L = edgeLength(e)
          const from = Math.round(d.t * L - d.width / 2)
          return <NumberStepper label="Distancia desde la esquina" meters value={Math.max(0, from)} min={0} max={Math.max(0, Math.round(L - d.width))} step={1000} typedStep={10}
            onChange={(v) => upd({ t: Math.min(1, Math.max(0, (v + d.width / 2) / (L || 1))) })}
            hint={`Desde la esquina ${d.edge + 1} hasta el borde del portón.`} />
        })()}
        <NumberStepper label="Alto" meters value={d.height} min={2000} max={plan.wallHeight} step={500} typedStep={10} onChange={(height) => upd({ height })} />
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del((pl) => removeItem(pl, 'door', d.id))}>Quitar portón</Button>
      </div>
    )
  }

  if (selection.kind === 'area') {
    const a = plan.rackAreas?.find((x) => x.id === selection.id)
    if (!a) return null
    const upd = (patch: Partial<typeof a>) => commit((pl) => updateRect(pl, 'area', a.id, () => patch))
    return (
      <div className="plan-sel">
        <h2 className="section-label">Zona de racks</h2>
        <Field label="Nombre">{(id) => <Input id={id} value={a.name} onChange={(e) => upd({ name: e.target.value })} />}</Field>
        <Field label="Filas">{() => (
          <Segmented label="Filas" value={a.orientation ?? layout.orientation} onChange={(orientation) => upd({ orientation })}
            options={[{ value: 'x', label: 'Horizontales' }, { value: 'y', label: 'Verticales' }]} />
        )}</Field>
        <div className="plan-xy">
          <NumberStepper label="Ancho" meters value={a.w} min={1000} max={500_000} step={1000} typedStep={10} onChange={(w) => upd({ w })} />
          <NumberStepper label="Fondo" meters value={a.d} min={1000} max={500_000} step={1000} typedStep={10} onChange={(d) => upd({ d })} />
        </div>
        <div className="plan-xy">
          <NumberStepper label="X" meters value={a.x} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(x) => upd({ x })} />
          <NumberStepper label="Y" meters value={a.y} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(y) => upd({ y })} />
        </div>
        <p className="muted small">Arrastrá el borde o el nombre para moverla y la manija de la esquina para cambiar el tamaño.</p>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del((pl) => removeItem(pl, 'area', a.id))}>Quitar zona de racks</Button>
      </div>
    )
  }

  if (selection.kind === 'aisle') {
    const a = plan.aisles?.find((x) => x.id === selection.id)
    if (!a) return null
    const vertical = a.d > a.w
    const width = vertical ? a.w : a.d, length = vertical ? a.d : a.w
    const upd = (patch: Partial<typeof a>) => commit((pl) => updateRect(pl, 'aisle', a.id, () => patch))
    return (
      <div className="plan-sel">
        <h2 className="section-label">Pasillo {vertical ? 'vertical' : 'horizontal'}</h2>
        <NumberStepper label="Ancho del pasillo" meters value={width} min={800} max={20_000} step={500} typedStep={10}
          onChange={(v) => upd(vertical ? { w: v, x: Math.round(a.x + (a.w - v) / 2) } : { d: v, y: Math.round(a.y + (a.d - v) / 2) })}
          hint={width === 3000 ? 'Lo habitual: 3 m.' : <>Lo habitual es 3 m. <button type="button" className="link-btn" onClick={() => upd(vertical ? { w: 3000, x: Math.round(a.x + (a.w - 3000) / 2) } : { d: 3000, y: Math.round(a.y + (a.d - 3000) / 2) })}>Volver a 3 m</button></>} />
        <NumberStepper label="Largo" meters value={length} min={1000} max={500_000} step={1000} typedStep={10} onChange={(v) => upd(vertical ? { d: v } : { w: v })} />
        <div className="plan-xy">
          <NumberStepper label="X" meters value={a.x} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(x) => upd({ x })} />
          <NumberStepper label="Y" meters value={a.y} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(y) => upd({ y })} />
        </div>
        <Button size="sm" variant="ghost" icon={vertical ? RotateCcw : RotateCw} onClick={() => commit((pl) => rotateAisle(pl, a.id))}>Girar 90°</Button>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del((pl) => removeItem(pl, 'aisle', a.id))}>Quitar pasillo</Button>
      </div>
    )
  }

  if (selection.kind === 'text') {
    const t = plan.texts?.find((x) => x.id === selection.id)
    if (!t) return null
    const upd = (patch: Partial<typeof t>) => commit((pl) => ({ ...pl, texts: pl.texts?.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }))
    return (
      <div className="plan-sel">
        <h2 className="section-label">Texto</h2>
        <Field label="Qué dice">{(id) => <Input id={id} value={t.text} onChange={(e) => upd({ text: e.target.value })} />}</Field>
        <NumberStepper label="Alto de la letra" meters value={t.size} min={100} max={5000} step={100} typedStep={10} onChange={(size) => upd({ size })} />
        <div className="plan-xy">
          <NumberStepper label="X" meters value={t.x} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(x) => upd({ x })} />
          <NumberStepper label="Y" meters value={t.y} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(y) => upd({ y })} />
        </div>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del((pl) => removeItem(pl, 'text', t.id))}>Quitar texto</Button>
      </div>
    )
  }

  if (selection.kind === 'object') {
    const o = plan.objects?.find((x) => x.id === selection.id)
    if (!o) return null
    const upd = (patch: Partial<typeof o>) => commit((pl) => updateObject(pl, o.id, patch))
    return (
      <div className="plan-sel">
        <h2 className="section-label">Objeto</h2>
        <Field label="Nombre">{(id) => <Input id={id} value={o.name} maxLength={40} onChange={(e) => upd({ name: e.target.value })} />}</Field>
        <ObjectFields o={o} onChange={upd} />
        <NumberStepper label="Altura desde el piso" meters value={o.z} min={0} max={20_000} step={100} typedStep={10} onChange={(z) => upd({ z })} hint={o.z ? undefined : 'Apoyado en el piso'} />
        <NumberStepper label="Giro" unit="°" value={o.rot} min={0} max={345} step={15} typedStep={1} onChange={(rot) => upd({ rot })} />
        <div className="plan-xy">
          <NumberStepper label="X" meters value={o.x} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(x) => upd({ x })} />
          <NumberStepper label="Y" meters value={o.y} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(y) => upd({ y })} />
        </div>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del((pl) => removeItem(pl, 'object', o.id))}>Quitar objeto</Button>
      </div>
    )
  }

  if (selection.kind === 'symbol') {
    const sy = plan.symbols?.find((x) => x.id === selection.id)
    if (!sy) return null
    const upd = (patch: Partial<typeof sy>) => commit((pl) => ({ ...pl, symbols: pl.symbols?.map((x) => (x.id === sy.id ? { ...x, ...patch } : x)) }))
    return (
      <div className="plan-sel">
        <h2 className="section-label">Símbolo</h2>
        <Field label="Qué es">{(id) => (
          <Select id={id} value={sy.kind} onChange={(e) => upd({ kind: e.target.value as typeof sy.kind })}>
            {SYMBOL_KINDS.map((k) => <option key={k} value={k}>{SYMBOLS[k].label}</option>)}
          </Select>
        )}</Field>
        <div className="plan-xy">
          <NumberStepper label="X" meters value={sy.x} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(x) => upd({ x })} />
          <NumberStepper label="Y" meters value={sy.y} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(y) => upd({ y })} />
        </div>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del((pl) => removeItem(pl, 'symbol', sy.id))}>Quitar símbolo</Button>
      </div>
    )
  }

  if (selection.kind === 'dim') {
    const d = plan.dims?.find((x) => x.id === selection.id)
    if (!d) return null
    const L = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)
    return (
      <div className="plan-sel">
        <h2 className="section-label">Cota · {metros(L)}</h2>
        <NumberStepper label="Separación de la línea" meters value={d.offset} min={-50_000} max={50_000} step={500} typedStep={10}
          onChange={(offset) => commit((pl) => ({ ...pl, dims: pl.dims?.map((x) => (x.id === d.id ? { ...x, offset } : x)) }))}
          hint="Corre la línea de la cota hacia un lado o el otro (con signo menos, al otro lado)." />
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del((pl) => removeItem(pl, 'dim', d.id))}>Quitar cota</Button>
      </div>
    )
  }

  if (selection.kind !== 'zone') return null
  const z = plan.zones.find((x) => x.id === selection.id)
  if (!z) return null
  const upd = (patch: Partial<typeof z>) => commit((pl) => ({ ...pl, zones: pl.zones.map((x) => (x.id === z.id ? { ...x, ...patch } : x)) }))
  return (
    <div className="plan-sel">
      <h2 className="section-label">Zona libre</h2>
      <Field label="Nombre">{(id) => <Input id={id} value={z.name} onChange={(e) => upd({ name: e.target.value })} />}</Field>
      <NumberStepper label="Ancho" meters value={z.w} min={500} max={200_000} step={1000} typedStep={10} onChange={(w) => upd({ w })} />
      <NumberStepper label="Fondo" meters value={z.d} min={500} max={200_000} step={1000} typedStep={10} onChange={(d) => upd({ d })} />
      <div className="plan-xy">
        <NumberStepper label="X" meters value={z.x} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(x) => upd({ x })} />
        <NumberStepper label="Y" meters value={z.y} min={-500_000} max={500_000} step={1000} typedStep={10} onChange={(y) => upd({ y })} />
      </div>
      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del((pl) => removeItem(pl, 'zone', z.id))}>Quitar zona</Button>
    </div>
  )
}

/* ------------------------------ Arranque rápido y columnas ------------------------------ */

function QuickStart() {
  const { commit, select } = usePlan()
  const [L, setL] = useState(32_000)
  const [W, setW] = useState(22_000)
  return (
    <details className="plan-more">
      <summary>Empezar con un depósito rectangular</summary>
      <NumberStepper label="Largo" meters value={L} min={2000} max={500_000} step={1000} typedStep={10} onChange={setL} />
      <NumberStepper label="Ancho" meters value={W} min={2000} max={500_000} step={1000} typedStep={10} onChange={setW} />
      <Button size="sm" onClick={() => { commit((p) => rectanglePlan(L, W, { wallHeight: p.wallHeight, wallThickness: p.wallThickness, racks: p.racks ? [] : undefined })); select(null) }} block>
        Reemplazar el plano por {fmt(L / 1000)} × {fmt(W / 1000)} m
      </Button>
    </details>
  )
}

function ColumnGrid() {
  const { commit } = usePlan()
  const [dx, setDx] = useState(10_000)
  const [dy, setDy] = useState(10_000)
  const [size, setSize] = useState(400)
  return (
    <details className="plan-more">
      <summary><Grid3x3 size={15} aria-hidden /> Grilla de columnas</summary>
      <NumberStepper label="Separación a lo largo" meters value={dx} min={2000} max={50_000} step={1000} typedStep={10} onChange={setDx} />
      <NumberStepper label="Separación a lo ancho" meters value={dy} min={2000} max={50_000} step={1000} typedStep={10} onChange={setDy} />
      <NumberStepper label="Medida de la columna" meters value={size} min={150} max={1500} step={50} onChange={setSize} />
      <Button size="sm" onClick={() => commit((p) => columnGrid(p, dx, dy, size))} block>Generar columnas (reemplaza las actuales)</Button>
    </details>
  )
}

/**
 * Las herramientas para marcar dónde van los racks (zonas de racks y pasillos), sueltas: para usar
 * en el paso de la distribución sin volver al plano del depósito.
 */
export function MarkTools() {
  const { tool, setTool, plan } = usePlan()
  const ids: PlanTool[] = ['select', 'area', 'aisle']
  const current = TOOLS.find((t) => t.id === tool && ids.includes(t.id))
  const n = (plan.rackAreas?.length ?? 0), k = (plan.aisles?.length ?? 0)
  return (
    <div className="mark-tools">
      <h2 className="section-label">Dónde van los racks</h2>
      <div className="plan-tools" role="toolbar" aria-label="Marcar zonas de racks y pasillos">
        {TOOLS.filter((t) => ids.includes(t.id)).map((t) => (
          <button key={t.id} type="button" className={`plan-tool${tool === t.id ? ' is-active' : ''}`} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} title={t.label}>
            <t.icon size={18} aria-hidden /><span>{t.label}</span>
          </button>
        ))}
      </div>
      <p className="muted small">
        {current && current.id !== 'select' ? current.help
          : n || k ? `${n ? `${n} ${n === 1 ? 'zona de racks' : 'zonas de racks'}` : 'Todo el depósito'}${k ? ` · ${k} ${k === 1 ? 'pasillo marcado' : 'pasillos marcados'}` : ''}. Tocá una zona o un pasillo en el plano para cambiarlo.`
            : 'Marcá en el plano las zonas donde van los racks y los pasillos que necesitás: las filas se acomodan solas.'}
      </p>
    </div>
  )
}

/** Forma, medidas y color de un objeto propio (se usa acá y en "Mis piezas"). */
export function ObjectFields({ o, onChange }: { o: ObjectShape; onChange(patch: Partial<ObjectShape>): void }) {
  return <>
    <Field label="Forma">{() => (
      <Segmented label="Forma" value={o.shape} onChange={(shape) => onChange({ shape })} options={[{ value: 'caja', label: 'Caja (rectángulo)' }, { value: 'cilindro', label: 'Cilindro' }]} />
    )}</Field>
    <div className="plan-xy">
      <NumberStepper label={o.shape === 'cilindro' ? 'Diámetro' : 'Largo'} meters value={o.w} min={50} max={30_000} step={100} typedStep={10} onChange={(w) => onChange({ w })} />
      {o.shape === 'caja' && <NumberStepper label="Ancho" meters value={o.d} min={50} max={30_000} step={100} typedStep={10} onChange={(d) => onChange({ d })} />}
    </div>
    <NumberStepper label="Alto" meters value={o.h} min={10} max={20_000} step={100} typedStep={10} onChange={(h) => onChange({ h })} />
    <div className="field">
      <span className="field__label">Color</span>
      <div className="swatches" role="radiogroup" aria-label="Color">
        {OBJECT_COLORS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={o.color === c.hex} className={`swatch swatch--dot${o.color === c.hex ? ' is-on' : ''}`} title={c.name} aria-label={c.name} onClick={() => onChange({ color: c.hex })}>
            <i style={{ background: c.hex }} aria-hidden />
          </button>
        ))}
      </div>
    </div>
  </>
}
