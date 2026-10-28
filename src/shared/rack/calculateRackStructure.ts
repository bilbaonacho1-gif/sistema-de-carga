/**
 * MOTOR DE CONFIGURACIÓN
 *
 * calculateRackStructure(configuración) → estructura completa (tramos, bastidores, módulos,
 * niveles, vigas, posiciones, pallets, accesorios, lista de materiales y advertencias).
 * El modelo 3D, el resumen y el presupuesto se construyen SOLO a partir de este resultado.
 *
 * Una fila se arma tramo por tramo: cada tramo tiene su altura, largo de viga y niveles.
 * Los módulos vecinos comparten el bastidor del medio, que toma la altura mayor.
 */
import { buildMaterials } from './bom'
import {
  BEAM_PROFILES, DEFAULT_ACCESSORIES, DESIGN_RULES, OFFICIAL_REFERENCE, PALLET_TYPES, UPRIGHT_PROFILES,
} from './technicalSpecs'
import { beamCapacityForSpan, defaultRules, type StructuralRules } from './rules'
import type {
  AccessoryConfig, BeamLayout, BeamProfile, FrameLayout, LevelLayout, ModuleLayout, PalletType, PositionSlot,
  RackConfiguration, RackSection, RackStructure, RackWarning, RowLayout, UprightProfile,
} from './types'

export interface Catalog {
  pallets: PalletType[]
  uprights: UprightProfile[]
  beams: BeamProfile[]
}

export const defaultCatalog: Catalog = {
  pallets: PALLET_TYPES,
  uprights: UPRIGHT_PROFILES,
  beams: BEAM_PROFILES,
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const snap = (v: number, step: number) => Math.round(v / step) * step
const fmt = (n: number) => n.toLocaleString('es-AR')
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v))
const range = (v: unknown, r: { min: number; max: number }, fallback = r.min) => clamp(Math.round(num(v)) || fallback, r.min, r.max)

function sanitizeAccessories(a: Partial<AccessoryConfig> | undefined): AccessoryConfig {
  const x = { ...DEFAULT_ACCESSORIES, ...(a && typeof a === 'object' ? a : {}) }
  return {
    protectors: ['none', 'ends', 'all'].includes(x.protectors) ? x.protectors : DEFAULT_ACCESSORIES.protectors,
    guardrails: !!x.guardrails,
    topTies: !!x.topTies,
    crossBracing: !!x.crossBracing,
    capacitySigns: !!x.capacitySigns,
    decking: ['none', 'wood', 'mesh'].includes(x.decking) ? x.decking : 'none',
    palletSupports: !!x.palletSupports,
  }
}

/** Lleva cualquier entrada a valores válidos (el usuario puede tipear cualquier cosa). */
export function sanitizeConfiguration(c: RackConfiguration): RackConfiguration {
  const L = DESIGN_RULES.limits
  const minLevels = c.floorStorage ? 2 : 1
  const levelRange = { min: Math.max(minLevels, L.levels.min), max: L.levels.max }
  const sections: RackSection[] = (Array.isArray(c.sections) ? c.sections : []).slice(0, L.sections.max).map((s) => ({
    modules: range(s?.modules, L.sectionModules, 1),
    width: range(s?.width, L.width),
    height: range(s?.height, L.height),
    levels: range(s?.levels, levelRange, minLevels),
  }))
  const cp = c.customPallet
  const out: RackConfiguration = {
    ...c,
    width: range(c.width, L.width),
    depth: range(c.depth, L.depth),
    height: range(c.height, L.height),
    levels: range(c.levels, levelRange, minLevels),
    positions: range(c.positions, L.positions, 1),
    palletWeight: clamp(Math.round(num(c.palletWeight)) || 0, L.palletWeight.min, L.palletWeight.max),
    palletsPerModule: c.palletsPerModule === 'auto' ? 'auto' : range(c.palletsPerModule, { min: 1, max: 4 }),
    layout: {
      ...c.layout,
      rows: range(c.layout?.rows, L.rows, 1),
      aisleWidth: range(c.layout?.aisleWidth, L.aisleWidth),
      backToBack: !!c.layout?.backToBack,
      warehouseLength: Math.max(0, Math.round(num(c.layout?.warehouseLength)) || 0),
      warehouseWidth: Math.max(0, Math.round(num(c.layout?.warehouseWidth)) || 0),
    },
    sections,
    customPallet: {
      front: range(cp?.front, L.palletFront, 1000),
      deep: range(cp?.deep, L.palletDeep, 1200),
      height: range(cp?.height, L.palletHeight, 144),
    },
    uprightId: UPRIGHT_PROFILES.some((u) => u.id === c.uprightId) ? c.uprightId : 'auto',
    beamId: BEAM_PROFILES.some((b) => b.id === c.beamId) ? c.beamId : 'auto',
    accessories: sanitizeAccessories(c.accessories),
  }
  // con tramos, los valores generales describen el rack completo (los usan cotas y resumen)
  if (sections.length) {
    out.width = sections[0].width
    out.height = Math.max(...sections.map((s) => s.height))
    out.levels = Math.max(...sections.map((s) => s.levels))
  }
  return out
}

