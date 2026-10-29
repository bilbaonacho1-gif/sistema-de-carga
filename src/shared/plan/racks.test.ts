import { describe, expect, it } from 'vitest'
import { buildDepot } from './depot'
import { rectanglePlan } from './geometry'
import { DEFAULT_LAYOUT, autoLayout, placementRect, type RackModuleSize } from './layout'
import { addRack, duplicateRack, fitPlacement, freezeRacks, moveRack, rackIssues, rotateRack, setRackModules } from './racks'
import { DEFAULT_CONFIGURATION } from '../rack/technicalSpecs'
import type { RackPlacement } from './types'

const size: RackModuleSize = { width: 2700, depth: 1000, upright: 100, backToBackGap: 200 }
const rack = (o: Partial<RackPlacement> = {}): RackPlacement => fitPlacement({ id: 'a', x: 2000, y: 2000, orientation: 'x', modules: 3, length: 0, depth: 0, pair: false, ...o }, size)

describe('ubicación libre de racks', () => {
  const plan = rectanglePlan(30_000, 20_000)

  it('ajusta largo y profundidad al módulo', () => {
    expect(rack().length).toBe(3 * 2700 + 4 * 100)
    expect(rack({ pair: true }).depth).toBe(2 * 1000 + 200)
  })

  it('la primera edición copia la distribución automática y después no la vuelve a pisar', () => {
    const auto = autoLayout(plan, size, DEFAULT_LAYOUT).placements
    const p = freezeRacks(plan, auto)
    expect(p.racks).toHaveLength(auto.length)
    expect(freezeRacks(p, [])).toBe(p)
  })

  it('mueve, gira sobre su centro, duplica y cambia módulos', () => {
    const p = { ...plan, racks: [rack()] }
    expect(moveRack(p, 'a', 5000, 6000).racks![0]).toMatchObject({ x: 5000, y: 6000 })
    const r0 = placementRect(p.racks[0]), r1 = placementRect(rotateRack(p, 'a').racks![0])
    expect(r1.w).toBe(r0.h)
    expect(r1.x + r1.w / 2).toBeCloseTo(r0.x + r0.w / 2, -1)
    const d = duplicateRack(p, 'a', 3000)
    expect(d.plan.racks).toHaveLength(2)
    expect(d.plan.racks![1].y).toBe(2000 + 1000 + 3000)
    expect(setRackModules(p, 'a', 7).racks![0].modules).toBe(7)
  })

  it('avisa cuando un rack se pisa, choca o queda afuera', () => {
    const p = {
      ...plan,
      columns: [{ id: 'c', x: 20_500, y: 2500, shape: 'rect' as const, w: 400, d: 400 }],
      zones: [{ id: 'z', x: 10_000, y: 15_000, w: 3000, d: 3000, name: 'Oficina' }],
    }
    const racks = [
      rack({ id: 'ok', x: 2000, y: 10_000 }),
      rack({ id: 'col', x: 18_000, y: 2000 }),
      rack({ id: 'zona', x: 9000, y: 15_500 }),
      rack({ id: 'fuera', x: 25_000, y: 2000 }),
      rack({ id: 'p1', x: 2000, y: 5000 }),
      rack({ id: 'p2', x: 4000, y: 5500 }),
    ]
    const issues = rackIssues(p, racks)
    expect(issues.ok).toBeUndefined()
    expect(issues.col).toMatch(/columna/)
    expect(issues.zona).toMatch(/zona/)
    expect(issues.fuera).toMatch(/fuera/)
    expect(issues.p1).toMatch(/otro rack/)
    expect(issues.p2).toMatch(/otro rack/)
  })

  it('la distribución automática no tiene interferencias', () => {
    const p = { ...plan, columns: [{ id: 'c', x: 15_000, y: 10_000, shape: 'rect' as const, w: 400, d: 400 }] }
    expect(rackIssues(p, autoLayout(p, size, DEFAULT_LAYOUT).placements)).toEqual({})
  })

  it('el depósito usa los racks a mano y los cuenta', () => {
    const one = addRack(plan, size, 4)
    const depot = buildDepot(one.plan, DEFAULT_CONFIGURATION, DEFAULT_LAYOUT)
    expect(depot.manual).toBe(true)
    expect(depot.layout.placements).toHaveLength(1)
    expect(depot.layout.modules).toBe(4)
    expect(depot.issues).toEqual({})
  })
})
