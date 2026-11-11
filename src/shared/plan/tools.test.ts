import { describe, expect, it } from 'vitest'
import { planChecks } from './checks'
import { planToDxf } from './dxf'
import { rectanglePlan } from './geometry'
import { nearestSnap, snapPoints } from './snap'
import type { RackPlacement } from './types'

const rack = (o: Partial<RackPlacement> = {}): RackPlacement => ({ id: 'r1', x: 2000, y: 2000, orientation: 'x', modules: 3, length: 8400, depth: 1100, pair: false, ...o })

describe('imán a objetos', () => {
  it('se pega a la esquina del depósito, al medio de una pared y a una columna', () => {
    const plan = { ...rectanglePlan(30_000, 20_000), columns: [{ id: 'c', x: 10_000, y: 10_000, shape: 'rect' as const, w: 400, d: 400 }] }
    const pts = snapPoints(plan)
    expect(nearestSnap(pts, { x: 30_200, y: -150 }, 500)).toMatchObject({ x: 30_000, y: 0, kind: 'esquina' })
    expect(nearestSnap(pts, { x: 15_100, y: 20_100 }, 500)).toMatchObject({ x: 15_000, y: 20_000, kind: 'medio' })
    expect(nearestSnap(pts, { x: 10_050, y: 9_950 }, 500)).toMatchObject({ x: 10_000, y: 10_000, kind: 'centro' })
    expect(nearestSnap(pts, { x: 5000, y: 5000 }, 500)).toBeNull()
  })
})

describe('revisión del plano', () => {
  it('avisa si el rack toca el techo, si el pasillo es angosto y si un rack tapa un portón', () => {
    const plan = { ...rectanglePlan(30_000, 20_000), wallHeight: 6000, doors: [{ id: 'd', edge: 0, t: 0.1, width: 4000, height: 4500 }] }
    const checks = planChecks(plan, { racks: [{ placement: rack({ x: 1000, y: 1000 }), height: 6000 }], issues: {}, aisle: 2000 })
    const texts = checks.map((c) => c.text).join(' | ')
    expect(texts).toMatch(/no deja 0,3 m libres bajo el techo/)
    expect(texts).toMatch(/angostos/)
    expect(texts).toMatch(/delante de un portón/)
    expect(checks.find((c) => /techo/.test(c.text))?.target).toEqual({ kind: 'rack', id: 'r1' })
  })

  it('sin problemas, sólo quedan consejos', () => {
    const plan = { ...rectanglePlan(30_000, 20_000), symbols: [{ id: 's', x: 1, y: 1, kind: 'salida' as const }, { id: 'm', x: 2, y: 2, kind: 'matafuego' as const }], doors: [{ id: 'd', edge: 0, t: 0.9, width: 3000, height: 4000 }] }
    const checks = planChecks(plan, { racks: [{ placement: rack({ y: 12_000 }), height: 6000 }], issues: {}, aisle: 3000 })
    expect(checks.filter((c) => c.level !== 'consejo')).toEqual([])
  })
})

describe('exportar a AutoCAD', () => {
  it('arma un DXF con capas, contorno, columnas, racks con bastidores y cotas', () => {
    const plan = { ...rectanglePlan(30_000, 20_000), columns: [{ id: 'c', x: 10_000, y: 10_000, shape: 'round' as const, w: 400, d: 400 }],
      dims: [{ id: 'k', a: { x: 0, y: 0 }, b: { x: 30_000, y: 0 }, offset: -1000 }], texts: [{ id: 't', x: 5000, y: 5000, text: 'Oficina', size: 400 }] }
    const dxf = planToDxf(plan, [rack()], { width: 2700, depth: 1100, upright: 80, backToBackGap: 200 }, new Map([['r1', 'A1']]))
    expect(dxf.startsWith('0\nSECTION')).toBe(true)
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
    for (const s of ['CONTORNO', 'RACKS', 'BASTIDORES', 'COTAS', 'CIRCLE', 'Oficina', 'A1', '30 m']) expect(dxf).toContain(s)
    // el contorno va con Y hacia arriba (20 m de fondo → y = -20000)
    expect(dxf).toContain('\n-20000\n')
    // 4 bastidores para 3 módulos
    expect(dxf.split('\n8\nBASTIDORES\n').length - 1).toBe(4)
  })
})

