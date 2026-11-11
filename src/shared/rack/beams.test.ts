import { describe, expect, it } from 'vitest'
import { calculateRackStructure } from './calculateRackStructure'
import { DEFAULT_CONFIGURATION } from './technicalSpecs'

const base = { ...DEFAULT_CONFIGURATION, height: 6000, levels: 3, floorStorage: true, sections: [] }
const elevations = (c: typeof base & { beamElevations?: number[] }) =>
  calculateRackStructure(c).rows[0].modules[0].levels.filter((l) => l.hasBeam).map((l) => l.elevation)

describe('altura de cada viga', () => {
  it('sin elegir, se reparten parejas', () => {
    const e = elevations(base)
    expect(e).toHaveLength(2)
    expect(Math.abs(e[1] - e[0] - e[0])).toBeLessThanOrEqual(100)
  })
  it('a mano: cada viga a la altura elegida (al paso de los agujeros)', () => {
    expect(elevations({ ...base, beamElevations: [1520, 4000] })).toEqual([1500, 4000])
  })
  it('una viga nunca queda debajo de la anterior ni pasa el tope', () => {
    const e = elevations({ ...base, beamElevations: [3000, 2000] })
    expect(e[1]).toBeGreaterThan(e[0])
    expect(Math.max(...elevations({ ...base, beamElevations: [2000, 9000] }))).toBeLessThanOrEqual(6000)
  })
  it('si cambia la cantidad de niveles, vuelve a repartirlas parejas', () => {
    expect(elevations({ ...base, levels: 4, beamElevations: [1500, 4000] })).toHaveLength(3)
  })
})
