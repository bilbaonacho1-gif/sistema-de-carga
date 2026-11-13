/**
 * COPIAR, PEGAR, DUPLICAR Y MOVER CON LAS FLECHAS (como Ctrl+C / Ctrl+V / Ctrl+D en AutoCAD).
 * Funciones puras: reciben el plano y devuelven otro.
 */
import { newId } from './edit'
import { freezeRacks, mapRacks, selectedRackIds } from './racks'
import type { Plan, PlanSelection, RackPlacement } from './types'

type Item =
  | { kind: 'column'; v: Plan['columns'][number] }
  | { kind: 'zone'; v: Plan['zones'][number] }
  | { kind: 'wall'; v: Plan['walls'][number] }
  | { kind: 'area'; v: NonNullable<Plan['rackAreas']>[number] }
  | { kind: 'aisle'; v: NonNullable<Plan['aisles']>[number] }
  | { kind: 'text'; v: NonNullable<Plan['texts']>[number] }
  | { kind: 'symbol'; v: NonNullable<Plan['symbols']>[number] }
  | { kind: 'dim'; v: NonNullable<Plan['dims']>[number] }
  | { kind: 'rack'; v: RackPlacement }

export interface Clip { items: Item[] }

/** Lo seleccionado, listo para pegar (null si no se puede copiar: una pared del contorno, una esquina…). */
export function copySelection(plan: Plan, sel: PlanSelection, racks: RackPlacement[]): Clip | null {
  if (!sel) return null
  const find = <T extends { id: string }>(list: T[] | undefined, id: string) => list?.find((x) => x.id === id)
  switch (sel.kind) {
    case 'column': { const v = find(plan.columns, sel.id); return v ? { items: [{ kind: 'column', v }] } : null }
    case 'zone': { const v = find(plan.zones, sel.id); return v ? { items: [{ kind: 'zone', v }] } : null }
    case 'wall': { const v = find(plan.walls, sel.id); return v ? { items: [{ kind: 'wall', v }] } : null }
    case 'area': { const v = find(plan.rackAreas, sel.id); return v ? { items: [{ kind: 'area', v }] } : null }
    case 'aisle': { const v = find(plan.aisles, sel.id); return v ? { items: [{ kind: 'aisle', v }] } : null }
    case 'text': { const v = find(plan.texts, sel.id); return v ? { items: [{ kind: 'text', v }] } : null }
    case 'symbol': { const v = find(plan.symbols, sel.id); return v ? { items: [{ kind: 'symbol', v }] } : null }
    case 'dim': { const v = find(plan.dims, sel.id); return v ? { items: [{ kind: 'dim', v }] } : null }
    case 'rack': case 'racks': {
      const ids = new Set(selectedRackIds(sel))
      const items = racks.filter((r) => ids.has(r.id)).map((v) => ({ kind: 'rack' as const, v }))
      return items.length ? { items } : null
    }
    default: return null
  }
}

