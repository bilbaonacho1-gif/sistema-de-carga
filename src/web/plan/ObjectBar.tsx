/**
 * BARRITA SOBRE LO ELEGIDO EN EL PLANO: girar, más y menos, ajustar al depósito y borrar, al lado
 * del objeto (como las barras contextuales de los programas de diseño). Sirve para zonas libres,
 * zonas de racks, pasillos, columnas, tabiques, textos, símbolos, cotas, racks y el depósito entero
 * (tocando una de sus paredes).
 */
import { AlignStartHorizontal, AlignStartVertical, Combine, Copy, Focus, Maximize, Minus, Plus, RotateCw, Scissors, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { removeItem, removeVertex, setTotal } from '../../shared/plan/edit'
import { placementRect, type RackModuleSize } from '../../shared/plan/layout'
import { duplicateWithin, fitPlacement, freezeRacks, guarded, joinRacks, mapRacks, rackSelection, removeRacks, rotateRack, selectedRackIds, setRackModules, setRackPair, splitRack } from '../../shared/plan/racks'
import { fitToDepot, growRect, growWall, rotatePlan, rotateRect, rotateWall, type Rect } from '../../shared/plan/transform'
import type { Plan, RackPlacement } from '../../shared/plan/types'
import { metros } from '../../shared/units'
import { useDock } from '../components/dock'
import { usePlan } from './planStore'

/** Abre el panel "Editando" (si estaba achicado) y lo trae a la vista con un destello. */
export function openEditor() {
  useDock.getState().set('editar', { collapsed: false })
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('[data-dock-id="editar"]') ?? document.querySelector<HTMLElement>('.rack-editor')
    if (!el) return
    el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash')
    setTimeout(() => el.classList.remove('is-flash'), 1400)
  }))
}

export type RectKind = 'zone' | 'area' | 'aisle'

/** Cambia una zona libre, una zona de racks o un pasillo. */
export function patchRect(pl: Plan, kind: RectKind, id: string, fn: (r: Rect) => Rect): Plan {
  if (kind === 'zone') return { ...pl, zones: pl.zones.map((z) => (z.id === id ? { ...z, ...fn(z) } : z)) }
  if (kind === 'area') return { ...pl, rackAreas: pl.rackAreas?.map((z) => (z.id === id ? { ...z, ...fn(z) } : z)) }
  return { ...pl, aisles: pl.aisles?.map((z) => (z.id === id ? { ...z, ...fn(z) } : z)) }
}

interface Props {
  vb: { x: number; y: number; w: number; h: number }
  size: { w: number; h: number }
  layer?: { racks: RackPlacement[]; size: RackModuleSize }
  onFit(): void
}

const Btn = ({ title, onClick, children, disabled }: { title: string; onClick(): void; children: ReactNode; disabled?: boolean }) => (
  <button type="button" className="obar__b" title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>
)
/** Un grupo "− valor +". */
const Step = ({ label, value, onMinus, onPlus, minusOff, plusOff }: { label: string; value: string; onMinus(): void; onPlus(): void; minusOff?: boolean; plusOff?: boolean }) => (
  <span className="obar__step">
    <Btn title={`${label}: menos`} onClick={onMinus} disabled={minusOff}><Minus size={14} aria-hidden /></Btn>
    <span className="obar__v"><small>{label}</small>{value}</span>
    <Btn title={`${label}: más`} onClick={onPlus} disabled={plusOff}><Plus size={14} aria-hidden /></Btn>
  </span>
)