/** El pallet configurado: uno del catálogo o el pallet a medida. */
export function resolvePallet(config: RackConfiguration, catalog: Catalog = defaultCatalog): PalletType {
  if (config.palletTypeId === 'custom' && config.customPallet) {
    const { front, deep, height } = config.customPallet
    return { id: `custom-${front}x${deep}x${height}`, name: `A medida ${fmt(front)} × ${fmt(deep)}`, front, deep, height }
  }
  return catalog.pallets.find((p) => p.id === config.palletTypeId) ?? catalog.pallets[0]
}

/** Cotas de los niveles: el piso (si se usa) y un plano de vigas por cada nivel restante. */
function computeLevels(
  height: number, storageLevels: number, floorStorage: boolean, pallet: PalletType, beamHeight: number,
): { levels: LevelLayout[]; tight: boolean } {
  const R = DESIGN_RULES
  const beamLevels = floorStorage ? storageLevels - 1 : storageLevels
  const topBeam = height - R.topMargin

  const beamElevations: number[] = []
  if (floorStorage) {
    const pitch = topBeam / beamLevels
    for (let i = 1; i <= beamLevels; i++) beamElevations.push(snap(i * pitch, R.holePitch))
  } else {
    const first = R.firstBeamWithoutFloor
    const pitch = beamLevels > 1 ? (topBeam - first) / (beamLevels - 1) : 0
    for (let i = 0; i < beamLevels; i++) beamElevations.push(snap(first + i * pitch, R.holePitch))
  }

  const supports = floorStorage ? [0, ...beamElevations] : beamElevations
  const levels: LevelLayout[] = supports.map((elevation, index) => {
    const next = supports[index + 1]
    const clearHeight = next !== undefined ? next - beamHeight - elevation : Infinity
    return { index, elevation, hasBeam: elevation > 0, clearHeight, loadHeight: 0 }
  })

  let tight = false
  for (const lv of levels) {
    const usable = lv.clearHeight - pallet.height - R.minTopClearance
    if (Number.isFinite(usable) && usable < R.minLoadHeight) tight = true
    lv.loadHeight = Number.isFinite(usable) ? clamp(usable, R.minLoadHeight, R.maxLoadHeight) : 0
  }
  // el nivel superior no tiene viga encima: copia la altura de carga del nivel de abajo
  const top = levels[levels.length - 1]
  top.loadHeight = levels.length > 1 ? levels[levels.length - 2].loadHeight : R.maxLoadHeight * 0.8
  return { levels, tight }
}

interface SectionCalc {
  index: number
  sec: RackSection
  ppm: number
  levelLoad: number
  beam: BeamProfile
  beamCapacity: number
  beamOk: boolean
  levels: LevelLayout[]
  beamLevels: number
}

