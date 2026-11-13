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

describe('doblar la chapa', () => {
  it('lee el ángulo de cada doblez', async () => {
    const { bendAt, presetShape: preset } = await import('./section')
    const u = preset('u', 100, 80)
    expect(bendAt(u, 0)).toBeNull()                 // una punta no es un doblez
    expect(bendAt(u, 1)?.angle).toBe(90)
    expect(bendAt(u, 1)!.side).toBe(-bendAt(preset('l', 100, 80), 1)!.side)
  })
  it('doblar gira el resto de la chapa y no cambia el largo de los tramos', async () => {
    const { bendAt, setBend, segmentLengths, presetShape: preset } = await import('./section')
    const u = preset('u', 100, 80)
    const bent = setBend(u, 1, 120)
    expect(bendAt(bent, 1)!.angle).toBeCloseTo(120, 0)
    expect(bendAt(bent, 2)!.angle).toBeCloseTo(90, 0)       // el doblez siguiente queda como estaba
    segmentLengths(bent).forEach((l, i) => expect(l).toBeCloseTo(segmentLengths(u)[i], 0))
    // enderezar del todo y volver a doblar para el otro lado
    expect(bendAt(setBend(u, 1, 180), 1)!.angle).toBeCloseTo(180, 0)
    expect(bendAt(setBend(u, 1, 90, 1), 1)!.side).toBe(1)
  })
  it('cambiar el largo de un tramo corre lo que sigue', async () => {
    const { setSegmentLength, segmentLengths, developedLength, presetShape: preset } = await import('./section')
    const u = preset('u', 100, 80)
    const longer = setSegmentLength(u, 1, 150)
    expect(segmentLengths(longer)).toEqual([80, 150, 80])
    expect(developedLength(longer)).toBe(310)
  })
  it('con radio, cada doblez es un arco que arranca y termina sobre los tramos', async () => {
    const { roundedLine, presetShape: preset } = await import('./section')
    const l = { ...preset('l', 100, 80, 2), radius: 6 }
    const line = roundedLine(l)
    expect(line.length).toBeGreaterThan(5)
    // el arco no se sale de la esquina: todos los puntos quedan dentro del rectángulo de la L
    expect(line.every((p) => p.x >= -0.01 && p.x <= 100.01 && p.y >= -0.01 && p.y <= 80.01)).toBe(true)
    // radio en el eje = 6 + medio espesor: el arco arranca a 7 mm de la esquina
    expect(line[1].x).toBeCloseTo(0, 1)
    expect(line[1].y).toBeCloseTo(73, 1)
    // un radio enorme se achica para entrar en los tramos
    const big = roundedLine({ ...preset('l', 20, 20, 2), radius: 40 })
    expect(big.every((p) => p.x >= -0.01 && p.x <= 20.01 && p.y >= -0.01 && p.y <= 20.01)).toBe(true)
  })

  it('una pieza puede tener varias formas: todas cuentan en la medida y viajan juntas', async () => {
    const { fromParts, partsOf, normalizeShape, sectionOutlines, shiftPart, scaleShape } = await import('./section')
    const a = presetShape('caja', 50, 100, 2), b = shiftPart(presetShape('macizo', 20, 10), 70, 0)
    const s = fromParts([a, b])
    expect(partsOf(s)).toHaveLength(2)
    expect(sectionOutlines(s)).toHaveLength(2)
    // 50 de la caja + 20 de hueco + 20 de la planchuela (más la chapa de la caja de un lado)
    expect(sectionSize(s)).toEqual({ w: 91, h: 102 })
    // correr una forma a la izquierda de la otra: la pieza vuelve a arrancar en 0 y nada cambia de tamaño
    const moved = normalizeShape(fromParts([a, shiftPart(b, -100, 0)]))
    expect(Math.min(...partsOf(moved).flatMap((p) => p.points.map((q) => q.x)))).toBe(0)
    expect(partsOf(moved)[0].points[0].x).toBe(30)
    // se guarda y se limpia entera, sin perder las formas de más
    const clean = sanitizeShape(JSON.parse(JSON.stringify(s)))!
    expect(clean.more).toHaveLength(1)
    expect(sectionSize(clean)).toEqual({ w: 91, h: 102 })
    expect(sectionSize(scaleShape(s, 2)).w).toBeGreaterThan(175)
    // una sola forma: no queda `more`
    expect(sanitizeShape(a)!.more).toBeUndefined()
  })
  it('un DXF con dos trazos separados trae las dos formas', async () => {
    const { partsOf } = await import('./section')
    const poly = (x: number, w: number, h: number) => `0\nLWPOLYLINE\n90\n4\n70\n1\n10\n${x}\n20\n0\n10\n${x + w}\n20\n0\n10\n${x + w}\n20\n${h}\n10\n${x}\n20\n${h}\n`
    const s = shapeFromDxf(`0\nSECTION\n2\nENTITIES\n${poly(0, 50, 120) + poly(80, 30, 40)}0\nENDSEC\n0\nEOF\n`)!
    expect(partsOf(s)).toHaveLength(2)
    expect(sectionSize(s)).toEqual({ w: 110, h: 120 })
  })
})
