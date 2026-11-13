import { describe, expect, it } from 'vitest'
import { applyShapes, describeOrder, findFaq, intentOf, parseOrder, suggestions, withBeams } from './assistant'
import { buildDepot } from './plan/depot'
import { rectanglePlan } from './plan/geometry'
import { DEFAULT_LAYOUT } from './plan/layout'
import { DEFAULT_CONFIGURATION } from './rack/technicalSpecs'

describe('ayudante: entender un pedido escrito', () => {
  it('lee el depósito, el alto, los niveles y que lo llene', () => {
    const o = parseOrder('Armame un depósito de 30 por 20 con racks de 6 metros, 4 niveles y llenalo')
    expect(o).toMatchObject({ depot: { l: 30_000, w: 20_000 }, height: 6000, levels: 4, fill: true })
    expect(describeOrder(o)).toEqual(['Depósito de 30 m × 20 m', 'Racks de 6 m de alto', '4 niveles', 'Racks acomodados solos'])
  })
  it('acepta comas, "x", milímetros y kilos', () => {
    expect(parseOrder('galpón 42,5x18')).toMatchObject({ depot: { l: 42_500, w: 18_000 } })
    expect(parseOrder('vigas de 2,7 y profundidad 1100')).toMatchObject({ width: 2700, depth: 1100 })
    expect(parseOrder('pallets de 1200 kg, pasillo de 3,5')).toMatchObject({ palletWeight: 1200, aisle: 3500 })
    expect(parseOrder('altura 7.5 con techo de 9')).toMatchObject({ height: 7500, wallHeight: 9000 })
    expect(parseOrder('filas simples sin protectores')).toMatchObject({ pair: false, accessories: { protectors: 'none' } })
  })
  it('no confunde un pallet de 1 x 1,2 con un depósito y no inventa nada', () => {
    expect(parseOrder('pallet de 1 x 1,2').depot).toBeUndefined()
    expect(parseOrder('hola, cómo va')).toEqual({})
  })
  it('deja las medidas dentro de lo que el sistema permite', () => {
    expect(parseOrder('racks de 40 metros de alto').height).toBe(12_000)
    expect(parseOrder('20 niveles').levels).toBe(8)
  })
})

describe('ayudante: un texto largo pegado (prompt)', () => {
  const PROMPT = `Depósito de 40 por 25, techo de 9.
Columnas cada 10 por 8.
Portón de 4 en la pared de abajo a 20
Portón en la pared de la izquierda
Oficina de 8 por 5 en 0, 0 (Oficinas)
Zona de racks de 28 por 14 en 10, 2 con filas verticales
Pasillo de 3 por 25 en 36, 0
Racks de 7 metros, 4 niveles, vigas de 2,7, profundidad 1100 mm, pallets de 1.000 kg, sin pallets en el piso
Pasillos de 3, cabecera de 2,5, filas dobles
Protectores en los extremos, malla de fondo, defensas, carteles de capacidad, piso de malla, vigas azules, parantes grises
Llenalo`
  it('lee cada renglón sin mezclar las medidas de las zonas con las del depósito o el rack', () => {
    const o = parseOrder(PROMPT)
    expect(o).toMatchObject({
      depot: { l: 40_000, w: 25_000 }, wallHeight: 9000, height: 7000, levels: 4, width: 2700, depth: 1100, palletWeight: 1000,
      floorStorage: false, aisle: 3000, endGap: 2500, pair: true, fill: true,
      accessories: { protectors: 'ends', backMesh: true, guardrails: true, capacitySigns: true, decking: 'mesh', beamColor: 'azul', uprightColor: 'gris' },
    })
    // las filas verticales son de la zona, no de todo el depósito
    expect(o.orientation).toBeUndefined()
    expect(o.shapes).toEqual([
      { kind: 'grid', dx: 10_000, dy: 8000, size: 400 },
      { kind: 'door', width: 4000, wall: 'bottom', at: 20_000 },
      { kind: 'door', width: 4000, wall: 'left' },
      { kind: 'zone', w: 8000, d: 5000, at: { x: 0, y: 0 }, name: 'Oficinas' },
      { kind: 'area', w: 28_000, d: 14_000, at: { x: 10_000, y: 2000 }, orientation: 'y' },
      { kind: 'aisle', w: 3000, d: 25_000, at: { x: 36_000, y: 0 } },
    ])
    expect(intentOf(PROMPT)).toBe('pedido')
    expect(describeOrder(o).length).toBeGreaterThan(15)
  })
  it('dibuja todo en el plano, en su lugar', () => {
    const o = parseOrder(PROMPT)
    const { plan, notes } = applyShapes(rectanglePlan(40_000, 25_000), o.shapes!)
    expect(notes).toEqual([])
    expect(plan.columns).toHaveLength(3 * 3)                       // x = 10, 20, 30 · y = 8, 16, 24
    expect(plan.zones[0]).toMatchObject({ x: 0, y: 0, w: 8000, d: 5000, name: 'Oficinas' })
    expect(plan.rackAreas![0]).toMatchObject({ x: 10_000, y: 2000, w: 28_000, d: 14_000, orientation: 'y' })
    expect(plan.aisles![0]).toMatchObject({ x: 36_000, y: 0, w: 3000, d: 25_000 })
    // pared de abajo: va de (40, 25) a (0, 25); a 20 m de la izquierda es la mitad
    expect(plan.doors[0]).toMatchObject({ edge: 2, t: 0.5, width: 4000 })
    expect(plan.doors[1]).toMatchObject({ edge: 3, t: 0.5 })
    // lo que se sale del depósito se corre para adentro
    const out = applyShapes(rectanglePlan(10_000, 10_000), [{ kind: 'zone', w: 4000, d: 4000, at: { corner: 'br' }, name: 'x' }, { kind: 'zone', w: 4000, d: 4000, at: { x: 9000, y: 9000 }, name: 'y' }]).plan
    expect(out.zones.map((z) => [z.x, z.y])).toEqual([[6000, 6000], [6000, 6000]])
  })
})

