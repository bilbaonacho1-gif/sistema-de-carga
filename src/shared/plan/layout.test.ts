import { describe, expect, it } from 'vitest'
import { rectanglePlan } from './geometry'
import { autoLayout, DEFAULT_LAYOUT, placementRect, type RackModuleSize } from './layout'

const rack: RackModuleSize = { width: 2700, depth: 1100, upright: 80, backToBackGap: 200 }

describe('distribución automática', () => {
  it('el depósito del plano de AutoCAD: fila simple, 9 dobles y fila simple', () => {
    // 42.100 × 41.788 mm, filas a lo largo de los 41.788 mm, pasillos de 1.800 mm
    const plan = rectanglePlan(42_100, 41_788)
    const r = autoLayout(plan, rack, { ...DEFAULT_LAYOUT, orientation: 'y', aisle: 1800, wallGap: 0, endGap: 1000 })
    expect(r.placements.map((p) => (p.pair ? 2 : 1))).toEqual([1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1])
    expect(r.rows).toBe(20)
    expect(r.placements.every((p) => p.modules === 14)).toBe(true)
    expect(r.modules).toBe(20 * 14)
    // todos los racks quedan adentro del depósito
    for (const p of r.placements) {
      const b = placementRect(p)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(42_100)
      expect(b.y + b.h).toBeLessThanOrEqual(41_788)
    }
  })

  it('una columna en el camino parte la fila en dos', () => {
    const plan = rectanglePlan(30_000, 10_000)
    const libre = autoLayout(plan, rack, DEFAULT_LAYOUT)
    plan.columns = [{ id: 'c1', x: 15_000, y: 900, shape: 'rect', w: 400, d: 400 }]
    const conColumna = autoLayout(plan, rack, DEFAULT_LAYOUT)
    const primeraFila = (r: typeof libre) => r.placements.filter((p) => p.y === libre.placements[0].y)
    expect(primeraFila(libre)).toHaveLength(1)
    expect(primeraFila(conColumna)).toHaveLength(2)
    expect(conColumna.modules).toBeLessThan(libre.modules)
  })

  it('no pone racks en una zona libre', () => {
    const plan = rectanglePlan(30_000, 20_000)
    plan.zones = [{ id: 'z', x: 0, y: 0, w: 30_000, d: 6000, name: 'Oficinas' }]
    const r = autoLayout(plan, rack, DEFAULT_LAYOUT)
    expect(r.placements.length).toBeGreaterThan(0)
    expect(r.placements.every((p) => placementRect(p).y >= 6000)).toBe(true)
  })

  it('las filas pueden ir a lo largo o a lo ancho', () => {
    const plan = rectanglePlan(40_000, 20_000)
    const largo = autoLayout(plan, rack, { ...DEFAULT_LAYOUT, orientation: 'x' })
    const ancho = autoLayout(plan, rack, { ...DEFAULT_LAYOUT, orientation: 'y' })
    expect(largo.placements[0].length).toBeGreaterThan(ancho.placements[0].length)
    expect(ancho.placements.every((p) => placementRect(p).h === p.length)).toBe(true)
  })

  it('en un depósito con forma de L no hay racks afuera', () => {
    const plan = rectanglePlan(20_000, 20_000)
    plan.outline = { points: [{ x: 0, y: 0 }, { x: 20_000, y: 0 }, { x: 20_000, y: 10_000 }, { x: 10_000, y: 10_000 }, { x: 10_000, y: 20_000 }, { x: 0, y: 20_000 }], sags: [0, 0, 0, 0, 0, 0] }
    const r = autoLayout(plan, rack, DEFAULT_LAYOUT)
    for (const p of r.placements) {
      const b = placementRect(p)
      // nada en el hueco de la L (x > 10 m e y > 10 m)
      expect(b.x + b.w > 10_000 && b.y + b.h > 10_000).toBe(false)
    }
  })
})

describe('depósito completo', () => {
  it('suma posiciones y materiales de todos los racks', async () => {
    const { buildDepot } = await import('./depot')
    const { DEFAULT_CONFIGURATION } = await import('../rack/technicalSpecs')
    const plan = rectanglePlan(42_100, 41_788)
    const opt = { ...DEFAULT_LAYOUT, orientation: 'y' as const, aisle: 1800, wallGap: 0, endGap: 1000 }
    const d = buildDepot(plan, { ...DEFAULT_CONFIGURATION, levels: 4 }, opt)
    // 20 filas × 14 módulos × 2 pallets × 4 niveles
    expect(d.positions).toBe(20 * 14 * 2 * 4)
    const bastidores = d.materials.filter((l) => l.code.startsWith('BAST-')).reduce((n, l) => n + l.qty, 0)
    expect(bastidores).toBe(20 * 15)   // 15 bastidores por fila de 14 módulos
    const vigas = d.materials.filter((l) => l.code.startsWith('VIGA-')).reduce((n, l) => n + l.qty, 0)
    expect(vigas).toBe(20 * 14 * 3 * 2) // 3 planos de vigas (el piso no lleva), 2 vigas por plano
    expect(d.materials.find((l) => l.code === 'DIST-ESP')?.qty).toBeGreaterThan(0)   // los pares llevan distanciadores
  })
})
