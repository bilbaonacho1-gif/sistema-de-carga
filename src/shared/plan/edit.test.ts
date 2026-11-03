import { describe, expect, it } from 'vitest'
import { columnGrid, removeVertex, sagFromPoint, setEdgeLength, setSag, splitEdge } from './edit'
import { edgeLength, edges, planArea, planPerimeter, pointInPlan, rectanglePlan } from './geometry'

describe('edición del contorno', () => {
  it('partir una pared curva no cambia la forma', () => {
    const p = setSag(rectanglePlan(20_000, 10_000), 0, -3000)
    const q = splitEdge(p, 0)
    expect(q.outline.points).toHaveLength(5)
    expect(planArea(q.outline)).toBeCloseTo(planArea(p.outline), 1)
    expect(planPerimeter(q.outline)).toBeCloseTo(planPerimeter(p.outline), -1)
  })

  it('quitar un punto une las paredes vecinas y no baja de 3 puntos', () => {
    const p = splitEdge(rectanglePlan(10_000, 10_000), 0)
    const q = removeVertex(p, 1)
    expect(q.outline.points).toHaveLength(4)
    expect(planArea(q.outline)).toBeCloseTo(100, 3)
    const triangulo = removeVertex(q, 0)
    expect(removeVertex(triangulo, 0).outline.points).toHaveLength(3)
  })

  it('escribir el largo de una pared mueve su punto final', () => {
    const p = setEdgeLength(rectanglePlan(30_000, 20_000), 0, 25_000)
    expect(edgeLength(edges(p.outline)[0])).toBeCloseTo(25_000, 3)
    expect(p.outline.points[1]).toEqual({ x: 25_000, y: 0 })
  })

  it('arrastrar el medio de la pared la curva, con tope de medio círculo', () => {
    const p = rectanglePlan(10_000, 10_000)
    expect(sagFromPoint(p, 0, { x: 5000, y: -2000 })).toBe(-2000)
    expect(sagFromPoint(p, 0, { x: 5000, y: -9000 })).toBe(-5000)
    expect(sagFromPoint(p, 0, { x: 5000, y: 10 })).toBe(0)
  })

  it('la grilla de columnas queda adentro del depósito', () => {
    const p = columnGrid(rectanglePlan(30_000, 20_000), 10_000, 10_000, 400)
    expect(p.columns).toHaveLength(2)
    expect(p.columns.every((c) => pointInPlan(c, p.outline))).toBe(true)
  })

  it('zonas de racks y pasillos dibujados a mano', async () => {
    const { drawnRect, rotateAisle } = await import('./edit')
    const { rectanglePlan } = await import('./geometry')
    const plan = rectanglePlan(30_000, 20_000)
    // un pasillo arrastrado a lo largo sale con el ancho elegido y no atraviesa la pared
    expect(drawnRect('aisle', { x: 5000, y: 10_000 }, { x: 40_000, y: 10_300 }, plan, 3000)).toEqual({ x: 5000, y: 8500, w: 25_000, d: 3000 })
    // un clic: de lado a lado
    expect(drawnRect('aisle', { x: 12_000, y: 6000 }, { x: 12_000, y: 6000 }, plan, 3000)).toEqual({ x: 0, y: 4500, w: 30_000, d: 3000 })
    // una zona arrastrada es el rectángulo marcado
    expect(drawnRect('area', { x: 8000, y: 9000 }, { x: 2000, y: 3000 }, plan, 3000)).toEqual({ x: 2000, y: 3000, w: 6000, d: 6000 })
    const girado = rotateAisle({ ...plan, aisles: [{ id: 'p', x: 0, y: 4500, w: 30_000, d: 3000 }] }, 'p').aisles![0]
    expect(girado).toEqual({ id: 'p', x: 13_500, y: 0, w: 3000, d: 20_000 })
  })
})