describe('ayudante: cambiar las medidas de un rack', () => {
  it('lee módulos, la altura de una viga, riendas y columnas, en metros, cm o mm', () => {
    expect(parseOrder('6 módulos, altura 7,5 y vigas de 2300 mm')).toMatchObject({ modules: 6, height: 7500, width: 2300 })
    // "viga 2 a 3 m" es la altura de la viga 2, no un largo de viga de 2 m
    const o = parseOrder('viga 2 a 3 m y viga 1 a 120 cm')
    expect(o.beamAt).toEqual([{ n: 2, h: 3000 }, { n: 1, h: 1200 }])
    expect(o.width).toBeUndefined()
    const f = parseOrder('12 riendas diagonales, 3 riendas horizontales, columna de atrás de 7,5')
    expect(f.frame).toEqual({ diagonals: 12, horizontals: 3, backHeight: 7500 })
    // las riendas horizontales no giran las filas
    expect(f.orientation).toBeUndefined()
    expect(parseOrder('profundidad 90 cm').depth).toBe(900)
  })
  it('mueve una viga sin pisar a las vecinas ni pasar el tope', () => {
    expect(withBeams([1500, 3000, 4500], [{ n: 2, h: 3500 }], 6000)).toEqual([1500, 3500, 4500])
    expect(withBeams([1500, 3000, 4500], [{ n: 1, h: 4000 }], 6000)).toEqual([4000, 4200, 4500])
    expect(withBeams([1500, 3000, 4500], [{ n: 3, h: 9000 }], 6000)).toEqual([1500, 3000, 5850])
    expect(withBeams([1500, 3000], [{ n: 5, h: 1000 }], 6000)).toEqual([1500, 3000])
  })
})

describe('ayudante: preguntas y qué se pide', () => {
  it('encuentra la respuesta por las palabras, con o sin acentos', () => {
    expect(findFaq('como copio un rack?')?.id).toBe('copiar')
    expect(findFaq('¿Por qué están rojos?')?.id).toBe('rojo')
    expect(findFaq('quiero sacar una viga para que pase el autoelevador')?.id).toBe('viga')
    expect(findFaq('donde veo la lista de materiales')?.id).toBe('materiales')
    expect(findFaq('xyzzy')).toBeNull()
  })
  it('distingue revisar, sugerir, preguntar y pedir', () => {
    expect(intentOf('revisá mi depósito')).toBe('revisar')
    expect(intentOf('qué me sugerís')).toBe('sugerir')
    expect(intentOf('¿cómo hago un depósito de 30 por 20?')).toBe('pregunta')
    expect(intentOf('depósito de 30 por 20')).toBe('pedido')
    expect(intentOf('asdf')).toBe('nada')
  })
})

describe('ayudante: sugerencias', () => {
  it('sin racks ofrece llenarlo; con racks bajos y techo alto, subirlos', () => {
    const plan = { ...rectanglePlan(40_000, 25_000), wallHeight: 10_000, racks: [] }
    const empty = suggestions(plan, DEFAULT_CONFIGURATION, DEFAULT_LAYOUT, buildDepot(plan, DEFAULT_CONFIGURATION, DEFAULT_LAYOUT))
    expect(empty[0].action).toEqual({ kind: 'fill' })
    const auto = { ...plan, racks: undefined }
    const full = suggestions(auto, DEFAULT_CONFIGURATION, DEFAULT_LAYOUT, buildDepot(auto, DEFAULT_CONFIGURATION, DEFAULT_LAYOUT))
    const up = full.find((s) => s.action?.kind === 'config')
    expect(up?.action).toEqual({ kind: 'config', patch: { height: 9700, levels: DEFAULT_CONFIGURATION.levels + 1 } })
    // lo que propone girar o apretar pasillos, de verdad suma posiciones
    for (const s of full) if (s.action?.kind === 'layout') {
      expect(buildDepot(auto, DEFAULT_CONFIGURATION, { ...DEFAULT_LAYOUT, ...s.action.patch }).positions).toBeGreaterThan(buildDepot(auto, DEFAULT_CONFIGURATION, DEFAULT_LAYOUT).positions)
    }
  })
})
