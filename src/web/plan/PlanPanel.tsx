/**
 * Panel izquierdo del depósito: herramientas con su instructivo, arranque rápido,
 * grilla de columnas y las medidas de lo que esté seleccionado.
 */
import { Box, Circle, Copy, DoorOpen, Download, Grid3x3, LayoutGrid, MousePointer2, PenLine, Pencil, Redo2, RotateCw, Square, Trash2, Undo2, Minus as WallIcon, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { columnGrid, itemsOutside, removeItem, removeOutside, removeVertex, setEdgeLength, setSag, splitEdge } from '../../shared/plan/edit'
import { arcOf, edgeLength, edges, planArea, planPerimeter, rectanglePlan } from '../../shared/plan/geometry'
import { CONFLICT_TEXT, configKey, localBox, rackConflicts, rackTotals, removeRack, repeatRack, rotateRack, structureFor, updateRack } from '../../shared/plan/racks'
import type { Plan } from '../../shared/plan/types'
import { MaterialsList } from '../pages/designer/CotizadorPanel'
import { startEditingRack } from './rackEditing'
import { NumberStepper } from '../components/fields'
import { Button, Field, Input, KeyValue, Segmented } from '../components/ui'
import { fmt } from '../lib/format'
import { usePlan, type PlanTool } from './planStore'
import { metros } from '../../shared/units'

const TOOLS: { id: PlanTool; label: string; icon: LucideIcon; help: string }[] = [
  { id: 'select', label: 'Seleccionar', icon: MousePointer2, help: 'Arrastrá los puntos rojos para mover las esquinas o un rack para moverlo. Tocá una pared para escribir su largo o curvarla (arrastrando su manija del medio). Con un rack elegido: R lo gira, Ctrl+D lo duplica y Supr lo quita. Arrastrá el fondo para moverte y usá la rueda para acercar.' },
  { id: 'rack', label: 'Rack', icon: LayoutGrid, help: 'Clic donde va cada rack: se ubica el rack que armaste en la pestaña Rack. R lo gira antes de ponerlo. Después lo podés mover, girar, editar o copiar en serie desde este panel.' },
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
      <RackSummary plan={plan} />
      {outside > 0 && (
        <div className="note note--amber plan-outside">
          <span>{outside === 1 ? 'Quedó 1 elemento' : `Quedaron ${outside} elementos`} fuera del contorno (marcados en rojo punteado).</span>
          <Button size="sm" onClick={() => commit(removeOutside)}>Quitar lo que quedó afuera</Button>
        </div>
      )}
      <NumberStepper label="Altura de las paredes" meters value={plan.wallHeight} min={2500} max={20_000} step={100}
        onChange={(wallHeight) => commit((p) => ({ ...p, wallHeight }))} />
      <NumberStepper label="Espesor de las paredes" meters value={plan.wallThickness} min={100} max={600} step={10}
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

  if (selection.kind === 'rack') return <RackSelection id={selection.id} />

  if (selection.kind === 'vertex') {
    const p = plan.outline.points[selection.index]
    if (!p) return null
    return (
      <div className="plan-sel">
        <h2 className="section-label">Esquina {selection.index + 1}</h2>
        <NumberStepper label="Posición X" meters value={p.x} min={-500_000} max={500_000} step={100}
          onChange={(x) => commit((pl) => ({ ...pl, outline: { ...pl.outline, points: pl.outline.points.map((q, j) => (j === selection.index ? { ...q, x } : q)) } }))} />
        <NumberStepper label="Posición Y" meters value={p.y} min={-500_000} max={500_000} step={100}
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
          <NumberStepper label="Flecha (cuánto se curva)" meters value={Math.abs(e.sag)} min={50} max={Math.round(chord / 2)} step={100}
            onChange={(v) => commit((pl) => setSag(pl, selection.index, Math.sign(e.sag || -1) * v))}
            hint={`Largo del arco: ${metros(edgeLength(e))} · cuerda ${metros(chord)}`} />
          <Button size="sm" variant="ghost" onClick={() => commit((pl) => setSag(pl, selection.index, -e.sag))}>Curvar para el otro lado</Button>
        </> : (
          <NumberStepper label="Largo" meters value={Math.round(chord)} min={100} max={500_000} step={100}
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
        <NumberStepper label={c.shape === 'round' ? 'Diámetro' : 'Ancho'} meters value={c.w} min={100} max={3000} step={50} onChange={(w) => upd(c.shape === 'round' ? { w, d: w } : { w })} />
        {c.shape === 'rect' && <NumberStepper label="Fondo" meters value={c.d} min={100} max={3000} step={50} onChange={(d) => upd({ d })} />}
        <div className="plan-xy">
          <NumberStepper label="X" meters value={c.x} min={-500_000} max={500_000} step={100} onChange={(x) => upd({ x })} />
          <NumberStepper label="Y" meters value={c.y} min={-500_000} max={500_000} step={100} onChange={(y) => upd({ y })} />
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
        <NumberStepper label="Largo" meters value={Math.round(len)} min={100} max={500_000} step={100}
          onChange={(v) => commit((pl) => ({ ...pl, walls: pl.walls.map((x) => {
            if (x.id !== w.id) return x
            const k = v / (len || 1)
            return { ...x, b: { x: Math.round(x.a.x + (x.b.x - x.a.x) * k), y: Math.round(x.a.y + (x.b.y - x.a.y) * k) } }
          }) }))} />
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
        <NumberStepper label="Ancho" meters value={d.width} min={800} max={12_000} step={100} onChange={(width) => upd({ width })} />
        <NumberStepper label="Alto" meters value={d.height} min={2000} max={plan.wallHeight} step={100} onChange={(height) => upd({ height })} />
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
      <NumberStepper label="Ancho" meters value={z.w} min={500} max={200_000} step={100} onChange={(w) => upd({ w })} />
      <NumberStepper label="Fondo" meters value={z.d} min={500} max={200_000} step={100} onChange={(d) => upd({ d })} />
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
      <NumberStepper label="Largo" meters value={L} min={2000} max={500_000} step={500} onChange={setL} />
      <NumberStepper label="Ancho" meters value={W} min={2000} max={500_000} step={500} onChange={setW} />
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
      <NumberStepper label="Separación a lo largo" meters value={dx} min={2000} max={50_000} step={500} onChange={setDx} />
      <NumberStepper label="Separación a lo ancho" meters value={dy} min={2000} max={50_000} step={500} onChange={setDy} />
      <NumberStepper label="Medida de la columna" meters value={size} min={150} max={1500} step={50} onChange={setSize} />
      <Button size="sm" onClick={() => commit((p) => columnGrid(p, dx, dy, size))} block>Generar columnas (reemplaza las actuales)</Button>
    </details>
  )
}

/* ------------------------------ Racks ------------------------------ */

const ROTATIONS = [0, 90, 180, 270]

function RackSelection({ id }: { id: string }) {
  const { plan, commit, select } = usePlan()
  const [count, setCount] = useState(4)
  const [direction, setDirection] = useState<'along' | 'across'>('across')
  const rack = plan.racks?.find((r) => r.id === id)
  const conflicts = useMemo(() => rackConflicts(plan).get(id), [plan, id])
  const [gap, setGap] = useState(rack?.config.layout.aisleWidth ?? 3000)
  if (!rack) return null
  const n = (plan.racks ?? []).indexOf(rack) + 1
  const s = structureFor(rack.config)
  const b = localBox(s)
  const key = configKey(rack.config)
  const same = (plan.racks ?? []).filter((r) => r !== rack && configKey(r.config) === key).length
  const edit = () => startEditingRack(rack.id)
  return (
    <div className="plan-sel">
      <h2 className="section-label">Rack R{n}</h2>
      <KeyValue items={[
        ['Largo × fondo × alto', `${metros(b.u1 - b.u0)} × ${metros(b.v1 - b.v0)} × ${metros(s.config.height)}`],
        ['Filas · módulos', `${fmt(s.rows.length)} · ${fmt(s.modules.length)}`],
        ['Niveles', fmt(s.storageLevels)],
        ['Posiciones', fmt(s.positionsAvailable)],
        ...(same ? [['Iguales en el depósito', fmt(same)] as [string, string]] : []),
      ]} />
      {conflicts && (
        <div className="note note--amber">Este rack {[...conflicts].map((c) => CONFLICT_TEXT[c]).join(', ')}.</div>
      )}
      <Button size="sm" variant="primary" icon={Pencil} onClick={edit} block>Editar este rack</Button>
      <Field label="Giro">{() => (
        <Segmented label="Giro" value={String(ROTATIONS.includes(rack.rotation) ? rack.rotation : 0)}
          onChange={(v) => commit((p) => rotateRack(p, id, Number(v)))}
          options={ROTATIONS.map((r) => ({ value: String(r), label: `${r}°` }))} />
      )}</Field>
      <div className="plan-xy">
        <NumberStepper label="X" meters value={rack.x} min={-500_000} max={500_000} step={100} onChange={(x) => commit((p) => updateRack(p, id, { x }))} />
        <NumberStepper label="Y" meters value={rack.y} min={-500_000} max={500_000} step={100} onChange={(y) => commit((p) => updateRack(p, id, { y }))} />
      </div>
      <div className="plan-history">
        <Button size="sm" variant="ghost" icon={RotateCw} onClick={() => commit((p) => rotateRack(p, id, rack.rotation + 90))}>Girar 90°</Button>
        <Button size="sm" variant="ghost" icon={Copy} onClick={() => {
          let ids: string[] = []
          commit((p) => { const r = repeatRack(p, id, 1, 'across', rack.config.layout.aisleWidth); ids = r.ids; return r.plan })
          if (ids[0]) select({ kind: 'rack', id: ids[0] })
        }}>Duplicar</Button>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => { commit((p) => removeRack(p, id)); select(null) }}>Quitar</Button>
      </div>
      <details className="plan-more" open>
        <summary>Copiar en serie</summary>
        <Field label="Hacia dónde">{() => (
          <Segmented label="Hacia dónde" value={direction} onChange={(v) => { setDirection(v); setGap(v === 'across' ? rack.config.layout.aisleWidth : 0) }}
            options={[{ value: 'across', label: 'Enfrente (con pasillo)' }, { value: 'along', label: 'A continuación' }]} />
        )}</Field>
        <NumberStepper label="Copias" value={count} min={1} max={200} step={1} onChange={setCount} />
        <NumberStepper label={direction === 'across' ? 'Pasillo' : 'Separación'} meters value={gap} min={0} max={20_000} step={100} onChange={setGap} />
        <Button size="sm" onClick={() => commit((p) => repeatRack(p, id, count, direction, gap).plan)} block>
          Agregar {fmt(count)} {count === 1 ? 'copia' : 'copias'}
        </Button>
      </details>
    </div>
  )
}

function RackSummary({ plan }: { plan: Plan }) {
  const totals = useMemo(() => rackTotals(plan), [plan])
  const conflicts = useMemo(() => rackConflicts(plan), [plan])
  if (!totals.racks) return <p className="muted small">Todavía no hay racks. Elegí la herramienta Rack y hacé clic en el plano para ubicar el que armaste.</p>
  return (
    <>
      <KeyValue items={[
        ['Racks', fmt(totals.racks)],
        ['Módulos', fmt(totals.modules)],
        ['Posiciones de pallet', fmt(totals.positions)],
        ['Capacidad estimada', `${fmt(Math.round(totals.capacityKg / 1000))} t`],
      ]} />
      {conflicts.size > 0 && (
        <div className="note note--amber">{conflicts.size === 1 ? 'Hay 1 rack con problemas' : `Hay ${fmt(conflicts.size)} racks con problemas`} (marcados en rojo punteado): fuera del depósito, sobre columnas, zonas o tabiques, o superpuestos.</div>
      )}
      <details className="plan-more">
        <summary>Lista de materiales del depósito</summary>
        <MaterialsList lines={totals.materials} />
        <Button size="sm" icon={Download} block onClick={() => downloadCsv(totals.materials)}>Descargar lista (CSV)</Button>
      </details>
    </>
  )
}

function downloadCsv(lines: { group: string; code: string; name: string; detail?: string; qty: number }[]) {
  const rows = [['Grupo', 'Código', 'Pieza', 'Detalle', 'Cantidad'], ...lines.map((l) => [l.group, l.code, l.name, l.detail ?? '', String(l.qty)])]
  const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'materiales-deposito.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
