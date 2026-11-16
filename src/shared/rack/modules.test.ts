import { describe, expect, it } from 'vitest'
import { buildDepot, moduleSize, placementStructure } from '../plan/depot'
import { rectanglePlan } from '../plan/geometry'
import { DEFAULT_LAYOUT } from '../plan/layout'
import { attachRack, fitPlacement, rackDims } from '../plan/racks'
import type { RackPlacement } from '../plan/types'
import { activeModuleId, addModule, configFor, moduleList, removeModule, renameModule, selectModule, withOwnLoads } from './modules'
import type { RackConfiguration } from './types'
import { DEFAULT_CONFIGURATION } from './technicalSpecs'

const rack = (over: Partial<RackPlacement> = {}): RackPlacement => ({ id: 'r1', x: 2000, y: 2000, orientation: 'x', modules: 3, length: 0, depth: 0, pair: false, ...over })

describe('módulos del proyecto (A, B, C…)', () => {
  it('un proyecto sin módulos creados tiene uno solo, el A, y todo sigue como antes', () => {
    const c = DEFAULT_CONFIGURATION
    expect(moduleList(c).map((m) => m.name)).toEqual(['A'])
    expect(configFor(c, undefined)).toBe(c)
    expect(configFor(c, 'no-existe')).toBe(c)
    expect(moduleSize(c).size.types).toBeUndefined()
  })

  it('crear un módulo copia el que se está editando y pasa a editar el nuevo', () => {
    const b = addModule(DEFAULT_CONFIGURATION)
    expect(moduleList(b).map((m) => m.name)).toEqual(['A', 'B'])
    expect(activeModuleId(b)).toBe('B')
    // se cambia el B: el A queda como estaba
    const edited = { ...b, height: 9000, width: 2300 }
    expect(configFor(edited, 'A').height).toBe(DEFAULT_CONFIGURATION.height)
    expect(configFor(edited, 'B').height).toBe(9000)
    // volver a editar el A guarda el B en la lista
    const back = selectModule(edited, 'A')
    expect([back.height, back.width]).toEqual([DEFAULT_CONFIGURATION.height, DEFAULT_CONFIGURATION.width])
    expect(configFor(back, 'B')).toMatchObject({ height: 9000, width: 2300 })
    expect(moduleList(back).find((m) => m.id === 'B')!.spec.height).toBe(9000)
  })

  it('cada rack sale con las medidas de su módulo, y cambiar el módulo los cambia a todos', () => {
    let c = addModule(DEFAULT_CONFIGURATION)                 // B, en edición
    c = { ...c, height: 9000, width: 2300, depth: 1000, levels: 5 }
    const size = moduleSize(c).size
    expect(Object.keys(size.types!)).toEqual(['A', 'B'])
    const a = rack({ id: 'a' }), b = rack({ id: 'b', type: 'B' })
    // un rack sin módulo usa el primero (A), aunque se esté editando el B
    expect(rackDims(a, size).width).toBe(DEFAULT_CONFIGURATION.width)
    expect(rackDims(b, size)).toMatchObject({ width: 2300, depth: 1000 })
    expect(fitPlacement(b, size).length).toBeLessThan(fitPlacement(a, size).length)
    expect(placementStructure(c, a).config.height).toBe(DEFAULT_CONFIGURATION.height)
    expect(placementStructure(c, b).config).toMatchObject({ height: 9000, width: 2300, levels: 5 })
    // se le cambia el alto al módulo B: su rack lo sigue
    const taller = { ...c, height: 10_000 }
    expect(placementStructure(taller, b).config.height).toBe(10_000)
    expect(placementStructure(taller, a).config.height).toBe(DEFAULT_CONFIGURATION.height)
    // lo propio de un rack sigue mandando sobre su módulo
    expect(placementStructure(taller, { ...b, height: 7000 }).config.height).toBe(7000)
  })

  it('los accesorios y los colores son de cada módulo', () => {
    const a0 = { ...DEFAULT_CONFIGURATION, accessories: { ...DEFAULT_CONFIGURATION.accessories, beamColor: 'rojo' as const, backMesh: false } }
    let c = addModule(a0)                                    // B, en edición: arranca con los del A
    expect(c.accessories).toEqual(a0.accessories)
    c = { ...c, accessories: { ...c.accessories, beamColor: 'azul' as const, uprightColor: 'naranja' as const, backMesh: true } }
    expect(placementStructure(c, rack({ type: 'B' })).accessories).toMatchObject({ beamColor: 'azul', uprightColor: 'naranja', backMesh: true })
    expect(placementStructure(c, rack({ type: 'A' })).accessories).toMatchObject({ beamColor: 'rojo', backMesh: false })
    // al volver a editar el A, se ven los suyos; y los del B quedaron guardados
    const back = selectModule(c, 'A')
    expect(back.accessories).toMatchObject({ beamColor: 'rojo', backMesh: false })
    expect(placementStructure(back, rack({ type: 'B' })).accessories.beamColor).toBe('azul')
    // un módulo guardado antes de este cambio (sin accesorios propios) no se rompe
    const old = { ...back, moduleTypes: back.moduleTypes!.map((m) => (m.id === 'B' ? { ...m, spec: { ...m.spec, accessories: undefined } } : m)) }
    expect(placementStructure(old, rack({ type: 'B' })).accessories.beamColor).toBe('rojo')
  })

  it('el depósito se llena con el módulo elegido, o cada zona con el suyo', () => {
    let c = addModule(DEFAULT_CONFIGURATION)
    c = { ...c, width: 1800, height: 8000 }                  // B: más corto y más alto
    const plan = { ...rectanglePlan(40_000, 20_000), wallHeight: 12_000 }
    const all = buildDepot({ ...plan, racks: undefined }, c, DEFAULT_LAYOUT)
    expect(all.layout.placements.every((p) => p.type === 'A')).toBe(true)
    const withB = buildDepot({ ...plan, racks: undefined }, c, { ...DEFAULT_LAYOUT, type: 'B' })
    expect(withB.layout.placements.every((p) => p.type === 'B')).toBe(true)
    expect(withB.racks.every((r) => r.structure.config.height === 8000)).toBe(true)
    // con vigas más cortas entran más módulos por fila
    expect(withB.layout.placements[0].modules).toBeGreaterThan(all.layout.placements[0].modules)
    const zones = buildDepot({ ...plan, racks: undefined, rackAreas: [
      { id: 'z1', x: 1000, y: 1000, w: 15_000, d: 18_000, name: 'Zona A' },
      { id: 'z2', x: 22_000, y: 1000, w: 15_000, d: 18_000, name: 'Zona B', type: 'B' },
    ] }, c, DEFAULT_LAYOUT)
    expect(new Set(zones.layout.placements.filter((p) => p.x < 20_000).map((p) => p.type))).toEqual(new Set(['A']))
    expect(new Set(zones.layout.placements.filter((p) => p.x > 20_000).map((p) => p.type))).toEqual(new Set(['B']))
  })

  it('dos racks pegados sólo se unen si son del mismo módulo', () => {
    const c = addModule(DEFAULT_CONFIGURATION)
    const size = moduleSize(c).size
    const first = fitPlacement(rack({ id: 'a', modules: 2 }), size)
    const next = (type?: string) => fitPlacement(rack({ id: 'b', modules: 2, x: first.x + first.length + 100, ...(type ? { type } : {}) }), size)
    expect(attachRack({ ...rectanglePlan(60_000, 20_000), racks: [first, next()] }, 'b', size)).not.toBeNull()
    expect(attachRack({ ...rectanglePlan(60_000, 20_000), racks: [first, next('A')] }, 'b', size)).not.toBeNull()
    expect(attachRack({ ...rectanglePlan(60_000, 20_000), racks: [first, next('B')] }, 'b', size)).toBeNull()
  })

  it('renombrar y borrar: siempre queda uno, y los racks del borrado pasan al primero', () => {
    let c = addModule(addModule(DEFAULT_CONFIGURATION))      // A, B, C (editando C)
    c = renameModule(c, 'B', 'Túnel')
    expect(moduleList(c).map((m) => m.name)).toEqual(['A', 'Túnel', 'C'])
    c = removeModule(c, 'C')
    expect(moduleList(c).map((m) => m.id)).toEqual(['A', 'B'])
    expect(activeModuleId(c)).toBe('A')
    // un rack que era del C ahora sale con el A
    expect(placementStructure(c, rack({ type: 'C' })).config.height).toBe(DEFAULT_CONFIGURATION.height)
    c = removeModule(removeModule(c, 'B'), 'A')
    expect(moduleList(c)).toHaveLength(1)
    // el que sigue después de borrar no repite letra
    expect(moduleList(addModule(addModule(removeModule(addModule(addModule(DEFAULT_CONFIGURATION)), 'B')))).map((m) => m.name)).toEqual(['A', 'C', 'D', 'E'])
  })
})