export function ObjectBar({ vb, size, layer, onFit }: Props) {
  const { plan, selection, commit, select, layout, isolate, setIsolate } = usePlan()
  if (!selection) return null
  /** "Ver solo este / estos" (o volver a ver todos si ya se están viendo solos). */
  const isoBtn = (ids: string[]) => {
    const on = !!isolate && isolate.length === ids.length && ids.every((id) => isolate.includes(id))
    const label = on ? 'Ver todos los racks' : ids.length === 1 ? 'Ver solo este rack' : `Ver solo estos ${ids.length}`
    return <button type="button" className={`obar__t${on ? ' is-on' : ''}`} title={label} onClick={() => (on ? (setIsolate(null), onFit()) : setIsolate(ids))}>
      <Focus size={14} aria-hidden /> {on ? 'Ver todos' : 'Ver solo'}
    </button>
  }
  const editBtn = <button type="button" className="obar__t" title="Abrir todas sus medidas en el panel" onClick={openEditor}><SlidersHorizontal size={14} aria-hidden /> Editar</button>
  const del = (fn: (p: Plan) => Plan) => { commit(fn); select(null) }
  let box: { x: number; y: number; w: number; h: number } | null = null
  let body: ReactNode = null
  const rectBar = (kind: RectKind, r: Rect, wLabel: string, dLabel: string, wStep: number, dStep: number) => {
    const ch = (fn: (r: Rect) => Rect) => commit((pl) => patchRect(pl, kind, r && (selection as { id: string }).id, fn))
    const fitted = fitToDepot(plan, r)
    const out = fitted.x !== r.x || fitted.y !== r.y || fitted.w !== r.w || fitted.d !== r.d
    return <>
      <Btn title="Girar 90°" onClick={() => ch((x) => fitToDepot(plan, rotateRect(x)))}><RotateCw size={15} aria-hidden /></Btn>
      <Step label={wLabel} value={metros(r.w)} onMinus={() => ch((x) => growRect(x, 'w', -wStep))} onPlus={() => ch((x) => growRect(x, 'w', wStep))} minusOff={r.w <= 500} />
      <Step label={dLabel} value={metros(r.d)} onMinus={() => ch((x) => growRect(x, 'd', -dStep))} onPlus={() => ch((x) => growRect(x, 'd', dStep))} minusOff={r.d <= 500} />
      {out && <Btn title="Ajustar al depósito (recortar lo que se sale)" onClick={() => ch((x) => fitToDepot(plan, x))}><Maximize size={15} aria-hidden /></Btn>}
      <Btn title="Borrar" onClick={() => del((pl) => removeItem(pl, kind, (selection as { id: string }).id))}><Trash2 size={15} aria-hidden /></Btn>
    </>
  }

  switch (selection.kind) {
    case 'zone': case 'area': {
      const r = selection.kind === 'zone' ? plan.zones.find((z) => z.id === selection.id) : plan.rackAreas?.find((z) => z.id === selection.id)
      if (!r) return null
      box = { x: r.x, y: r.y, w: r.w, h: r.d }
      body = rectBar(selection.kind, r, 'Ancho', 'Fondo', 1000, 1000)
      break
    }
    case 'aisle': {
      const a = plan.aisles?.find((z) => z.id === selection.id)
      if (!a) return null
      box = { x: a.x, y: a.y, w: a.w, h: a.d }
      // en un pasillo, "ancho" es el lado corto y "largo" el largo (de a 0,5 m y de a 1 m)
      const vertical = a.d > a.w
      body = rectBar('aisle', a, vertical ? 'Ancho' : 'Largo', vertical ? 'Largo' : 'Ancho', vertical ? 500 : 1000, vertical ? 1000 : 500)
      break
    }
    case 'column': {
      const c = plan.columns.find((x) => x.id === selection.id)
      if (!c) return null
      box = { x: c.x - c.w / 2, y: c.y - c.d / 2, w: c.w, h: c.d }
      const ch = (k: number) => commit((pl) => ({ ...pl, columns: pl.columns.map((x) => (x.id === c.id ? { ...x, w: Math.max(100, x.w + k), d: Math.max(100, x.d + k) } : x)) }))
      body = <>
        <Step label="Medida" value={metros(c.w)} onMinus={() => ch(-50)} onPlus={() => ch(50)} minusOff={c.w <= 100} />
        <Btn title="Borrar" onClick={() => del((pl) => removeItem(pl, 'column', c.id))}><Trash2 size={15} aria-hidden /></Btn>
      </>
      break
    }
    case 'wall': {
      const w = plan.walls.find((x) => x.id === selection.id)
      if (!w) return null
      box = { x: Math.min(w.a.x, w.b.x), y: Math.min(w.a.y, w.b.y), w: Math.abs(w.b.x - w.a.x), h: Math.abs(w.b.y - w.a.y) }
      const wid = w.id
      const ch = (fn: (x: { a: { x: number; y: number }; b: { x: number; y: number } }) => { a: { x: number; y: number }; b: { x: number; y: number } }) =>
        commit((pl) => ({ ...pl, walls: pl.walls.map((x) => (x.id === wid ? { ...x, ...fn(x) } : x)) }))
      body = <>
        <Btn title="Girar 90°" onClick={() => ch(rotateWall)}><RotateCw size={15} aria-hidden /></Btn>
        <Step label="Largo" value={metros(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y))} onMinus={() => ch((x) => growWall(x, -1000))} onPlus={() => ch((x) => growWall(x, 1000))} />
        <Btn title="Borrar" onClick={() => del((pl) => removeItem(pl, 'wall', w.id))}><Trash2 size={15} aria-hidden /></Btn>
      </>
      break
    }
    case 'text': {
      const t = plan.texts?.find((x) => x.id === selection.id)
      if (!t) return null
      box = { x: t.x - t.size, y: t.y - t.size / 2, w: t.size * 2, h: t.size }
      const ch = (k: number) => commit((pl) => ({ ...pl, texts: pl.texts?.map((x) => (x.id === t.id ? { ...x, size: Math.max(100, x.size + k) } : x)) }))
      body = <>
        <Step label="Letra" value={metros(t.size)} onMinus={() => ch(-100)} onPlus={() => ch(100)} minusOff={t.size <= 100} />
        <Btn title="Borrar" onClick={() => del((pl) => removeItem(pl, 'text', t.id))}><Trash2 size={15} aria-hidden /></Btn>
      </>
      break
    }
    case 'symbol': case 'dim': {
      const sy = selection.kind === 'symbol' ? plan.symbols?.find((x) => x.id === selection.id) : null
      const dm = selection.kind === 'dim' ? plan.dims?.find((x) => x.id === selection.id) : null
      if (sy) box = { x: sy.x - 600, y: sy.y - 600, w: 1200, h: 1200 }
      else if (dm) box = { x: Math.min(dm.a.x, dm.b.x), y: Math.min(dm.a.y, dm.b.y), w: Math.abs(dm.b.x - dm.a.x), h: Math.abs(dm.b.y - dm.a.y) }
      else return null
      const kind = selection.kind, id = selection.id
      body = <Btn title="Borrar" onClick={() => del((pl) => removeItem(pl, kind, id))}><Trash2 size={15} aria-hidden /></Btn>
      break
    }
    case 'rack': {
      const r = layer?.racks.find((x) => x.id === selection.id)
      if (!r || !layer) return null
      const b = placementRect(r)
      box = { x: b.x, y: b.y, w: b.w, h: b.h }
      // cada cambio se prueba antes: si el rack quedaría en un lugar prohibido, el botón se apaga
      const base = freezeRacks(plan, layer.racks)
      const tryEdit = (fn: (p: Plan) => Plan) => { const after = guarded(base, fn(base), r.id, layer.size); return after === base ? null : after }
      const more = tryEdit((p) => setRackModules(p, r.id, r.modules + 1)), less = r.modules > 1 ? tryEdit((p) => setRackModules(p, r.id, r.modules - 1)) : null
      const rot = tryEdit((p) => rotateRack(p, r.id)), pair = tryEdit((p) => setRackPair(p, r.id, !r.pair))
      const dup = duplicateWithin(base, r.id, layout.aisle, layer.size)
      // partir al medio: quedan dos racks que se editan por separado
      const cut = r.modules > 1 ? splitRack(base, r.id, Math.ceil(r.modules / 2), layer.size) : null
      body = <>
        <Btn title="Girar 90°" onClick={() => rot && commit(() => rot)} disabled={!rot}><RotateCw size={15} aria-hidden /></Btn>
        <Step label="Módulos" value={String(r.modules)} onMinus={() => less && commit(() => less)} onPlus={() => more && commit(() => more)} minusOff={!less} plusOff={!more} />
        <button type="button" className="obar__t" onClick={() => pair && commit(() => pair)} disabled={!pair}>{r.pair ? 'Hacer simple' : 'Hacer doble'}</button>
        <Btn title="Duplicar al lado" onClick={() => { if (dup) { commit(() => dup.plan); select({ kind: 'rack', id: dup.id }) } }} disabled={!dup}><Copy size={15} aria-hidden /></Btn>
        <Btn title={r.modules > 1 ? 'Partir en dos (al medio)' : 'Tiene un solo módulo: no se puede partir'} onClick={() => { if (cut) { commit(() => cut.plan); select(rackSelection(cut.ids)) } }} disabled={!cut}><Scissors size={15} aria-hidden /></Btn>
        <Btn title="Borrar" onClick={() => del(() => removeRacks(base, [r.id]))}><Trash2 size={15} aria-hidden /></Btn>
        <span className="obar__v obar__v--info">{metros(fitPlacement(r, layer.size).length)}</span>
        <span className="obar__sep" aria-hidden />
        {isoBtn([r.id])}
        {editBtn}
      </>
      break
    }
    case 'racks': {
      const ids = new Set(selectedRackIds(selection))
      const rs = layer?.racks.filter((x) => ids.has(x.id)) ?? []
      if (!rs.length || !layer) return null
      const bs = rs.map(placementRect)
      const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y))
      box = { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 }
      // a todos los elegidos, cada uno sólo si entra donde queda
      const base = freezeRacks(plan, layer.racks)
      const each = (fn: (p: Plan, id: string) => Plan) => {
        let p = base
        for (const id of ids) p = guarded(p, fn(p, id), id, layer.size)
        commit(() => p)
      }
      const allPair = rs.every((r) => r.pair)
      // unir: sólo si están en la misma fila, uno a continuación del otro
      const joined = joinRacks(base, [...ids], layer.size)
      // alinear: todos con el borde izquierdo (o de arriba) del primero
      const align = (axis: 'x' | 'y') => {
        const v = Math.min(...bs.map((b) => b[axis]))
        commit(() => mapRacks(base, [...ids], (r) => ({ ...r, [axis]: v })))
      }
      body = <>
        <span className="obar__v obar__v--info">{rs.length} racks</span>
        <Btn title="Girar cada uno" onClick={() => each((p, id) => rotateRack(p, id))}><RotateCw size={15} aria-hidden /></Btn>
        <Step label="Módulos" value="±1" onMinus={() => each((p, id) => { const r = p.racks?.find((x) => x.id === id); return r && r.modules > 1 ? setRackModules(p, id, r.modules - 1) : p })}
          onPlus={() => each((p, id) => { const r = p.racks?.find((x) => x.id === id); return r ? setRackModules(p, id, r.modules + 1) : p })} />
        <button type="button" className="obar__t" onClick={() => each((p, id) => setRackPair(p, id, !allPair))}>{allPair ? 'Todos simples' : 'Todos dobles'}</button>
        <Btn title="Alinear a la izquierda" onClick={() => align('x')}><AlignStartVertical size={15} aria-hidden /></Btn>
        <Btn title="Alinear arriba" onClick={() => align('y')}><AlignStartHorizontal size={15} aria-hidden /></Btn>
        <Btn title={joined ? 'Unir en un solo rack' : 'Para unirlos tienen que estar en la misma fila, uno al lado del otro, y ser iguales'} onClick={() => { if (joined) { commit(() => joined.plan); select({ kind: 'rack', id: joined.id }) } }} disabled={!joined}><Combine size={15} aria-hidden /></Btn>
        <Btn title={`Borrar los ${rs.length}`} onClick={() => del(() => removeRacks(base, [...ids]))}><Trash2 size={15} aria-hidden /></Btn>
        <span className="obar__sep" aria-hidden />
        {isoBtn([...ids])}
        {editBtn}
      </>
      break
    }
    case 'edge': case 'vertex': {
      // tocando una pared o una esquina: el depósito entero
      const pts = plan.outline.points
      if (pts.length < 3) return null
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
      box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
      const vertex = selection.kind === 'vertex' ? selection.index : -1
      body = <>
        <span className="obar__v obar__v--info">Depósito</span>
        <Btn title="Girar el depósito 90° (con todo lo de adentro)" onClick={() => { commit(rotatePlan); select(null); setTimeout(onFit, 30) }}><RotateCw size={15} aria-hidden /></Btn>
        <Step label="Largo" value={metros(box.w)} onMinus={() => commit((p) => setTotal(p, 'x', box!.w - 1000))} onPlus={() => commit((p) => setTotal(p, 'x', box!.w + 1000))} />
        <Step label="Ancho" value={metros(box.h)} onMinus={() => commit((p) => setTotal(p, 'y', box!.h - 1000))} onPlus={() => commit((p) => setTotal(p, 'y', box!.h + 1000))} />
        {vertex >= 0 && pts.length > 3 && <Btn title="Quitar esta esquina" onClick={() => del((p) => removeVertex(p, vertex))}><Trash2 size={15} aria-hidden /></Btn>}
      </>
      break
    }
    default: return null
  }
  if (!box) return null
  // arriba del objeto (o abajo si no hay lugar), sin salirse del plano
  const sx = ((box.x + box.w / 2 - vb.x) / vb.w) * size.w
  const top = ((box.y - vb.y) / vb.h) * size.h, bottom = ((box.y + box.h - vb.y) / vb.h) * size.h
  const y = top > 70 ? top - 14 : Math.min(size.h - 60, bottom + 14)
  // media barra (las de racks son más largas), para que no se salga por los costados
  const half = Math.min(size.w / 2, selection.kind === 'rack' || selection.kind === 'racks' ? 330 : 170)
  return (
    <div className={`obar${top > 70 ? '' : ' obar--below'}`} role="toolbar" aria-label="Acciones sobre lo elegido"
      style={{ left: Math.max(half, Math.min(size.w - half, sx)), top: Math.max(8, y) }}
      onPointerDown={(e) => e.stopPropagation()}>
      {body}
    </div>
  )
}
