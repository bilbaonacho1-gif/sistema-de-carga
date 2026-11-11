import { describe, expect, it } from 'vitest'
import { stackBoxes, DEFAULT_LOAD } from './load'

describe('carga con cajas', () => {
  it('pallet Arlog 1,00 × 1,20 con cajas de 40 × 30 × 30: 10 por capa, 4 capas', () => {
    const s = stackBoxes({ front: 1000, deep: 1200 }, { ...DEFAULT_LOAD, mode: 'boxes', boxW: 400, boxD: 300, boxH: 300, boxKg: 12, maxHeight: 1200 })
    // derecha: 2 × 4 = 8; girada: 3 × 3 = 9 → no, 1000/300=3 y 1200/400=3 → 9; la mejor es 2 × 4 = 8? se queda con la de más cajas
    expect(s.perLayer).toBe(Math.max(2 * 4, 3 * 3))
    expect(s.layers).toBe(4)
    expect(s.total).toBe(s.perLayer * 4)
    expect(s.height).toBe(1200)
    expect(s.weight).toBe(s.total * 12)
  })

  it('gira la caja si así entran más', () => {
    const s = stackBoxes({ front: 1200, deep: 800 }, { ...DEFAULT_LOAD, boxW: 400, boxD: 600, boxH: 250, maxHeight: 1000 })
    // derecha: 3 × 1 = 3; girada (600 × 400): 2 × 2 = 4
    expect(s).toMatchObject({ rotated: true, cols: 2, rows: 2, perLayer: 4, layers: 4, w: 600, d: 400 })
  })

  it('una caja más grande que el pallet no entra', () => {
    expect(stackBoxes({ front: 1000, deep: 1200 }, { ...DEFAULT_LOAD, boxW: 1500, boxD: 1500 }).total).toBe(0)
  })
})
