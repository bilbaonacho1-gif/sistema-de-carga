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

describe('mis piezas (catálogo propio)', () => {
  const own = {
    uprights: [{ id: 'mp-1', name: 'Parante 90 × 75', faceWidth: 90, depth: 75, thickness: 2.5, maxFrameLoad: 30_000 }],
    beams: [{ id: 'mv-1', name: 'Viga 110 × 50', height: 110, depth: 50, capacityBySpan: [{ maxSpan: 3600, capacity: 2500 }] }],
  }
  it('una viga y un parante propios se pueden elegir y entran en la lista de materiales', async () => {
    const { calculateRackStructure } = await import('./calculateRackStructure')
    const { DEFAULT_CONFIGURATION } = await import('./technicalSpecs')
    const s = calculateRackStructure({ ...DEFAULT_CONFIGURATION, customProfiles: own, beamId: 'mv-1', uprightId: 'mp-1' })
    expect(s.beam.id).toBe('mv-1')
    expect(s.upright.id).toBe('mp-1')
    expect(s.upright.faceWidth).toBe(90)
    expect(s.materials.some((m) => m.code.includes('mv-1'))).toBe(true)
  })
  it('si la pieza propia se borra, el rack vuelve a la elección automática', async () => {
    const { calculateRackStructure } = await import('./calculateRackStructure')
    const { DEFAULT_CONFIGURATION, BEAM_PROFILES } = await import('./technicalSpecs')
    const s = calculateRackStructure({ ...DEFAULT_CONFIGURATION, beamId: 'mv-1' })
    expect(BEAM_PROFILES.some((b) => b.id === s.beam.id)).toBe(true)
  })
  it('las piezas propias también entran en la elección automática', async () => {
    const { profilesOf } = await import('./profiles')
    const all = profilesOf({ customProfiles: own })
    expect(all.beams.map((b) => b.id)).toContain('mv-1')
    expect(all.beams.map((b) => b.height * b.depth)).toEqual([...all.beams.map((b) => b.height * b.depth)].sort((a, b) => a - b))
  })
})