/** Pega lo copiado corrido (dx, dy). Devuelve el plano y la selección de lo pegado. */
export function pasteClip(plan: Plan, clip: Clip, dx: number, dy: number, racks: RackPlacement[]): { plan: Plan; selection: PlanSelection } {
  let p = plan
  const rackIds: string[] = []
  let last: PlanSelection = null
  for (const it of clip.items) {
    switch (it.kind) {
      case 'column': { const id = newId('c'); p = { ...p, columns: [...p.columns, { ...it.v, id, x: it.v.x + dx, y: it.v.y + dy }] }; last = { kind: 'column', id }; break }
      case 'zone': { const id = newId('z'); p = { ...p, zones: [...p.zones, { ...it.v, id, x: it.v.x + dx, y: it.v.y + dy }] }; last = { kind: 'zone', id }; break }
      case 'wall': { const id = newId('w'); p = { ...p, walls: [...p.walls, { ...it.v, id, a: { x: it.v.a.x + dx, y: it.v.a.y + dy }, b: { x: it.v.b.x + dx, y: it.v.b.y + dy } }] }; last = { kind: 'wall', id }; break }
      case 'area': { const id = newId('a'); p = { ...p, rackAreas: [...(p.rackAreas ?? []), { ...it.v, id, x: it.v.x + dx, y: it.v.y + dy, name: `${it.v.name} (copia)` }] }; last = { kind: 'area', id }; break }
      case 'aisle': { const id = newId('p'); p = { ...p, aisles: [...(p.aisles ?? []), { ...it.v, id, x: it.v.x + dx, y: it.v.y + dy }] }; last = { kind: 'aisle', id }; break }
      case 'text': { const id = newId('t'); p = { ...p, texts: [...(p.texts ?? []), { ...it.v, id, x: it.v.x + dx, y: it.v.y + dy }] }; last = { kind: 'text', id }; break }
      case 'symbol': { const id = newId('s'); p = { ...p, symbols: [...(p.symbols ?? []), { ...it.v, id, x: it.v.x + dx, y: it.v.y + dy }] }; last = { kind: 'symbol', id }; break }
      case 'dim': { const id = newId('k'); p = { ...p, dims: [...(p.dims ?? []), { ...it.v, id, a: { x: it.v.a.x + dx, y: it.v.a.y + dy }, b: { x: it.v.b.x + dx, y: it.v.b.y + dy } }] }; last = { kind: 'dim', id }; break }
      case 'rack': {
        const id = newId('r')
        p = freezeRacks(p, racks)
        p = { ...p, racks: [...(p.racks ?? []), { ...it.v, id, x: it.v.x + dx, y: it.v.y + dy }] }
        rackIds.push(id)
        break
      }
    }
  }
  const selection: PlanSelection = rackIds.length > 1 ? { kind: 'racks', ids: rackIds } : rackIds.length === 1 ? { kind: 'rack', id: rackIds[0] } : last
  return { plan: p, selection }
}

/** Mueve lo seleccionado (dx, dy), por ejemplo con las flechas del teclado. */
export function moveSelection(plan: Plan, sel: PlanSelection, dx: number, dy: number, racks: RackPlacement[]): Plan {
  if (!sel) return plan
  const mv = <T extends { id: string; x: number; y: number }>(list: T[] | undefined, id: string) => list?.map((x) => (x.id === id ? { ...x, x: x.x + dx, y: x.y + dy } : x))
  switch (sel.kind) {
    case 'vertex': return { ...plan, outline: { ...plan.outline, points: plan.outline.points.map((q, i) => (i === sel.index ? { x: q.x + dx, y: q.y + dy } : q)) } }
    case 'column': return { ...plan, columns: mv(plan.columns, sel.id)! }
    case 'zone': return { ...plan, zones: mv(plan.zones, sel.id)! }
    case 'area': return { ...plan, rackAreas: mv(plan.rackAreas, sel.id) }
    case 'aisle': return { ...plan, aisles: mv(plan.aisles, sel.id) }
    case 'text': return { ...plan, texts: mv(plan.texts, sel.id) }
    case 'symbol': return { ...plan, symbols: mv(plan.symbols, sel.id) }
    case 'object': return { ...plan, objects: mv(plan.objects, sel.id) }
    case 'wall': return { ...plan, walls: plan.walls.map((w) => (w.id === sel.id ? { ...w, a: { x: w.a.x + dx, y: w.a.y + dy }, b: { x: w.b.x + dx, y: w.b.y + dy } } : w)) }
    case 'dim': return { ...plan, dims: plan.dims?.map((d) => (d.id === sel.id ? { ...d, a: { x: d.a.x + dx, y: d.a.y + dy }, b: { x: d.b.x + dx, y: d.b.y + dy } } : d)) }
    case 'rack': case 'racks': return mapRacks(freezeRacks(plan, racks), selectedRackIds(sel), (r) => ({ ...r, x: r.x + dx, y: r.y + dy }))
    default: return plan
  }
}
