/**
 * Panel izquierdo del depósito: herramientas con su instructivo, arranque rápido,
 * grilla de columnas y las medidas de lo que esté seleccionado.
 */
import { Box, Circle, DoorOpen, Grid3x3, MousePointer2, PenLine, Redo2, Square, Trash2, Undo2, Minus as WallIcon, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { columnGrid, itemsOutside, removeItem, removeOutside, removeVertex, setEdgeLength, setSag, splitEdge } from '../../shared/plan/edit'
import { arcOf, edgeLength, edges, planArea, planPerimeter, rectanglePlan } from '../../shared/plan/geometry'
import type { Plan } from '../../shared/plan/types'
import { NumberStepper } from '../components/fields'
import { Button, Field, Input, KeyValue, Segmented } from '../components/ui'
import { fmt } from '../lib/format'
import { usePlan, type PlanTool } from './planStore'

const TOOLS: { id: PlanTool; label: string; icon: LucideIcon; help: string }[] = [
  { id: 'select', label: 'Seleccionar', icon: MousePointer2, help: 'Arrastrá los puntos rojos para mover las esquinas. Tocá una pared para escribir su largo o curvarla (arrastrando su manija del medio). Doble clic en una pared agrega un punto. Arrastrá el fondo para moverte y usá la rueda para acercar.' },
  { id: 'outline', label: 'Dibujar contorno', icon: PenLine, help: 'Hacé clic en cada esquina del depósito. Para cerrar, tocá el primer punto o apretá Enter. Las paredes se alinean solas a 90° cuando están casi derechas. Esc cancela.' },
  { id: 'column', label: 'Columna', icon: Square, help: 'Clic donde va cada columna. Después la podés arrastrar o escribir su medida. Para muchas columnas iguales usá "Grilla de columnas".' },
  { id: 'wall', label: 'Tabique', icon: WallIcon, help: 'Clic en el comienzo y en el final de la pared interna. Sigue encadenando la siguiente desde donde terminó; Esc termina.' },
  { id: 'door', label: 'Portón', icon: DoorOpen, help: 'Clic sobre una pared del contorno para poner un portón. Arrastralo para correrlo a lo largo de la pared.' },
  { id: 'zone', label: 'Zona libre', icon: Box, help: 'Clic para marcar un área donde no van racks (oficinas, carga y descarga). Después ajustá su medida y su nombre.' },
]

export function PlanPanel() {
  const { tool, setTool, plan, commit, undo, redo, past, future, snap, setSnap } = usePlan()
  const current = TOOLS.find((t) => t.id === tool)!
  const outside = itemsOutside(plan).size
  return (
    <section className="designer__panel plan-panel" aria-label="Plano del depósito">
      <div className="plan-tools" role="toolbar" aria-label="Herramientas">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={`plan-tool${tool === t.id ? ' is-active' : ''}`} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} title={t.label}>
            <t.icon size={18} aria-hidden /><span>{t.label}</span>
          </button>
        ))}
      </div>
      <p className="cot-help"><current.icon size={16} aria-hidden /><span>{current.help}</span></p>
      <div className="plan-history">
        <Button size="sm" variant="ghost" icon={Undo2} onClick={undo} disabled={!past.length}>Deshacer</Button>
        <Button size="sm" variant="ghost" icon={Redo2} onClick={redo} disabled={!future.length}>Rehacer</Button>
        <label className="plan-snap"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Imán 10 cm</label>
      </div>

      <Selection />

      <h2 className="section-label">Depósito</h2>
      <KeyValue items={[
        ['Superficie', `${fmt(Math.round(planArea(plan.outline)))} m²`],
        ['Perímetro', `${(planPerimeter(plan.outline) / 1000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} m`],
        ['Paredes', fmt(plan.outline.points.length)],
        ['Columnas', fmt(plan.columns.length)],
      ]} />
      {outside > 0 && (
        <div className="note note--amber plan-outside">
          <span>{outside === 1 ? 'Quedó 1 elemento' : `Quedaron ${outside} elementos`} fuera del contorno (marcados en rojo punteado).</span>
          <Button size="sm" onClick={() => commit(removeOutside)}>Quitar lo que quedó afuera</Button>
        </div>
      )}
      <NumberStepper label="Altura de las paredes" unit="mm" value={plan.wallHeight} min={2500} max={20_000} step={100}
        onChange={(wallHeight) => commit((p) => ({ ...p, wallHeight }))} />
      <NumberStepper label="Espesor de las paredes" unit="mm" value={plan.wallThickness} min={100} max={600} step={10}
        onChange={(wallThickness) => commit((p) => ({ ...p, wallThickness }))} />

      <QuickStart />
      <ColumnGrid />
    </section>
  )
}

/* ------------------------------ Lo seleccionado ------------------------------ */

