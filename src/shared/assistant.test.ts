import { describe, expect, it } from 'vitest'
import { describeOrder, findFaq, intentOf, parseOrder, suggestions } from './assistant'
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
    expect(parseOrder('filas simples sin protectores')).toMatchObject({ pair: false, protectors: 'none' })
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