export function calculateRackStructure(
  input: RackConfiguration,
  rules: StructuralRules = defaultRules,
  catalog: Catalog = defaultCatalog,
): RackStructure {
  const config = sanitizeConfiguration(input)
  const warnings: RackWarning[] = []
  const warn = (w: RackWarning) => { if (!warnings.some((x) => x.code === w.code)) warnings.push(w) }
  const R = DESIGN_RULES
  const { layout } = config
  const acc = config.accessories as AccessoryConfig
  const pallet = resolvePallet(config, catalog)
  const multi = config.sections!.length > 0
  const label = (i: number) => (multi ? `Tramo ${i + 1}: ` : '')

  /* ---- 1. Pallets por módulo según el largo de viga ---- */
  const ppmFor = (width: number, i: number) => {
    const auto = rules.palletsPerModule(width, pallet)
    let ppm = config.palletsPerModule === 'auto' ? auto : config.palletsPerModule
    if (ppm < 1) {
      ppm = 1
      warn({ code: `width-${i}`, level: 'validation', message: `${label(i)}el largo de viga (${fmt(width)} mm) no alcanza para un pallet ${pallet.name} con sus holguras.` })
    } else if (ppm > auto) {
      warn({ code: `ppm-${i}`, level: 'warning', message: `${label(i)}${ppm} pallets por módulo no entran con la holgura mínima de ${R.minPalletGap} mm. Aumentá el largo de viga.` })
    }
    return ppm
  }

  /* ---- 2. Tramos: el rack uniforme es un solo tramo que crece con las posiciones ---- */
  let sections: RackSection[]
  if (multi) {
    sections = config.sections!
  } else {
    const ppm = ppmFor(config.width, 0)
    const modules = rules.modulesForPositions(Math.ceil(config.positions / layout.rows), ppm, config.levels)
    sections = [{ modules, width: config.width, height: config.height, levels: config.levels }]
  }

  const forcedBeam = catalog.beams.find((b) => b.id === config.beamId)
  const calcs: SectionCalc[] = sections.map((sec, index) => {
    const ppm = ppmFor(sec.width, index)
    const levelLoad = ppm * config.palletWeight
    let beam: BeamProfile, beamCapacity: number, beamOk: boolean
    if (forcedBeam) {
      beam = forcedBeam
      beamCapacity = beamCapacityForSpan(forcedBeam, sec.width)
      beamOk = beamCapacity >= levelLoad
    } else {
      ({ beam, capacity: beamCapacity, ok: beamOk } = rules.selectBeam(catalog.beams, sec.width, levelLoad))
    }
    const { levels, tight } = computeLevels(sec.height, sec.levels, config.floorStorage, pallet, beam.height)
    if (tight) warn({ code: 'clearance', level: 'warning', message: `${label(index)}la altura libre entre niveles es insuficiente para el pallet y la carga. Reducí la cantidad de niveles o aumentá la altura.` })
    if (!beamOk) {
      warn({
        code: `beam-${index}`, level: 'validation',
        message: forcedBeam
          ? `${label(index)}la ${beam.name} soporta ${fmt(beamCapacity)} kg con ${fmt(sec.width)} mm de luz y el nivel lleva ${fmt(levelLoad)} kg. Elegí una viga mayor o dejá la selección automática.`
          : `${label(index)}ninguna viga del catálogo cubre ${fmt(levelLoad)} kg en una luz de ${fmt(sec.width)} mm. La configuración ingresada requiere validación técnica.`,
      })
    }
    return { index, sec, ppm, levelLoad, beam, beamCapacity, beamOk, levels, beamLevels: config.floorStorage ? sec.levels - 1 : sec.levels }
  })

  /* ---- 3. Parante: uno para todo el rack, según el bastidor más cargado ---- */
  const totalModules = calcs.reduce((n, c) => n + c.sec.modules, 0)
  const moduleLoad = Math.max(...calcs.map((c) => c.levelLoad * c.beamLevels))
  const maxFrameLoad = totalModules > 1 ? moduleLoad : moduleLoad / 2
  const forcedUpright = catalog.uprights.find((u) => u.id === config.uprightId)
  let upright: UprightProfile, uprightOk: boolean
  if (forcedUpright) {
    upright = forcedUpright
    uprightOk = forcedUpright.maxFrameLoad >= maxFrameLoad
  } else {
    ({ upright, ok: uprightOk } = rules.selectUpright(catalog.uprights, maxFrameLoad))
  }

  /* ---- 4. Módulos en orden a lo largo de la fila ---- */
  const perModule = calcs.flatMap((c) => Array.from({ length: c.sec.modules }, () => c))
  const uw = upright.faceWidth
  const framesPerRow = rules.framesPerRow(totalModules)
  const frameX: number[] = [uw / 2]
  perModule.forEach((c, i) => frameX.push(frameX[i] + uw + c.sec.width))
  const frameHeight = (i: number) => Math.max(perModule[i - 1]?.sec.height ?? 0, perModule[i]?.sec.height ?? 0)
  const rowLength = perModule.reduce((n, c) => n + c.sec.width, 0) + framesPerRow * uw

  const rows: RowLayout[] = []
  const D = config.depth
  for (let r = 0; r < layout.rows; r++) {
    let zFront: number
    let facing: 1 | -1 = 1
    if (layout.backToBack) {
      const pair = Math.floor(r / 2)
      const z0 = -pair * (2 * D + R.backToBackGap + layout.aisleWidth)
      if (r % 2 === 0) zFront = z0
      else { zFront = z0 - 2 * D - R.backToBackGap; facing = -1 }
    } else {
      zFront = -r * (D + layout.aisleWidth)
    }
    // la cantidad la decide la regla (por defecto módulos + 1, compartidos); si una regla
    // pide más, los bastidores extra se ubican a continuación
    const frames: FrameLayout[] = Array.from({ length: framesPerRow }, (_, i) => {
      const last = frameX.length - 1
      const x = i <= last ? frameX[i] : frameX[last] + (i - last) * uw * 2
      return { id: `r${r}-f${i}`, row: r, index: i, x, height: frameHeight(Math.min(i, last)) }
    })
    const modules: ModuleLayout[] = perModule.map((c, m) => {
      const xStart = frameX[m] + uw / 2
      return {
        id: `r${r}-m${m}`, row: r, index: m, xStart, xEnd: xStart + c.sec.width, leftFrame: m, rightFrame: m + 1,
        section: c.index, width: c.sec.width, height: c.sec.height, palletsPerModule: c.ppm, levels: c.levels, beam: c.beam,
      }
    })
    rows.push({ index: r, zFront, facing, frames, modules })
  }

  /* ---- 5. Vigas ---- */
  const beams: BeamLayout[] = []
  for (const row of rows)
    for (const mod of row.modules)
      for (const lv of mod.levels)
        if (lv.hasBeam)
          for (const side of ['front', 'back'] as const)
            beams.push({ id: `${mod.id}-l${lv.index}-${side}`, row: row.index, module: mod.index, level: lv.index, side, length: mod.width, elevation: lv.elevation })

  /* ---- 6. Posiciones (orden de llenado: crece hacia la derecha) ---- */
  const positions: PositionSlot[] = []
  let order = 0
  for (let m = 0; m < totalModules; m++)
    for (const row of rows) {
      const mod = row.modules[m]
      const gap = (mod.width - mod.palletsPerModule * pallet.front) / (mod.palletsPerModule + 1)
      for (const lv of mod.levels)
        for (let s = 0; s < mod.palletsPerModule; s++) {
          positions.push({
            id: `${mod.id}-l${lv.index}-s${s}`, order, row: row.index, module: m, level: lv.index, slot: s,
            x: mod.xStart + gap + s * (pallet.front + gap) + pallet.front / 2,
            elevation: lv.elevation,
            // con tramos se dibuja el rack lleno; el uniforme se llena hasta las posiciones pedidas
            occupied: multi || order < config.positions,
          })
          order++
        }
    }
  const pallets = positions.filter((p) => p.occupied)

  /* ---- 7. Totales ---- */
  const zMin = Math.min(...rows.map((r) => (r.facing === 1 ? r.zFront - D : r.zFront)))
  const zMax = Math.max(...rows.map((r) => (r.facing === 1 ? r.zFront : r.zFront + D)))
  const totalDepth = zMax - zMin
  const totalHeight = Math.max(...calcs.map((c) => {
    const top = c.levels[c.levels.length - 1]
    return Math.max(c.sec.height, top.elevation + pallet.height + top.loadHeight)
  }))
  const positionsAvailable = positions.length
  const allFrames = rows.flatMap((r) => r.frames)
  const allModules = rows.flatMap((r) => r.modules)

  /* ---- 8. Piezas y accesorios ---- */
  const pairs = layout.backToBack ? Math.floor(layout.rows / 2) : 0
  const beamCount = allModules.reduce((n, mod) => n + mod.levels.filter((l) => l.hasBeam).length * rules.beamsPerLevel(), 0)
  const beamPositions = allModules.reduce((n, mod) => n + mod.levels.filter((l) => l.hasBeam).length * mod.palletsPerModule, 0)
  const rowBlocks = layout.backToBack ? Math.ceil(layout.rows / 2) : layout.rows
  const tiedJoins = layout.backToBack ? pairs : layout.rows - 1
  const protectorsPerRow = acc.protectors === 'all' ? framesPerRow : acc.protectors === 'ends' ? Math.min(2, framesPerRow) : 0
  const counts = {
    frames: allFrames.length,
    uprights: allFrames.length * 2,
    beams: beamCount,
    connectors: beamCount * 2,
    safetyPins: beamCount * 2,
    diagonals: allFrames.reduce((n, f) => n + rules.diagonalsPerFrame(f.height), 0),
    horizontals: allFrames.reduce((n, f) => n + rules.horizontalsPerFrame(f.height), 0),
    basePlates: allFrames.length * 2,
    anchorBolts: allFrames.length * 2 * R.anchorBoltsPerPlate,
    protectors: layout.rows * protectorsPerRow,
    spacers: pairs * rules.spacersPerPair(framesPerRow),
    guardrails: acc.guardrails ? rowBlocks * 2 : 0,
    topTies: acc.topTies ? tiedJoins * framesPerRow : 0,
    crossBraces: acc.crossBracing ? layout.rows * Math.max(1, Math.ceil(totalModules / R.modulesPerCrossBrace)) : 0,
    capacitySigns: acc.capacitySigns ? layout.rows * totalModules : 0,
    deckPanels: acc.decking !== 'none' ? beamPositions : 0,
    palletSupports: acc.palletSupports ? beamPositions * R.supportsPerPallet : 0,
  }

  /* ---- 9. Advertencias técnicas ---- */
  const VALIDATION = 'La configuración ingresada requiere validación técnica.'
  const levelLoad = Math.max(...calcs.map((c) => c.levelLoad))
  if (config.palletWeight > OFFICIAL_REFERENCE.maxPalletWeight)
    warn({ code: 'pallet-weight', level: 'validation', message: `Peso por pallet de ${fmt(config.palletWeight)} kg: supera la referencia publicada de ${fmt(OFFICIAL_REFERENCE.maxPalletWeight)} kg. ${VALIDATION}` })
  if (levelLoad > OFFICIAL_REFERENCE.maxLevelLoad)
    warn({ code: 'level-load', level: 'validation', message: `Carga por plano de ${fmt(levelLoad)} kg: supera la referencia publicada de ${fmt(OFFICIAL_REFERENCE.maxLevelLoad)} kg por plano. ${VALIDATION}` })
  if (config.height > OFFICIAL_REFERENCE.maxHeight)
    warn({ code: 'height', level: 'validation', message: `Altura de ${fmt(config.height)} mm: supera la altura máxima publicada de ${fmt(OFFICIAL_REFERENCE.maxHeight)} mm. ${VALIDATION}` })
  if (!uprightOk)
    warn({
      code: 'upright', level: 'validation',
      message: forcedUpright
        ? `El ${upright.name} soporta ${fmt(upright.maxFrameLoad)} kg por bastidor y el más cargado lleva ${fmt(maxFrameLoad)} kg. Elegí un parante mayor o dejá la selección automática.`
        : `La carga por bastidor (${fmt(maxFrameLoad)} kg) supera los perfiles del catálogo. ${VALIDATION}`,
    })

  const overhang = (pallet.deep - config.depth) / 2
  const beamDepth = Math.max(...calcs.map((c) => c.beam.depth))
  if (pallet.deep < config.depth - 2 * beamDepth)
    warn({ code: 'depth', level: 'validation', message: `El pallet (${fmt(pallet.deep)} mm) no llega a apoyar sobre las dos vigas con una profundidad de ${fmt(config.depth)} mm.` })
  else if (overhang > R.palletOverhang.max)
    warn({ code: 'overhang', level: 'warning', message: `Voladizo del pallet de ${fmt(overhang)} mm por lado. Se recomienda un bastidor más profundo.` })

  if (!multi && positionsAvailable > config.positions)
    warn({ code: 'free-positions', level: 'info', message: `Los módulos se completan enteros: la estructura ofrece ${positionsAvailable} posiciones (${positionsAvailable - config.positions} libres para crecer).` })
  if (acc.topTies && tiedJoins === 0)
    warn({ code: 'top-ties', level: 'info', message: 'Los conectores superiores unen filas entre sí: con una sola fila no se usan.' })

  if (layout.warehouseLength > 0 && rowLength > layout.warehouseLength)
    warn({ code: 'fit-length', level: 'warning', message: `El largo total (${fmt(rowLength)} mm) excede el largo del depósito (${fmt(layout.warehouseLength)} mm).` })
  if (layout.warehouseWidth > 0 && totalDepth > layout.warehouseWidth)
    warn({ code: 'fit-width', level: 'warning', message: `La profundidad total (${fmt(totalDepth)} mm) excede el ancho del depósito (${fmt(layout.warehouseWidth)} mm).` })

  const first = calcs[0]
  const structure: RackStructure = {
    config, pallet, upright, beam: first.beam, sections, accessories: acc,
    rows, frames: allFrames, modules: allModules, beams, levels: first.levels, positions, pallets,
    modulesPerRow: totalModules,
    palletsPerModule: first.ppm,
    palletsPerLevel: calcs.reduce((n, c) => n + c.ppm * c.sec.modules, 0) * layout.rows,
    storageLevels: Math.max(...calcs.map((c) => c.sec.levels)),
    beamLevels: Math.max(...calcs.map((c) => c.beamLevels)),
    positionsAvailable,
    positionsRequested: multi ? positionsAvailable : config.positions,
    totalWidth: rowLength, totalDepth, totalHeight,
    totalCapacity: positionsAvailable * config.palletWeight,
    levelLoad, maxFrameLoad,
    beamCapacity: Math.min(...calcs.map((c) => c.beamCapacity)),
    counts, materials: [], warnings,
  }
  structure.materials = buildMaterials(structure)
  return structure
}
