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

describe('depósitos grandes', () => {
  it('distribuye, arma y revisa un depósito de 300 × 300 m rápido', () => {
    const big = rectanglePlan(300_000, 300_000)
    const t0 = performance.now()
    const auto = autoLayout(big, size, DEFAULT_LAYOUT).placements
    const depot = buildDepot(big, DEFAULT_CONFIGURATION, DEFAULT_LAYOUT)
    expect(auto.length).toBeGreaterThan(40)          // filas largas de muchos módulos
    expect(depot.positions).toBeGreaterThan(10_000)
    // a mano: miles de racks cortos, todos revisados contra todos (con la grilla, no par contra par)
    const many: RackPlacement[] = []
    for (let i = 0; i < 40; i++) for (let j = 0; j < 60; j++)
      many.push(fitPlacement({ id: `r${i}-${j}`, x: 2000 + i * 7000, y: 2000 + j * 4800, orientation: 'x', modules: 2, length: 0, depth: 0, pair: false }, size))
    const t1 = performance.now()
    expect(Object.keys(rackIssues(big, many))).toHaveLength(0)
    expect(performance.now() - t1).toBeLessThan(1000)
    expect(performance.now() - t0).toBeLessThan(5000)
  })
})

describe('zonas libres y zonas de racks mandan', () => {
  it('un rack no se deja arrastrar a una zona libre: se queda en el borde', async () => {
    const { moveRackWithin } = await import('./racks')
    const plan = { ...rectanglePlan(40_000, 20_000), zones: [{ id: 'z', x: 20_000, y: 0, w: 10_000, d: 20_000, name: 'Oficinas' }], racks: [rack({ x: 2000, y: 5000 })] }
    // hacia la derecha, adentro de la zona libre: no se mueve
    const r1 = moveRackWithin(plan, 'a', 21_000, 5000, size).racks![0]
    expect(r1.x).toBe(2000)
    // en diagonal: se desliza en Y, sin entrar a la zona
    const r2 = moveRackWithin(plan, 'a', 21_000, 9000, size).racks![0]
    expect(r2).toMatchObject({ x: 2000, y: 9000 })
    // a un lugar libre, sí
    expect(moveRackWithin(plan, 'a', 5000, 8000, size).racks![0]).toMatchObject({ x: 5000, y: 8000 })
  })

  it('con zona de racks, los racks no salen de ahí y los nuevos van adentro', async () => {
    const { moveRackWithin, blockedReason, guarded } = await import('./racks')
    const area = { id: 'a1', x: 10_000, y: 5000, w: 20_000, d: 10_000, name: 'Zona A' }
    const plan = { ...rectanglePlan(40_000, 20_000), rackAreas: [area], racks: [rack({ x: 12_000, y: 6000 })] }
    expect(blockedReason(plan, plan.racks[0])).toBeNull()
    expect(moveRackWithin(plan, 'a', 2000, 6000, size).racks![0].x).toBe(12_000)
    expect(blockedReason(plan, rack({ x: 2000, y: 6000 }))).toBe('Fuera de la zona de racks')
    // agregar: cae adentro de la zona
    const added = addRack(plan, size)
    const nuevo = added.plan.racks!.find((r) => r.id === added.id)!
    const b = placementRect(fitPlacement(nuevo, size))
    expect(b.x >= area.x && b.y >= area.y && b.x + b.w <= area.x + area.w && b.y + b.h <= area.y + area.d).toBe(true)
    // un módulo más que lo sacaría de la zona no se acepta
    const largo = { ...plan, racks: [rack({ x: 12_000, y: 6000, modules: 6 })] }
    expect(guarded(largo, setRackModules(largo, 'a', 7), 'a', size)).toBe(largo)
  })

  it('marcar una zona libre vuelve a acomodar los racks movidos a mano', async () => {
    const { usePlan } = await import('../../web/plan/planStore')
    const s = usePlan.getState()
    s.commit(() => ({ ...rectanglePlan(40_000, 20_000), racks: [rack()] }))
    expect(usePlan.getState().plan.racks).toBeDefined()
    usePlan.getState().commit((p) => ({ ...p, zones: [...p.zones, { id: 'z', x: 0, y: 0, w: 5000, d: 5000, name: 'Libre' }] }))
    expect(usePlan.getState().plan.racks).toBeUndefined()
    usePlan.getState().undo()
    expect(usePlan.getState().plan.racks).toHaveLength(1)
  })
})

describe('varios racks y medidas propias', () => {
  it('elegir con un recuadro, mover juntos y frenar si uno no entra', async () => {
    const { racksInBox, moveRacksBy } = await import('./racks')
    const plan = { ...rectanglePlan(40_000, 20_000), zones: [{ id: 'z', x: 0, y: 15_000, w: 40_000, d: 5000, name: 'Libre' }],
      racks: [rack({ id: 'a', x: 2000, y: 2000 }), rack({ id: 'b', x: 2000, y: 6000 }), rack({ id: 'c', x: 20_000, y: 2000 })] }
    expect(racksInBox(plan.racks, 0, 0, 12_000, 10_000).sort()).toEqual(['a', 'b'])
    const moved = moveRacksBy(plan, ['a', 'b'], 1000, 1000, size)
    expect(moved.racks!.filter((r) => r.id !== 'c').map((r) => [r.x, r.y])).toEqual([[3000, 3000], [3000, 7000]])
    // 'b' entraría en la zona libre: se mueven sólo en X
    const frenado = moveRacksBy(plan, ['a', 'b'], 1000, 9000, size)
    expect(frenado.racks!.find((r) => r.id === 'b')).toMatchObject({ x: 3000, y: 6000 })
  })

  it('un rack con altura y niveles propios suma sus posiciones', () => {
    const plan = { ...rectanglePlan(40_000, 20_000), racks: [rack({ id: 'a' }), rack({ id: 'b', y: 6000 })] }
    const config = { ...DEFAULT_CONFIGURATION, levels: 3 }
    const antes = buildDepot(plan, config, DEFAULT_LAYOUT).positions
    const alto = { ...plan, racks: [plan.racks[0], { ...plan.racks[1], levels: 5, height: 8000 }] }
    const despues = buildDepot(alto, config, DEFAULT_LAYOUT)
    expect(despues.positions).toBeGreaterThan(antes)
    expect(despues.racks[1].structure.config.height).toBe(8000)
  })
})
