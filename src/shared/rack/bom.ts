/**
 * LISTA DE MATERIALES: todas las piezas del rack, agrupadas por medida.
 * Cada línea tiene un código estable; si ese código está en PRICE_LIST
 * (technicalSpecs.ts) la línea lleva precio unitario.
 */
import { colorName, DESIGN_RULES, PRICE_LIST } from './technicalSpecs'
import type { MaterialLine, RackStructure } from './types'
import { metros } from '../units'

const fmt = (n: number) => n.toLocaleString('es-AR')

export function buildMaterials(s: RackStructure): MaterialLine[] {
  const lines: MaterialLine[] = []
  const add = (line: Omit<MaterialLine, 'unitPrice'>) => {
    if (line.qty > 0) lines.push({ ...line, unitPrice: PRICE_LIST[line.code] })
  }
  const { config, upright, counts, accessories: acc } = s

  // pórticos, por sus piezas: columnas (por altura), bases y riendas
  const paint = acc.uprightColor === 'galvanizado' ? 'galvanizada' : `pintada ${colorName(acc.uprightColor).toLowerCase()}`
  const columns = new Map<number, number>()
  for (const f of s.frames) for (const h of f.columns) columns.set(h, (columns.get(h) ?? 0) + 1)
  for (const [height, qty] of [...columns].sort((a, b) => a[0] - b[0]))
    add({ code: `COL-${upright.id}-${height}`, group: 'Estructura', qty, name: `Columna de pórtico · ${metros(height)}`, detail: `${upright.name}, ${paint} · para ${s.frames.length === 1 ? 'el pórtico' : `los ${s.frames.length} pórticos`} de ${metros(config.depth)} de fondo` })
  add({ code: `BASE-${upright.id}`, group: 'Estructura', qty: counts.basePlates, name: 'Base de columna', detail: 'Placa base para abulonar al piso' })
  add({ code: `RIENDA-D-${config.depth}`, group: 'Estructura', qty: counts.diagonals, name: 'Rienda diagonal', detail: `Para pórtico de ${metros(config.depth)} de fondo` })
  add({ code: `RIENDA-H-${config.depth}`, group: 'Estructura', qty: counts.horizontals, name: 'Rienda horizontal', detail: `Para pórtico de ${metros(config.depth)} de fondo` })

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
    add({ code: `VIGA-${b.id}-${b.length}`, group: 'Estructura', qty: b.qty, name: `${b.name} · ${metros(b.length)}`, detail: `Pintada ${colorName(acc.beamColor).toLowerCase()}, con conectores soldados en ambos extremos` })

  add({ code: 'PAS-SEG', group: 'Fijación', qty: counts.safetyPins, name: 'Pasador de seguridad', detail: '2 por viga' })
  add({ code: 'ANC-M12', group: 'Fijación', qty: counts.anchorBolts, name: 'Anclaje al piso M12', detail: `${DESIGN_RULES.anchorBoltsPerPlate} por placa base` })
  add({ code: 'DIST-ESP', group: 'Estructura', qty: counts.spacers, name: 'Distanciador espalda con espalda', detail: metros(DESIGN_RULES.backToBackGap) })

  const prot = {
    angulo: ['PROT-ANG', 'Protector de columna en ángulo'], u: ['PROT-U', 'Protector de columna en U'],
    poste: ['PROT-POSTE', 'Protector de columna tipo poste'], bajo: ['PROT-BAJO', 'Protector de columna bajo'],
  }[acc.protectorType]
  add({
    code: prot[0], group: 'Accesorios', qty: counts.protectors, name: prot[1],
    detail: `${acc.protectors === 'ends' ? 'En los extremos de cada fila' : 'En cada parante del lado del pasillo'} · ${colorName(acc.protectorColor).toLowerCase()}`,
  })
  add(acc.guardrailType === 'arco'
    ? { code: 'DEF-ARCO', group: 'Accesorios', qty: counts.guardrails, name: 'Defensa de cabecera en arco', detail: `Para pórtico de ${metros(config.depth)}` }
    : { code: 'GUARD-CAB', group: 'Accesorios', qty: counts.guardrails, name: 'Guardarraíl de cabecera', detail: `Para pórtico de ${metros(config.depth)}` })
  add({ code: 'CART-FILA', group: 'Accesorios', qty: counts.rowSigns, name: 'Cartel de fila', detail: 'Uno en cada cabecera' })
  add({ code: 'GUIA-PISO', group: 'Accesorios', qty: counts.floorGuides, name: 'Guía de piso para autoelevador', detail: `Una por fila, de ${metros(s.totalWidth)}` })
  add({ code: 'MALLA-FONDO', group: 'Accesorios', qty: counts.backMesh, name: 'Malla de fondo anticaída', detail: 'Una por módulo, en la cara de atrás' })
  add({ code: 'CONEC-SUP', group: 'Accesorios', qty: counts.topTies, name: 'Conector superior', detail: config.layout.backToBack ? 'Une las filas espalda con espalda por arriba' : `Une las filas por arriba del pasillo (${metros(config.layout.aisleWidth)})` })
  add({ code: 'CRUZ-ARR', group: 'Accesorios', qty: counts.crossBraces, name: 'Cruz de arriostramiento posterior', detail: `Una cada ${DESIGN_RULES.modulesPerCrossBrace} módulos` })
  add({ code: 'CART-CAP', group: 'Accesorios', qty: counts.capacitySigns, name: 'Cartel de capacidad', detail: `Hasta ${fmt(s.levelLoad)} kg por nivel` })
  const deck = { mesh: ['PISO-MALLA', 'Piso de malla para nivel'], steel: ['PISO-CHAPA', 'Piso de chapa para nivel'], wood: ['PISO-MAD', 'Piso de madera para nivel'], none: ['PISO-MAD', ''] }[acc.decking]
  add({ code: deck[0], group: 'Accesorios', qty: counts.deckPanels, name: deck[1], detail: 'Uno por posición de pallet sobre vigas' })
  add({ code: 'TRAV-APOYO', group: 'Accesorios', qty: counts.palletSupports, name: 'Travesaño de apoyo de pallet', detail: `${DESIGN_RULES.supportsPerPallet} por posición, de viga a viga` })
  return lines
}

/** Total de la lista si TODAS las líneas tienen precio; si falta alguno, null. */
export function materialsTotal(lines: MaterialLine[]): number | null {
  if (!lines.length || lines.some((l) => l.unitPrice === undefined)) return null
  return lines.reduce((n, l) => n + l.qty * (l.unitPrice ?? 0), 0)
}
