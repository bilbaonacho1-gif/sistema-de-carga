import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIGURATION } from './technicalSpecs'
import { calculateRackStructure } from './calculateRackStructure'
import { defaultRules } from './rules'
import type { RackConfiguration } from './types'

const cfg = (over: Partial<RackConfiguration> = {}): RackConfiguration => ({ ...DEFAULT_CONFIGURATION, ...over })

describe('regla de crecimiento: BASTIDOR | MÓDULO | BASTIDOR …', () => {
  // 2700 mm con pallet Arlog → 2 pallets por módulo; 3 niveles → 6 posiciones por módulo
  it.each([
    [6, 1, 2, 4],
    [12, 2, 3, 8],
    [18, 3, 4, 12],
    [24, 4, 5, 16],
  ])('%i posiciones → %i módulos, %i bastidores, %i vigas', (positions, modules, frames, beams) => {
    const s = calculateRackStructure(cfg({ positions }))
    expect(s.modulesPerRow).toBe(modules)
    expect(s.counts.frames).toBe(frames)
    expect(s.counts.beams).toBe(beams)
    expect(s.pallets).toHaveLength(positions)
  })

  it('los módulos vecinos comparten el bastidor del medio', () => {
    const s = calculateRackStructure(cfg({ positions: 18 }))
    const [a, b] = s.rows[0].modules
    expect(a.rightFrame).toBe(b.leftFrame)
  })

  it('completa módulos enteros y avisa las posiciones libres', () => {
    const s = calculateRackStructure(cfg({ positions: 7 }))
    expect(s.modulesPerRow).toBe(2)
    expect(s.positionsAvailable).toBe(12)
    expect(s.pallets).toHaveLength(7)
    expect(s.warnings.some((w) => w.code === 'free-positions')).toBe(true)
  })

  it('las posiciones nuevas aparecen en el módulo de la derecha', () => {
    const s = calculateRackStructure(cfg({ positions: 8 }))
    const extra = s.pallets.filter((p) => p.module === 1)
    expect(extra).toHaveLength(2)
  })

  it('reparte las posiciones entre filas', () => {
    const s = calculateRackStructure(cfg({ positions: 24, layout: { ...DEFAULT_CONFIGURATION.layout, rows: 2 } }))
    expect(s.modulesPerRow).toBe(2)
    expect(s.counts.frames).toBe(6)
  })

  it('las reglas se pueden reemplazar sin tocar el motor', () => {
    const rules = { ...defaultRules, framesPerRow: (m: number) => m * 2 }   // módulos independientes
    const s = calculateRackStructure(cfg({ positions: 18 }), rules)
    expect(s.counts.frames).toBe(6)
  })
})

describe('niveles y cargas', () => {
  it('agrega un plano de vigas por nivel (el piso no lleva viga)', () => {
    const s = calculateRackStructure(cfg({ levels: 4 }))
    expect(s.beamLevels).toBe(3)
    expect(s.levels.map((l) => l.hasBeam)).toEqual([false, true, true, true])
    expect(s.levels[3].elevation).toBeLessThanOrEqual(6000 - 150)
  })

  it('pide validación técnica si se supera la referencia publicada', () => {
    const s = calculateRackStructure(cfg({ palletWeight: 2000 }))
    expect(s.warnings.some((w) => w.code === 'pallet-weight' && w.level === 'validation')).toBe(true)
    expect(s.warnings.some((w) => w.code === 'level-load')).toBe(true)
  })

  it('elige una viga más pesada cuando la luz es mayor', () => {
    const corto = calculateRackStructure(cfg({ width: 1800, palletTypeId: 'euro', palletWeight: 1000 }))
    const largo = calculateRackStructure(cfg({ width: 3300, palletTypeId: 'euro', palletWeight: 1000 }))
    expect(largo.beam.height).toBeGreaterThanOrEqual(corto.beam.height)
  })
})

