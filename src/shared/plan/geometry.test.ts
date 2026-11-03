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

describe('cotas', () => {
  it('la normal de afuera apunta fuera del depósito en cualquier sentido de dibujo', async () => {
    const { outwardNormal, outlinePolygon } = await import('./geometry')
    const p = rectanglePlan(10_000, 5000)
    const poly = outlinePolygon(p.outline)
    const [arriba, derecha] = edges(p.outline)
    expect(outwardNormal(arriba, poly)).toEqual({ x: -0, y: -1 })
    expect(outwardNormal(derecha, poly).x).toBeCloseTo(1, 9)
    // dibujado al revés (sentido horario ↔ antihorario) sigue apuntando afuera
    const inv = { ...p, outline: { points: [...p.outline.points].reverse(), sags: [0, 0, 0, 0] } }
    const e0 = edges(inv.outline)[0]   // de (0,5000) a (10000,5000): la de abajo
    expect(outwardNormal(e0, outlinePolygon(inv.outline)).y).toBeCloseTo(1, 9)
  })

  it('mide la distancia de una columna a las paredes', async () => {
    const { rayToPolygon, outlinePolygon } = await import('./geometry')
    const poly = outlinePolygon(rectanglePlan(30_000, 20_000).outline)
    const c = { x: 10_000, y: 5000 }
    expect(rayToPolygon(c, { x: -1, y: 0 }, poly)).toBeCloseTo(10_000, 6)
    expect(rayToPolygon(c, { x: 1, y: 0 }, poly)).toBeCloseTo(20_000, 6)
    expect(rayToPolygon(c, { x: 0, y: -1 }, poly)).toBeCloseTo(5000, 6)
    expect(rayToPolygon(c, { x: 0, y: 1 }, poly)).toBeCloseTo(15_000, 6)
  })
})
