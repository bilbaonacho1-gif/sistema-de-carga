import { describe, expect, it } from 'vitest'
import { sanitizeProfiles } from './profiles'
import { presetShape, resizeShape, sanitizeShape, sectionOutline, sectionSize, shapeFromDxf } from './section'

describe('forma de una pieza (corte con puntos)', () => {
  it('una caja de chapa tiene contorno exterior y hueco', () => {
    const o = sectionOutline(presetShape('caja', 50, 100, 2))
    expect(o.holes).toHaveLength(1)
    expect(sectionSize(presetShape('caja', 50, 100, 2))).toEqual({ w: 52, h: 102 })
  })
  it('una C abierta es una sola tira de chapa', () => {
    const o = sectionOutline(presetShape('c', 100, 80, 2.5))
    expect(o.holes).toHaveLength(0)
    expect(o.outer).toHaveLength(12)
  })
  it('cambiar la medida total estira la forma', () => {
    const s = resizeShape(presetShape('u', 100, 80), 150, 40)
    expect(Math.max(...s.points.map((p) => p.x))).toBe(150)
    expect(Math.max(...s.points.map((p) => p.y))).toBe(40)
  })
  it('descarta formas sin puntos y achica las demasiado grandes', () => {
    expect(sanitizeShape({ points: [{ x: 1, y: 1 }], closed: false })).toBeUndefined()
    const big = sanitizeShape({ points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 1500 }], closed: true, solid: true })!
    expect(Math.max(...big.points.map((p) => p.x))).toBe(320)
  })
  it('las medidas de la pieza salen de su forma', () => {
    const { beams, uprights } = sanitizeProfiles({
      beams: [{ id: 'mv-1', name: 'x', height: 10, depth: 10, capacityBySpan: [{ maxSpan: 3600, capacity: 2000 }], shape: presetShape('doble-t', 60, 140) }],
      uprights: [{ id: 'mp-1', name: 'y', faceWidth: 10, depth: 10, thickness: 2, maxFrameLoad: 9000, shape: presetShape('omega', 120, 70, 3) }],
    })
    expect([beams[0].depth, beams[0].height]).toEqual([60, 140])
    expect([uprights[0].faceWidth, uprights[0].depth]).toEqual([120, 73])
    expect(uprights[0].thickness).toBe(3)
  })
})

describe('cargar un dibujo de AutoCAD (DXF)', () => {
  const dxf = (entities: string) => `0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`
  it('lee una polilínea cerrada como contorno macizo (con la y dada vuelta)', () => {
    const s = shapeFromDxf(dxf('0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n10\n50\n20\n0\n10\n50\n20\n120\n10\n0\n20\n120\n'))!
    expect(s.closed && s.solid).toBe(true)
    expect(s.points).toHaveLength(4)
    expect(sectionSize(s)).toEqual({ w: 50, h: 120 })
  })
  it('une líneas sueltas que se tocan por las puntas', () => {
    const line = (a: number[], b: number[]) => `0\nLINE\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}\n`
    const s = shapeFromDxf(dxf(line([0, 0], [0, 80]) + line([100, 80], [100, 0]) + line([0, 80], [100, 80])))!
    expect(s.closed).toBe(false)
    expect(s.points).toHaveLength(4)
  })
  it('un archivo sin dibujo devuelve null', () => {
    expect(shapeFromDxf('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n')).toBeNull()
    expect(shapeFromDxf('hola')).toBeNull()
  })
})
