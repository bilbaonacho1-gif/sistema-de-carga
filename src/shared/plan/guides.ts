/**
 * GUÍAS INTELIGENTES PARA UBICAR RACKS (como las de Adobe o el "tracking" de AutoCAD):
 *  - al mover o dibujar un rack, se alinea solo con los bordes de los otros racks y se pega
 *    dejando justo el pasillo elegido (o espalda con espalda);
 *  - las distancias del rack a lo que tiene alrededor (paredes y otros racks) en las 4 direcciones.
 */
import { rayToPolygon } from './geometry'
import type { PlanPoint } from './types'

export interface Box { x: number; y: number; w: number; h: number }
/** Una guía a dibujar: línea de alineación, o tramo de pasillo con su medida. */
export interface Guide { a: PlanPoint; b: PlanPoint; kind: 'align' | 'gap'; value?: number }

/**
 * Corre `r` (en su posición pedida) al lugar "lindo" más cercano: alineado con otro rack o a un
 * pasillo exacto de él. `tol` en mm. Devuelve la posición y las guías que lo explican.
 */
export function snapRack(r: Box, others: Box[], aisle: number, tol: number): { x: number; y: number; guides: Guide[] } {
  type Pick = { v: number; d: number; o: Box; kind: 'align' | 'gap'; gap?: number }
  let bestX = null as Pick | null
  let bestY = null as Pick | null
  for (const o of others) {
    const overlapY = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y) > -aisle * 2
    const overlapX = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x) > -aisle * 2
    // en X: alinear bordes (siempre) y, si están a la misma altura, pegarse con pasillo o espalda con espalda
    const xs: { v: number; kind: 'align' | 'gap'; gap?: number }[] = [
      { v: o.x, kind: 'align' }, { v: o.x + o.w - r.w, kind: 'align' },
    ]
    if (overlapY) xs.push({ v: o.x + o.w + aisle, kind: 'gap', gap: aisle }, { v: o.x - aisle - r.w, kind: 'gap', gap: aisle }, { v: o.x + o.w, kind: 'gap', gap: 0 }, { v: o.x - r.w, kind: 'gap', gap: 0 })
    for (const c of xs) { const d = Math.abs(c.v - r.x); if (d <= tol && (!bestX || d < bestX.d)) bestX = { ...c, d, o } }
    const ys: { v: number; kind: 'align' | 'gap'; gap?: number }[] = [
      { v: o.y, kind: 'align' }, { v: o.y + o.h - r.h, kind: 'align' },
    ]
    if (overlapX) ys.push({ v: o.y + o.h + aisle, kind: 'gap', gap: aisle }, { v: o.y - aisle - r.h, kind: 'gap', gap: aisle }, { v: o.y + o.h, kind: 'gap', gap: 0 }, { v: o.y - r.h, kind: 'gap', gap: 0 })
    for (const c of ys) { const d = Math.abs(c.v - r.y); if (d <= tol && (!bestY || d < bestY.d)) bestY = { ...c, d, o } }
  }
  const x = bestX ? Math.round(bestX.v) : r.x, y = bestY ? Math.round(bestY.v) : r.y
  const guides: Guide[] = []
  const at: Box = { ...r, x, y }
  if (bestX) {
    const o = bestX.o
    if (bestX.kind === 'align') {
      const gx = Math.abs(x - o.x) < 1 ? x : x + r.w
      guides.push({ a: { x: gx, y: Math.min(at.y, o.y) }, b: { x: gx, y: Math.max(at.y + at.h, o.y + o.h) }, kind: 'align' })
    } else if (bestX.gap) {
      const yy = (Math.max(at.y, o.y) + Math.min(at.y + at.h, o.y + o.h)) / 2
      const left = x > o.x ? o.x + o.w : x + r.w, right = x > o.x ? x : o.x
      guides.push({ a: { x: left, y: yy }, b: { x: right, y: yy }, kind: 'gap', value: right - left })
    }
  }
  if (bestY) {
    const o = bestY.o
    if (bestY.kind === 'align') {
      const gy = Math.abs(y - o.y) < 1 ? y : y + r.h
      guides.push({ a: { x: Math.min(at.x, o.x), y: gy }, b: { x: Math.max(at.x + at.w, o.x + o.w), y: gy }, kind: 'align' })
    } else if (bestY.gap) {
      const xx = (Math.max(at.x, o.x) + Math.min(at.x + at.w, o.x + o.w)) / 2
      const top = y > o.y ? o.y + o.h : y + r.h, bottom = y > o.y ? y : o.y
      guides.push({ a: { x: xx, y: top }, b: { x: xx, y: bottom }, kind: 'gap', value: bottom - top })
    }
  }
  return { x, y, guides }
}

/** Distancia libre del rack a lo que tiene alrededor (paredes del contorno y otros racks), en las 4 direcciones. */
export function clearances(r: Box, poly: PlanPoint[], others: Box[], max = 60_000): Guide[] {
  const out: Guide[] = []
  const dirs: [PlanPoint, PlanPoint][] = [
    [{ x: 1, y: 0 }, { x: r.x + r.w, y: r.y + r.h / 2 }], [{ x: -1, y: 0 }, { x: r.x, y: r.y + r.h / 2 }],
    [{ x: 0, y: 1 }, { x: r.x + r.w / 2, y: r.y + r.h }], [{ x: 0, y: -1 }, { x: r.x + r.w / 2, y: r.y }],
  ]
  for (const [d, p] of dirs) {
    let best = poly.length >= 3 ? rayToPolygon(p, d, poly) : null
    for (const o of others) {
      // ¿el rayo pega en este rack?
      if (d.x) {
        if (p.y < o.y || p.y > o.y + o.h) continue
        const t = d.x > 0 ? o.x - p.x : p.x - (o.x + o.w)
        if (t >= -1 && (best === null || t < best)) best = Math.max(0, t)
      } else {
        if (p.x < o.x || p.x > o.x + o.w) continue
        const t = d.y > 0 ? o.y - p.y : p.y - (o.y + o.h)
        if (t >= -1 && (best === null || t < best)) best = Math.max(0, t)
      }
    }
    if (best === null || best > max || best < 1) continue
    out.push({ a: p, b: { x: p.x + d.x * best, y: p.y + d.y * best }, kind: 'gap', value: best })
  }
  return out
}