describe('el pallet y la carga son de cada módulo', () => {
  it('cada módulo guarda su peso, su pallet y sus pallets por módulo', () => {
    let c: RackConfiguration = { ...DEFAULT_CONFIGURATION, palletWeight: 1000, palletsPerModule: 2 }
    c = addModule(c) // B, copia de A
    c = { ...c, palletWeight: 500, palletsPerModule: 3, palletTypeId: 'custom', customPallet: { front: 800, deep: 1200, height: 144 }, load: { mode: 'boxes', boxW: 400, boxD: 300, boxH: 300, boxKg: 10, maxHeight: 1500 } }
    const a = configFor(c, 'A'), b = configFor(c, 'B')
    expect([a.palletWeight, a.palletsPerModule, a.palletTypeId]).toEqual([1000, 2, DEFAULT_CONFIGURATION.palletTypeId])
    expect(a.customPallet).toEqual(DEFAULT_CONFIGURATION.customPallet)
    expect(a.load).toBeUndefined()
    expect([b.palletWeight, b.palletsPerModule, b.palletTypeId]).toEqual([500, 3, 'custom'])
    // al volver al A, lo del B queda guardado y arriba queda lo del A
    const back = selectModule(c, 'A')
    expect(back.palletWeight).toBe(1000)
    expect(back.load).toBeUndefined()
    expect(configFor(back, 'B').load?.mode).toBe('boxes')
  })

  it('lo vacío de un módulo no se hereda del otro después de guardar y abrir', () => {
    let c: RackConfiguration = { ...DEFAULT_CONFIGURATION }
    c = addModule(c)
    c = { ...c, load: { mode: 'boxes', boxW: 400, boxD: 300, boxH: 300, boxKg: 10, maxHeight: 1500 }, beamElevations: [1500, 3000] }
    const opened = JSON.parse(JSON.stringify(c)) as RackConfiguration
    expect(configFor(opened, 'A').load).toBeUndefined()
    expect(configFor(opened, 'A').beamElevations).toBeUndefined()
    expect(selectModule(opened, 'A').load).toBeUndefined()
  })

  it('un módulo guardado sin carga se queda con la que había cuando se cambia la de otro', () => {
    let c: RackConfiguration = { ...DEFAULT_CONFIGURATION, palletWeight: 1200 }
    c = addModule(c)
    // como venía guardado antes: el A sin datos de carga
    c = { ...c, moduleTypes: c.moduleTypes!.map((m) => { const { palletTypeId: _t, customPallet: _c, palletWeight: _w, palletsPerModule: _p, load: _l, ...spec } = m.spec; return { ...m, spec } }) }
    expect(configFor(c, 'A').palletWeight).toBe(1200)
    const changed = { ...withOwnLoads(c), palletWeight: 700 }
    expect(configFor(changed, 'A').palletWeight).toBe(1200)
    expect(configFor(changed, 'B').palletWeight).toBe(700)
  })
})

describe('la capacidad del depósito con módulos de distinta carga', () => {
  it('cada rack suma con el peso de su módulo, y en el plano lleva sus pallets', () => {
    let c: RackConfiguration = { ...DEFAULT_CONFIGURATION, palletWeight: 1000, palletsPerModule: 2, floorStorage: true, levels: 3 }
    c = addModule(c)
    c = { ...c, palletWeight: 400, palletsPerModule: 3 }
    const plan = { ...rectanglePlan(30000, 20000), racks: [rack({ id: 'a', type: 'A', modules: 2 }), rack({ id: 'b', type: 'B', y: 8000, modules: 1 })] }
    const depot = buildDepot(plan, c, DEFAULT_LAYOUT)
    const [ra, rb] = depot.racks
    expect(ra.structure.config.palletWeight).toBe(1000)
    expect(rb.structure.config.palletWeight).toBe(400)
    expect(depot.capacity).toBe(ra.structure.positionsAvailable * 1000 + rb.structure.positionsAvailable * 400)
    const { size } = moduleSize(c)
    expect(size.types!.A.pallets).toBe(2)
    expect(size.types!.B.pallets).toBe(3)
  })
})
