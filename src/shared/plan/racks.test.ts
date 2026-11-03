import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIGURATION } from '../rack/technicalSpecs'
import type { RackConfiguration } from '../rack/types'
import { rectanglePlan } from './geometry'
import {
  addRack, footprint, localBox, packPlan, rackConflicts, rackTotals, repeatRack, rotateRack, structureFor, toLocal, toPlanPoint, unpackPlan,
} from './racks'
import type { Plan } from './types'

const cfg: RackConfiguration = { ...DEFAULT_CONFIGURATION, positions: 18, layout: { ...DEFAULT_CONFIGURATION.layout, rows: 1 } }
const big = (): Plan => rectanglePlan(300_000, 300_000)

describe('racks en el plano', () => {
  it('ubica el rack centrado donde se hace clic y lo gira sobre su centro', () => {
    const { plan, id } = addRack(big(), cfg, { x: 50_000, y: 50_000 })
    const f = footprint(plan.racks![0])
    expect(f.center.x).toBeCloseTo(50_000, -2)
    expect(f.center.y).toBeCloseTo(50_000, -2)
    const rotated = rotateRack(plan, id, 90)
    const g = footprint(rotated.racks![0])
    expect(g.center.x).toBeCloseTo(50_000, -2)
    expect(g.center.y).toBeCloseTo(50_000, -2)
    // girado 90°: el largo queda en vertical
    expect(g.maxY - g.minY).toBeCloseTo(f.maxX - f.minX, -1)
  })

  it('pasa de coordenadas locales al plano y vuelve', () => {
    const r = { x: 1000, y: 2000, rotation: 37 }
    const p = toPlanPoint(r, 1500, -800)
    const back = toLocal(r, p)
    expect(back.u).toBeCloseTo(1500)
    expect(back.v).toBeCloseTo(-800)
  })

  it('detecta racks superpuestos, fuera del depósito y sobre columnas o zonas', () => {
    let plan = big()
    plan = addRack(plan, cfg, { x: 20_000, y: 20_000 }).plan
    plan = addRack(plan, cfg, { x: 20_500, y: 20_000 }).plan            // pisa al primero
    plan = addRack(plan, cfg, { x: 299_000, y: 100_000 }).plan          // se sale por la derecha
    plan = addRack(plan, cfg, { x: 100_000, y: 100_000 }).plan          // queda bien
    plan = { ...plan, columns: [{ id: 'c1', x: 150_000, y: 150_000, shape: 'rect', w: 400, d: 400 }] }
    plan = addRack(plan, cfg, { x: 150_000, y: 150_000 }).plan          // sobre la columna
    plan = { ...plan, zones: [{ id: 'z1', x: 200_000, y: 200_000, w: 10_000, d: 10_000, name: 'Oficina' }] }
    plan = addRack(plan, cfg, { x: 205_000, y: 205_000 }).plan          // dentro de la zona
    const c = rackConflicts(plan)
    const [a, b, out, ok, col, zone] = plan.racks!.map((r) => c.get(r.id))
    expect(a?.has('rack')).toBe(true)
    expect(b?.has('rack')).toBe(true)
    expect(out?.has('afuera')).toBe(true)
    expect(ok).toBeUndefined()
    expect(col?.has('columna')).toBe(true)
    expect(zone?.has('zona')).toBe(true)
  })

  it('las copias en serie dejan el pasillo y no se pisan', () => {
    const first = addRack(big(), cfg, { x: 30_000, y: 30_000 })
    const { plan, ids } = repeatRack(first.plan, first.id, 4, 'across', 3000)
    expect(ids).toHaveLength(4)
    expect(rackConflicts(plan).size).toBe(0)
    const b = localBox(structureFor(cfg))
    const f0 = footprint(plan.racks![0]), f1 = footprint(plan.racks![1])
    expect(f1.minY - f0.maxY).toBeCloseTo(3000, -1)          // pasillo de 3 m, del lado del frente
    expect(f0.maxY - f0.minY).toBeCloseTo(b.v1 - b.v0, -1)
  })

  it('suma posiciones y materiales de todo el depósito', () => {
    const first = addRack(big(), cfg, { x: 30_000, y: 30_000 })
    const { plan } = repeatRack(first.plan, first.id, 9, 'along', 0)
    const t = rackTotals(plan)
    const one = structureFor(cfg)
    expect(t.racks).toBe(10)
    expect(t.positions).toBe(one.positionsAvailable * 10)
    const beams = one.materials.filter((l) => l.code.startsWith('VIGA')).reduce((n, l) => n + l.qty, 0)
    expect(t.materials.filter((l) => l.code.startsWith('VIGA')).reduce((n, l) => n + l.qty, 0)).toBe(beams * 10)
  })

  it('guarda las configuraciones repetidas una sola vez y las recupera', () => {
    const first = addRack(big(), cfg, { x: 30_000, y: 30_000 })
    const { plan } = repeatRack(first.plan, first.id, 99, 'along', 0)
    const packed = packPlan(plan)
    expect(packed.rackConfigs).toHaveLength(1)
    const back = unpackPlan(JSON.parse(JSON.stringify(packed)))
    expect(back.racks).toHaveLength(100)
    expect(back.racks![50].config).toEqual(cfg)
  })

  it('revisa un depósito con 3.000 racks rápido', () => {
    let plan = big()
    const first = addRack(plan, cfg, { x: 10_000, y: 10_000 })
    plan = first.plan
    // 30 filas de 100 racks
    const row = repeatRack(plan, first.id, 99, 'along', 0)
    plan = row.plan
    for (const id of [first.id, ...row.ids]) plan = repeatRack(plan, id, 29, 'across', 3000).plan
    expect(plan.racks).toHaveLength(3000)
    const t0 = performance.now()
    rackConflicts(plan)
    rackTotals(plan)
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})