describe('copiar, pegar y mover', () => {
  it('pega una columna corrida y mueve un texto con las flechas', async () => {
    const { copySelection, pasteClip, moveSelection } = await import('./clipboard')
    const plan = { ...rectanglePlan(30_000, 20_000), columns: [{ id: 'c', x: 5000, y: 5000, shape: 'rect' as const, w: 400, d: 400 }], texts: [{ id: 't', x: 1000, y: 1000, text: 'Hola', size: 400 }] }
    const clip = copySelection(plan, { kind: 'column', id: 'c' }, [])!
    const r = pasteClip(plan, clip, 1000, 1000, [])
    expect(r.plan.columns).toHaveLength(2)
    expect(r.plan.columns[1]).toMatchObject({ x: 6000, y: 6000 })
    expect(r.selection).toMatchObject({ kind: 'column' })
    expect(moveSelection(plan, { kind: 'text', id: 't' }, 100, -100, []).texts![0]).toMatchObject({ x: 1100, y: 900 })
  })

  it('pega varios racks y quedan elegidos', async () => {
    const { copySelection, pasteClip } = await import('./clipboard')
    const plan = rectanglePlan(30_000, 20_000)
    const racks = [rack({ id: 'a' }), rack({ id: 'b', y: 6000 })]
    const r = pasteClip(plan, copySelection(plan, { kind: 'racks', ids: ['a', 'b'] }, racks)!, 0, 8000, racks)
    expect(r.plan.racks).toHaveLength(4)
    expect(r.selection).toMatchObject({ kind: 'racks' })
  })
})

describe('guías para ubicar racks', () => {
  it('se alinea con otra fila y se pega dejando el pasillo justo', async () => {
    const { snapRack } = await import('./guides')
    const otro = { x: 2000, y: 2000, w: 20_000, h: 2300 }
    // pedido 200 mm corrido en X y casi a 3 m de pasillo en Y
    const r = snapRack({ x: 2200, y: 2000 + 2300 + 2900, w: 20_000, h: 2300 }, [otro], 3000, 400)
    expect(r.x).toBe(2000)
    expect(r.y).toBe(2000 + 2300 + 3000)
    expect(r.guides.find((g) => g.kind === 'gap')?.value).toBe(3000)
    expect(r.guides.some((g) => g.kind === 'align')).toBe(true)
    // lejos de todo: queda donde se pidió
    expect(snapRack({ x: 30_000, y: 30_000, w: 1000, h: 1000 }, [otro], 3000, 400)).toMatchObject({ x: 30_000, y: 30_000, guides: [] })
  })

  it('mide la distancia a las paredes y al rack de al lado', async () => {
    const { clearances } = await import('./guides')
    const poly = [{ x: 0, y: 0 }, { x: 40_000, y: 0 }, { x: 40_000, y: 20_000 }, { x: 0, y: 20_000 }]
    const g = clearances({ x: 5000, y: 5000, w: 10_000, h: 1000 }, poly, [{ x: 5000, y: 9000, w: 10_000, h: 1000 }])
    const v = g.map((x) => Math.round(x.value!)).sort((a, b) => a - b)
    // izquierda 5 m (pared), arriba 5 m (pared), abajo 3 m (otro rack), derecha 25 m (pared)
    expect(v).toEqual([3000, 5000, 5000, 25_000])
  })
})