describe('tramos con medidas distintas', () => {
  const tramos = cfg({
    sections: [
      { modules: 2, width: 2700, height: 6000, levels: 3 },
      { modules: 1, width: 1800, height: 8000, levels: 5 },
    ],
  })

  it('arma cada tramo con su largo de viga, altura y niveles', () => {
    const s = calculateRackStructure(tramos)
    expect(s.modulesPerRow).toBe(3)
    expect(s.counts.frames).toBe(4)
    expect(s.modules.map((m) => m.width)).toEqual([2700, 2700, 1800])
    expect(s.modules.map((m) => m.levels.length)).toEqual([3, 3, 5])
    // el bastidor compartido entre tramos toma la altura mayor
    expect(s.frames.map((f) => f.height)).toEqual([6000, 6000, 8000, 8000])
    expect(s.config.height).toBe(8000)
  })

  it('cuenta vigas y posiciones por tramo', () => {
    const s = calculateRackStructure(tramos)
    // 2 módulos × 2 planos × 2 vigas + 1 módulo × 4 planos × 2 vigas
    expect(s.counts.beams).toBe(2 * 2 * 2 + 4 * 2)
    // 2700 mm → 2 pallets Arlog, 1800 mm → 1
    expect(s.positionsAvailable).toBe(2 * 2 * 3 + 1 * 5)
    expect(s.pallets).toHaveLength(s.positionsAvailable)
  })

  it('separa en la lista de materiales los bastidores y vigas de cada medida', () => {
    const s = calculateRackStructure(tramos)
    const codes = s.materials.map((l) => l.code)
    expect(codes).toContain('BAST-P80-1100-6000')
    expect(codes).toContain('BAST-P80-1100-8000')
    expect(s.materials.find((l) => l.code.startsWith('VIGA-') && l.code.endsWith('-1800'))?.qty).toBe(8)
  })
})

describe('pallet, perfiles y accesorios', () => {
  it('acepta un pallet a medida', () => {
    const s = calculateRackStructure(cfg({ palletTypeId: 'custom', customPallet: { front: 1200, deep: 1000, height: 150 } }))
    expect(s.pallet).toMatchObject({ front: 1200, deep: 1000, height: 150 })
    expect(s.palletsPerModule).toBe(2)
  })

  it('respeta el parante y la viga elegidos a mano y avisa si no alcanzan', () => {
    const s = calculateRackStructure(cfg({ beamId: 'V100', uprightId: 'P120' }))
    expect(s.beam.id).toBe('V100')
    expect(s.upright.id).toBe('P120')
    expect(s.warnings.some((w) => w.code === 'beam-0' && w.level === 'validation')).toBe(true)
  })

  it('cuenta los accesorios elegidos', () => {
    const s = calculateRackStructure(cfg({
      positions: 18, layout: { ...DEFAULT_CONFIGURATION.layout, rows: 2, backToBack: true },
      accessories: { protectors: 'ends', guardrails: true, topTies: true, crossBracing: true, capacitySigns: true, decking: 'wood', palletSupports: true },
    }))
    // 2 filas espalda con espalda de 2 módulos (9 posiciones por fila → 2 módulos de 6)
    expect(s.modulesPerRow).toBe(2)
    expect(s.counts.protectors).toBe(2 * 2)
    expect(s.counts.guardrails).toBe(2)              // un bloque, dos cabeceras
    expect(s.counts.topTies).toBe(3)                 // un par de filas × 3 bastidores
    expect(s.counts.crossBraces).toBe(2)             // una por fila
    expect(s.counts.capacitySigns).toBe(4)
    expect(s.counts.deckPanels).toBe(2 * 2 * 2 * 2)  // filas × módulos × planos × pallets
    expect(s.counts.palletSupports).toBe(s.counts.deckPanels * 2)
    expect(s.materials.some((l) => l.code === 'PISO-MAD')).toBe(true)
  })

  it('limpia una configuración inválida que llega de afuera', () => {
    const s = calculateRackStructure({ ...DEFAULT_CONFIGURATION, sections: [{ modules: -3, width: 99999, height: 'x' as never, levels: 50 }], accessories: { decking: 'oro' as never } })
    expect(s.sections[0]).toMatchObject({ modules: 1, width: 3600, levels: 8 })
    expect(s.accessories.decking).toBe('none')
  })
})
