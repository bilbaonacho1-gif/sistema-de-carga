/**
 * LISTA DE MATERIALES: todas las piezas del rack, agrupadas por medida.
 * Cada línea tiene un código estable; si ese código está en PRICE_LIST
 * (technicalSpecs.ts) la línea lleva precio unitario.
 */
import { DESIGN_RULES, PRICE_LIST } from './technicalSpecs'
import type { MaterialLine, RackStructure } from './types'

const fmt = (n: number) => n.toLocaleString('es-AR')

export function buildMaterials(s: RackStructure): MaterialLine[] {
  const lines: MaterialLine[] = []
  const add = (line: Omit<MaterialLine, 'unitPrice'>) => {
    if (line.qty > 0) lines.push({ ...line, unitPrice: PRICE_LIST[line.code] })
  }
  const { config, upright, counts, accessories: acc } = s

  // bastidores: uno por cada altura distinta
  const frameHeights = new Map<number, number>()
  for (const f of s.frames) frameHeights.set(f.height, (frameHeights.get(f.height) ?? 0) + 1)
  for (const [height, qty] of [...frameHeights].sort((a, b) => a[0] - b[0]))
    add({
      code: `BAST-${upright.id}-${config.depth}-${height}`, group: 'Estructura', qty,
      name: `Bastidor ${fmt(config.depth)} × ${fmt(height)} mm`,
      detail: `${upright.name}, con diagonales, travesaños y 2 placas base`,
    })

  // vigas: por perfil y largo
  const beams = new Map<string, { qty: number; name: string; length: number; id: string }>()
  for (const mod of s.modules) {
    const beamLevels = mod.levels.filter((l) => l.hasBeam).length
    const key = `${mod.beam.id}-${mod.width}`
    const prev = beams.get(key) ?? { qty: 0, name: mod.beam.name, length: mod.width, id: mod.beam.id }
    prev.qty += beamLevels * DESIGN_RULES.beamsPerLevel
    beams.set(key, prev)
  }
  for (const b of [...beams.values()].sort((a, c) => a.length - c.length))
    add({ code: `VIGA-${b.id}-${b.length}`, group: 'Estructura', qty: b.qty, name: `${b.name} · ${fmt(b.length)} mm`, detail: 'Con conectores soldados en ambos extremos' })

  add({ code: 'PAS-SEG', group: 'Fijación', qty: counts.safetyPins, name: 'Pasador de seguridad', detail: '2 por viga' })
  add({ code: 'ANC-M12', group: 'Fijación', qty: counts.anchorBolts, name: 'Anclaje al piso M12', detail: `${DESIGN_RULES.anchorBoltsPerPlate} por placa base` })
  add({ code: 'DIST-ESP', group: 'Estructura', qty: counts.spacers, name: 'Distanciador espalda con espalda', detail: `${fmt(DESIGN_RULES.backToBackGap)} mm` })

  add({ code: 'PROT-COL', group: 'Accesorios', qty: counts.protectors, name: 'Protector de columna', detail: acc.protectors === 'ends' ? 'En los extremos de cada fila' : 'En cada parante del lado del pasillo' })
  add({ code: 'GUARD-CAB', group: 'Accesorios', qty: counts.guardrails, name: 'Guardarraíl de cabecera', detail: `Para bastidor de ${fmt(config.depth)} mm` })
  add({ code: 'CONEC-SUP', group: 'Accesorios', qty: counts.topTies, name: 'Conector superior', detail: config.layout.backToBack ? 'Une las filas espalda con espalda por arriba' : `Une las filas por arriba del pasillo (${fmt(config.layout.aisleWidth)} mm)` })
  add({ code: 'CRUZ-ARR', group: 'Accesorios', qty: counts.crossBraces, name: 'Cruz de arriostramiento posterior', detail: `Una cada ${DESIGN_RULES.modulesPerCrossBrace} módulos` })
  add({ code: 'CART-CAP', group: 'Accesorios', qty: counts.capacitySigns, name: 'Cartel de capacidad', detail: `Hasta ${fmt(s.levelLoad)} kg por nivel` })
  add({
    code: acc.decking === 'mesh' ? 'PISO-MALLA' : 'PISO-MAD', group: 'Accesorios', qty: counts.deckPanels,
    name: acc.decking === 'mesh' ? 'Piso de malla para nivel' : 'Piso de madera para nivel', detail: 'Uno por posición de pallet sobre vigas',
  })
  add({ code: 'TRAV-APOYO', group: 'Accesorios', qty: counts.palletSupports, name: 'Travesaño de apoyo de pallet', detail: `${DESIGN_RULES.supportsPerPallet} por posición, de viga a viga` })
  return lines
}

/** Total de la lista si TODAS las líneas tienen precio; si falta alguno, null. */
export function materialsTotal(lines: MaterialLine[]): number | null {
  if (!lines.length || lines.some((l) => l.unitPrice === undefined)) return null
  return lines.reduce((n, l) => n + l.qty * (l.unitPrice ?? 0), 0)
}
