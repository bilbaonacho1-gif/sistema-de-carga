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