function Selection() {
  const { plan, selection, commit, select } = usePlan()
  if (!selection) return <p className="muted small">Tocá una pared, una esquina o una columna para ver y escribir sus medidas.</p>
  const del = (fn: (p: Plan) => Plan) => { commit(fn); select(null) }

  if (selection.kind === 'vertex') {
    const p = plan.outline.points[selection.index]
    if (!p) return null
    return (
      <div className="plan-sel">
        <h2 className="section-label">Esquina {selection.index + 1}</h2>
        <NumberStepper label="Posición X" unit="mm" value={p.x} min={-500_000} max={500_000} step={100}
          onChange={(x) => commit((pl) => ({ ...pl, outline: { ...pl.outline, points: pl.outline.points.map((q, j) => (j === selection.index ? { ...q, x } : q)) } }))} />
        <NumberStepper label="Posición Y" unit="mm" value={p.y} min={-500_000} max={500_000} step={100}
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
          <NumberStepper label="Flecha (cuánto se curva)" unit="mm" value={Math.abs(e.sag)} min={50} max={Math.round(chord / 2)} step={100}
            onChange={(v) => commit((pl) => setSag(pl, selection.index, Math.sign(e.sag || -1) * v))}
            hint={`Largo del arco: ${fmt(Math.round(edgeLength(e)))} mm · cuerda ${fmt(Math.round(chord))} mm`} />
          <Button size="sm" variant="ghost" onClick={() => commit((pl) => setSag(pl, selection.index, -e.sag))}>Curvar para el otro lado</Button>
        </> : (
          <NumberStepper label="Largo" unit="mm" value={Math.round(chord)} min={100} max={500_000} step={100}
            onChange={(v) => commit((pl) => setEdgeLength(pl, selection.index, v))}
            hint="Se mueve la esquina final; la pared siguiente se acomoda." />
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
        <NumberStepper label={c.shape === 'round' ? 'Diámetro' : 'Ancho'} unit="mm" value={c.w} min={100} max={3000} step={50} onChange={(w) => upd(c.shape === 'round' ? { w, d: w } : { w })} />
        {c.shape === 'rect' && <NumberStepper label="Fondo" unit="mm" value={c.d} min={100} max={3000} step={50} onChange={(d) => upd({ d })} />}
        <div className="plan-xy">
          <NumberStepper label="X" unit="mm" value={c.x} min={-500_000} max={500_000} step={100} onChange={(x) => upd({ x })} />
          <NumberStepper label="Y" unit="mm" value={c.y} min={-500_000} max={500_000} step={100} onChange={(y) => upd({ y })} />
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
        <NumberStepper label="Largo" unit="mm" value={Math.round(len)} min={100} max={500_000} step={100}
          onChange={(v) => commit((pl) => ({ ...pl, walls: pl.walls.map((x) => {
            if (x.id !== w.id) return x
            const k = v / (len || 1)
            return { ...x, b: { x: Math.round(x.a.x + (x.b.x - x.a.x) * k), y: Math.round(x.a.y + (x.b.y - x.a.y) * k) } }
          }) }))} />
        <NumberStepper label="Espesor" unit="mm" value={w.thickness} min={50} max={600} step={10}
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
        <NumberStepper label="Ancho" unit="mm" value={d.width} min={800} max={12_000} step={100} onChange={(width) => upd({ width })} />
        <NumberStepper label="Alto" unit="mm" value={d.height} min={2000} max={plan.wallHeight} step={100} onChange={(height) => upd({ height })} />
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del((pl) => removeItem(pl, 'door', d.id))}>Quitar portón</Button>
      </div>
    )
  }

  const z = plan.zones.find((x) => x.id === selection.id)
  if (!z) return null
  const upd = (patch: Partial<typeof z>) => commit((pl) => ({ ...pl, zones: pl.zones.map((x) => (x.id === z.id ? { ...x, ...patch } : x)) }))
  return (
    <div className="plan-sel">
      <h2 className="section-label">Zona libre</h2>
      <Field label="Nombre">{(id) => <Input id={id} value={z.name} onChange={(e) => upd({ name: e.target.value })} />}</Field>
      <NumberStepper label="Ancho" unit="mm" value={z.w} min={500} max={200_000} step={100} onChange={(w) => upd({ w })} />
      <NumberStepper label="Fondo" unit="mm" value={z.d} min={500} max={200_000} step={100} onChange={(d) => upd({ d })} />
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
      <NumberStepper label="Largo" unit="mm" value={L} min={2000} max={500_000} step={500} onChange={setL} />
      <NumberStepper label="Ancho" unit="mm" value={W} min={2000} max={500_000} step={500} onChange={setW} />
      <Button size="sm" onClick={() => { commit((p) => rectanglePlan(L, W, { wallHeight: p.wallHeight, wallThickness: p.wallThickness })); select(null) }} block>
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
      <NumberStepper label="Separación a lo largo" unit="mm" value={dx} min={2000} max={50_000} step={500} onChange={setDx} />
      <NumberStepper label="Separación a lo ancho" unit="mm" value={dy} min={2000} max={50_000} step={500} onChange={setDy} />
      <NumberStepper label="Medida de la columna" unit="mm" value={size} min={150} max={1500} step={50} onChange={setSize} />
      <Button size="sm" onClick={() => commit((p) => columnGrid(p, dx, dy, size))} block>Generar columnas (reemplaza las actuales)</Button>
    </details>
  )
}
