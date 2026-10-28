import { describe, expect, it } from 'vitest'
import { arcOf, dxfBulge, edgeLength, edges, nearestOnEdge, planArea, planPerimeter, pointInPlan, pointOnEdge, rectanglePlan } from './geometry'

describe('paredes rectas y curvas', () => {
  it('un depósito rectangular de 30 × 20 m', () => {
    const p = rectanglePlan(30_000, 20_000)
    expect(planArea(p.outline)).toBeCloseTo(600, 3)
    expect(planPerimeter(p.outline)).toBeCloseTo(100_000, 3)
  })

  it('una flecha de media cuerda es un semicírculo', () => {
    const e = { index: 0, a: { x: 0, y: 0 }, b: { x: 2000, y: 0 }, sag: -1000 }
    const arc = arcOf(e)!
    expect(arc.radius).toBeCloseTo(1000, 6)
    expect(arc.center.x).toBeCloseTo(1000, 6)
    expect(arc.center.y).toBeCloseTo(0, 6)
    expect(edgeLength(e)).toBeCloseTo(Math.PI * 1000, 3)
    // el punto medio del arco queda del lado de la flecha (izquierda = +y, acá negativa → -y)
    expect(pointOnEdge(e, 0.5).y).toBeCloseTo(-1000, 3)
    expect(pointOnEdge(e, 1).x).toBeCloseTo(2000, 3)
    expect(dxfBulge(e)).toBeCloseTo(-1, 6)
  })

  it('una pared curva hacia afuera suma superficie y hacia adentro resta', () => {
    const afuera = rectanglePlan(2000, 2000)
    afuera.outline.sags[0] = -1000
    const adentro = rectanglePlan(2000, 2000)
    adentro.outline.sags[0] = 1000
    expect(planArea(afuera.outline)).toBeCloseTo(4 + Math.PI / 2, 2)
    expect(planArea(adentro.outline)).toBeCloseTo(4 - Math.PI / 2, 2)
    expect(pointInPlan({ x: 1000, y: -500 }, afuera.outline)).toBe(true)
    expect(pointInPlan({ x: 1000, y: 500 }, adentro.outline)).toBe(false)
  })

  it('encuentra el punto de la pared más cercano', () => {
    const [e] = edges(rectanglePlan(10_000, 5000).outline)
    const n = nearestOnEdge(e, { x: 2500, y: 300 })
    expect(n.t).toBeCloseTo(0.25, 6)
    expect(n.distance).toBeCloseTo(300, 6)
  })
})