describe('girar, agrandar y achicar', () => {
  it('pasillo: girar sobre su centro, +/- sin moverse y estirar desde un lado', async () => {
    const { rotateRect, growRect, resizeRect, fitToDepot } = await import('./transform')
    const a = { id: 'p', x: 0, y: 10_000, w: 40_000, d: 3000 }
    expect(rotateRect(a)).toEqual({ id: 'p', x: 18_500, y: -8500, w: 3000, d: 40_000 })
    expect(growRect(a, 'd', 1000)).toMatchObject({ y: 9500, d: 4000 })
    expect(growRect(a, 'd', -10_000)).toMatchObject({ d: 500 })
    expect(resizeRect(a, ['l'], { x: 5000, y: 0 })).toMatchObject({ x: 5000, w: 35_000 })
    expect(fitToDepot(rectanglePlan(30_000, 20_000), a)).toMatchObject({ x: 0, w: 30_000 })
  })

  it('girar el depósito entero: el rectángulo de 40 × 20 pasa a 20 × 40 y lo de adentro gira con él', async () => {
    const { rotatePlan } = await import('./transform')
    const plan = { ...rectanglePlan(40_000, 20_000), zones: [{ id: 'z', x: 0, y: 0, w: 10_000, d: 5000, name: 'Oficina' }], racks: [rack({ x: 2000, y: 2000 })] }
    const r = rotatePlan(plan)
    const xs = r.outline.points.map((p) => p.x), ys = r.outline.points.map((p) => p.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBe(20_000)
    expect(Math.max(...ys) - Math.min(...ys)).toBe(40_000)
    expect(r.zones[0]).toMatchObject({ w: 5000, d: 10_000 })
    expect(r.racks![0].orientation).toBe('y')
    // cuatro giros: vuelve a como estaba
    expect(rotatePlan(rotatePlan(rotatePlan(r))).outline.points).toEqual(plan.outline.points)
  })
})

describe('piezas propias de un rack', () => {
  it('el largo de viga y el fondo propios cambian lo que ocupa el rack', async () => {
    const { fitPlacement } = await import('./racks')
    const size = { width: 2700, depth: 1100, upright: 100, backToBackGap: 200 }
    const base = fitPlacement(rack(), size)
    expect(base.length).toBe(3 * 2700 + 4 * 100)
    const own = fitPlacement(rack({ beamLength: 2000, frameDepth: 900, pair: true }), size)
    expect(own.length).toBe(3 * 2000 + 4 * 100)
    expect(own.depth).toBe(2 * 900 + 200)
  })
  it('la estructura usa las piezas del rack (largo, perfil y altura de cada viga)', async () => {
    const { placementStructure } = await import('./depot')
    const { DEFAULT_CONFIGURATION } = await import('../rack/technicalSpecs')
    const s = placementStructure(DEFAULT_CONFIGURATION, rack({ beamLength: 1800, beamId: 'V160', uprightId: 'P120' }))
    expect(s.config.width).toBe(1800)
    expect(s.upright.id).toBe('P120')
    expect(s.rows[0].modules[0].beam.id).toBe('V160')
  })
})

describe('una pieza sola de un rack', () => {
  it('cambiar una viga de un módulo no cambia los otros módulos', async () => {
    const { placementStructure } = await import('./depot')
    const { DEFAULT_CONFIGURATION } = await import('../rack/technicalSpecs')
    const plain = placementStructure(DEFAULT_CONFIGURATION, rack({ modules: 4 }))
    const elev = plain.rows[0].modules[0].levels.filter((l) => l.hasBeam).map((l) => l.elevation)
    const changed = [...elev]; changed[0] = elev[0] + 300
    const s = placementStructure(DEFAULT_CONFIGURATION, rack({ modules: 4, mods: { 2: { beamElevations: changed, width: 1800 } } }))
    const beamsOf = (m: number) => s.rows[0].modules.find((x) => x.key === m)!.levels.filter((l) => l.hasBeam).map((l) => l.elevation)
    expect(beamsOf(2)[0]).toBe(changed[0])
    expect(beamsOf(1)).toEqual(elev)
    expect(beamsOf(3)).toEqual(elev)
    expect(s.rows[0].modules.find((x) => x.key === 2)!.width).toBe(1800)
    expect(s.rows[0].modules.find((x) => x.key === 1)!.width).toBe(DEFAULT_CONFIGURATION.width)
  })
  it('un parante solo cambia de alto, pero nunca queda más bajo que sus vigas', async () => {
    const { placementStructure } = await import('./depot')
    const { DEFAULT_CONFIGURATION } = await import('../rack/technicalSpecs')
    const tall = placementStructure(DEFAULT_CONFIGURATION, rack({ modules: 3, frameHeights: { 1: 8000 } }))
    expect(tall.rows[0].frames.find((f) => f.key === 1)!.height).toBe(8000)
    expect(tall.rows[0].frames.find((f) => f.key === 2)!.height).toBe(DEFAULT_CONFIGURATION.height)
    const low = placementStructure(DEFAULT_CONFIGURATION, rack({ modules: 3, frameHeights: { 1: 500 } }))
    const top = low.rows[0].modules[0].levels.filter((l) => l.hasBeam).pop()!
    expect(low.rows[0].frames.find((f) => f.key === 1)!.height).toBeGreaterThan(top.elevation)
  })
  it('en un rack doble, la fila de atrás queda enfrentada con la de adelante', async () => {
    const { placementStructure } = await import('./depot')
    const { DEFAULT_CONFIGURATION } = await import('../rack/technicalSpecs')
    const s = placementStructure(DEFAULT_CONFIGURATION, rack({ modules: 3, pair: true, mods: { 0: { width: 1800 } } }))
    const [front, back] = s.rows
    const total = s.totalWidth
    const f0 = front.modules.find((x) => x.key === 0)!, b0 = back.modules.find((x) => x.key === 0)!
    expect(b0.width).toBe(1800)
    // la de atrás está girada 180°: su posición se mide desde el otro extremo
    expect(total - b0.xEnd).toBeCloseTo(f0.xStart)
  })
})
