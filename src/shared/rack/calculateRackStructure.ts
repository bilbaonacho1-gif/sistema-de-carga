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
  BEAM_PROFILES, DEFAULT_ACCESSORIES, DESIGN_RULES, OFFICIAL_REFERENCE, PAINT_COLORS, PALLET_TYPES, UPRIGHT_PROFILES,
} from './technicalSpecs'
import { beamCapacityForSpan, defaultRules, type StructuralRules } from './rules'
import { profilesOf, sanitizeProfiles } from './profiles'
import { metros } from '../units'
import type {
  AccessoryConfig, BeamLayout, BeamProfile, FrameLayout, LevelLayout, ModuleLayout, PaintColor, PalletType, PositionSlot,
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

const paint = <T extends string>(v: unknown, fallback: T): PaintColor | T => (PAINT_COLORS.some((c) => c.id === v) ? (v as PaintColor) : fallback)

function sanitizeAccessories(a: Partial<AccessoryConfig> | undefined): AccessoryConfig {
  const x = { ...DEFAULT_ACCESSORIES, ...(a && typeof a === 'object' ? a : {}) }
  return {
    protectors: ['none', 'ends', 'all'].includes(x.protectors) ? x.protectors : DEFAULT_ACCESSORIES.protectors,
    guardrails: !!x.guardrails,
    topTies: !!x.topTies,
    crossBracing: !!x.crossBracing,
    capacitySigns: !!x.capacitySigns,
    decking: ['none', 'wood', 'mesh', 'steel'].includes(x.decking) ? x.decking : 'none',
    palletSupports: !!x.palletSupports,
    protectorType: ['angulo', 'u', 'poste', 'bajo'].includes(x.protectorType) ? x.protectorType : DEFAULT_ACCESSORIES.protectorType,
    guardrailType: ['baranda', 'arco'].includes(x.guardrailType) ? x.guardrailType : DEFAULT_ACCESSORIES.guardrailType,
    backMesh: !!x.backMesh,
    rowSigns: !!x.rowSigns,
    floorGuide: !!x.floorGuide,
    beamColor: paint(x.beamColor, DEFAULT_ACCESSORIES.beamColor),
    uprightColor: x.uprightColor === 'galvanizado' ? 'galvanizado' : paint(x.uprightColor, 'galvanizado' as never),
    protectorColor: paint(x.protectorColor, DEFAULT_ACCESSORIES.protectorColor),
  }
}

/** Lleva cualquier entrada a valores válidos (el usuario puede tipear cualquier cosa). */
export function sanitizeConfiguration(c: RackConfiguration): RackConfiguration {
  const L = DESIGN_RULES.limits
  const minLevels = c.floorStorage ? 2 : 1
  const levelRange = { min: Math.max(minLevels, L.levels.min), max: L.levels.max }
  // (hasta un tramo por módulo: así cada módulo de un rack del plano puede tener sus piezas)
  // piezas de fábrica + las creadas por el usuario
  const customProfiles = sanitizeProfiles(c.customProfiles)
  const all = profilesOf({ customProfiles })
  const sections: RackSection[] = (Array.isArray(c.sections) ? c.sections : []).slice(0, L.sectionModules.max).map((s) => ({
    modules: range(s?.modules, L.sectionModules, 1),
    width: range(s?.width, L.width),
    height: range(s?.height, L.height),
    // un tramo puede no usar el piso (paso para el autoelevador): ahí alcanza con un nivel
    levels: range(s?.levels, typeof s?.floorStorage === 'boolean' && !s.floorStorage ? { min: 1, max: L.levels.max } : levelRange, minLevels),
    ...(typeof s?.floorStorage === 'boolean' ? { floorStorage: s.floorStorage } : {}),
    ...(Array.isArray(s?.beamElevations) ? { beamElevations: s.beamElevations } : {}),
    ...(s?.beamId && all.beams.some((b) => b.id === s.beamId) ? { beamId: s.beamId } : {}),
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
    uprightId: all.uprights.some((u) => u.id === c.uprightId) ? c.uprightId : 'auto',
    beamId: all.beams.some((b) => b.id === c.beamId) ? c.beamId : 'auto',
    ...(customProfiles.uprights.length || customProfiles.beams.length || customProfiles.objects?.length ? { customProfiles } : { customProfiles: undefined }),
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
  custom?: number[],
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

  // alturas de viga elegidas a mano (una por plano de vigas): se acomodan al paso de los agujeros,
  // quedan entre el piso y el tope del parante y nunca una debajo de la anterior
  if (custom && custom.length === beamLevels) {
    let prev = 0
    for (let i = 0; i < beamLevels; i++) {
      const v = Number(custom[i])
      if (!Number.isFinite(v) || v <= 0) continue
      const minV = prev + beamHeight + R.holePitch
      beamElevations[i] = clamp(snap(v, R.holePitch), Math.max(R.holePitch, minV), topBeam)
      prev = beamElevations[i]
    }
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
  baseCatalog: Catalog = defaultCatalog,
): RackStructure {
  const config = sanitizeConfiguration(input)
  // el catálogo con el que se calcula: el de fábrica más las piezas propias del usuario
  const catalog: Catalog = config.customProfiles ? { ...baseCatalog, ...profilesOf(config, baseCatalog) } : baseCatalog
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
      warn({ code: `width-${i}`, level: 'validation', message: `${label(i)}el largo de viga (${metros(width)}) no alcanza para un pallet ${pallet.name} con sus holguras.` })
    } else if (ppm > auto) {
      warn({ code: `ppm-${i}`, level: 'warning', message: `${label(i)}${ppm} pallets por módulo no entran con la holgura mínima de ${metros(R.minPalletGap)}. Aumentá el largo de viga.` })
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

  const calcs: SectionCalc[] = sections.map((sec, index) => {
    // cada tramo puede tener su propio perfil de viga y sus alturas de viga
    const forcedBeam = catalog.beams.find((b) => b.id === (sec.beamId ?? config.beamId))
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
    const floor = sec.floorStorage ?? config.floorStorage
    const { levels, tight } = computeLevels(sec.height, sec.levels, floor, pallet, beam.height, sec.beamElevations ?? config.beamElevations)
    if (tight) warn({ code: 'clearance', level: 'warning', message: `${label(index)}la altura libre entre niveles es insuficiente para el pallet y la carga. Reducí la cantidad de niveles o aumentá la altura.` })
    if (!beamOk) {
      warn({
        code: `beam-${index}`, level: 'validation',
        message: forcedBeam
          ? `${label(index)}la ${beam.name} soporta ${fmt(beamCapacity)} kg con ${metros(sec.width)} de luz y el nivel lleva ${fmt(levelLoad)} kg. Elegí una viga mayor o dejá la selección automática.`
          : `${label(index)}ninguna viga del catálogo cubre ${fmt(levelLoad)} kg en una luz de ${metros(sec.width)}. La configuración ingresada requiere validación técnica.`,
      })
    }
    return { index, sec, ppm, levelLoad, beam, beamCapacity, beamOk, levels, beamLevels: floor ? sec.levels - 1 : sec.levels }
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
  const autoFrameHeight = (i: number) => Math.max(perModule[i - 1]?.sec.height ?? 0, perModule[i]?.sec.height ?? 0)
  /** Lo mínimo que puede medir un bastidor: por encima de la viga más alta de los módulos que sostiene. */
  const minFrameHeight = (i: number) => Math.max(0, ...[perModule[i - 1], perModule[i]].filter(Boolean).map((c) => {
    const top = c!.levels.filter((l) => l.hasBeam).pop()
    return top ? top.elevation + c!.beam.height + R.holePitch : 0
  }))
  const frameHeight = (i: number) => {
    const own = config.frameHeights?.[i]
    return own ? clamp(Math.round(own), Math.max(minFrameHeight(i), R.limits.height.min), R.limits.height.max) : autoFrameHeight(i)
  }
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
    // la fila de atrás de un par está girada: sus módulos van en orden inverso para quedar
    // enfrentados con los de adelante (key = número del módulo / bastidor contado desde adelante)
    const rev = facing === -1
    const order = rev ? [...perModule].reverse() : perModule
    const fx: number[] = [uw / 2]
    order.forEach((c, i) => fx.push(fx[i] + uw + c.sec.width))
    const last = fx.length - 1
    const frames: FrameLayout[] = Array.from({ length: framesPerRow }, (_, i) => {
      const x = i <= last ? fx[i] : fx[last] + (i - last) * uw * 2
      const key = rev ? last - Math.min(i, last) : Math.min(i, last)
      // el pórtico: dos columnas, sus riendas (las de la regla, o las que se le pusieron) y sus bases
      const h = frameHeight(key), own = config.frameDefault || config.frameParts?.[key] ? { ...config.frameDefault, ...config.frameParts?.[key] } : undefined
      const count = (v: number | undefined, auto: number, max: number) => (Number.isFinite(v) ? clamp(Math.round(v as number), 0, max) : auto)
      // cada columna puede tener su alto (por ejemplo, una más alta para un arriostre superior), nunca por debajo de las vigas
      const col = (v: number | undefined) => (Number.isFinite(v) && (v as number) > 0 ? clamp(Math.round(v as number), Math.max(minFrameHeight(key), R.limits.height.min), R.limits.height.max) : h)
      const columns: [number, number] = [col(own?.frontHeight), col(own?.backHeight)]
      const low = Math.min(...columns)
      return {
        id: `r${r}-f${i}`, row: r, index: i, key, x, height: low, columns,
        diagonals: count(own?.diagonals, rules.diagonalsPerFrame(low), 60), horizontals: count(own?.horizontals, rules.horizontalsPerFrame(low), 20),
        bases: [!own?.noBaseFront, !own?.noBaseBack] as [boolean, boolean],
      }
    })
    const modules: ModuleLayout[] = order.map((c, m) => {
      const xStart = fx[m] + uw / 2
      return {
        id: `r${r}-m${m}`, row: r, index: m, key: rev ? totalModules - 1 - m : m, xStart, xEnd: xStart + c.sec.width, leftFrame: m, rightFrame: m + 1,
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
  const basePlates = allFrames.reduce((n, f) => n + (f.bases[0] ? 1 : 0) + (f.bases[1] ? 1 : 0), 0)
  const counts = {
    frames: allFrames.length,
    uprights: allFrames.length * 2,
    beams: beamCount,
    connectors: beamCount * 2,
    safetyPins: beamCount * 2,
    diagonals: allFrames.reduce((n, f) => n + f.diagonals, 0),
    horizontals: allFrames.reduce((n, f) => n + f.horizontals, 0),
    basePlates: basePlates,
    anchorBolts: basePlates * R.anchorBoltsPerPlate,
    protectors: layout.rows * protectorsPerRow,
    spacers: pairs * rules.spacersPerPair(framesPerRow),
    guardrails: acc.guardrails ? rowBlocks * 2 : 0,
    topTies: acc.topTies ? tiedJoins * framesPerRow : 0,
    crossBraces: acc.crossBracing ? layout.rows * Math.max(1, Math.ceil(totalModules / R.modulesPerCrossBrace)) : 0,
    capacitySigns: acc.capacitySigns ? layout.rows * totalModules : 0,
    deckPanels: acc.decking !== 'none' ? beamPositions : 0,
    palletSupports: acc.palletSupports ? beamPositions * R.supportsPerPallet : 0,
    // una malla por módulo y por fila, en la cara de atrás
    backMesh: acc.backMesh ? layout.rows * totalModules : 0,
    // un cartel en cada cabecera y una guía por fila
    rowSigns: acc.rowSigns ? layout.rows * 2 : 0,
    floorGuides: acc.floorGuide ? layout.rows : 0,
  }

  /* ---- 9. Advertencias técnicas ---- */
  const VALIDATION = 'La configuración ingresada requiere validación técnica.'
  const levelLoad = Math.max(...calcs.map((c) => c.levelLoad))
  if (config.palletWeight > OFFICIAL_REFERENCE.maxPalletWeight)
    warn({ code: 'pallet-weight', level: 'validation', message: `Peso por pallet de ${fmt(config.palletWeight)} kg: supera la referencia publicada de ${fmt(OFFICIAL_REFERENCE.maxPalletWeight)} kg. ${VALIDATION}` })
  if (levelLoad > OFFICIAL_REFERENCE.maxLevelLoad)
    warn({ code: 'level-load', level: 'validation', message: `Carga por plano de ${fmt(levelLoad)} kg: supera la referencia publicada de ${fmt(OFFICIAL_REFERENCE.maxLevelLoad)} kg por plano. ${VALIDATION}` })
  if (config.height > OFFICIAL_REFERENCE.maxHeight)
    warn({ code: 'height', level: 'validation', message: `Altura de ${metros(config.height)}: supera la altura máxima publicada de ${metros(OFFICIAL_REFERENCE.maxHeight)}. ${VALIDATION}` })
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
    warn({ code: 'depth', level: 'validation', message: `El pallet (${metros(pallet.deep)}) no llega a apoyar sobre las dos vigas con una profundidad de ${metros(config.depth)}.` })
  else if (overhang > R.palletOverhang.max)
    warn({ code: 'overhang', level: 'warning', message: `Voladizo del pallet de ${metros(overhang)} por lado. Se recomienda un bastidor más profundo.` })

  if (!multi && positionsAvailable > config.positions)
    warn({ code: 'free-positions', level: 'info', message: `Los módulos se completan enteros: la estructura ofrece ${positionsAvailable} posiciones (${positionsAvailable - config.positions} libres para crecer).` })
  if (acc.topTies && tiedJoins === 0)
    warn({ code: 'top-ties', level: 'info', message: 'Los conectores superiores unen filas entre sí: con una sola fila no se usan.' })

  if (layout.warehouseLength > 0 && rowLength > layout.warehouseLength)
    warn({ code: 'fit-length', level: 'warning', message: `El largo total (${metros(rowLength)}) excede el largo del depósito (${metros(layout.warehouseLength)}).` })
  if (layout.warehouseWidth > 0 && totalDepth > layout.warehouseWidth)
    warn({ code: 'fit-width', level: 'warning', message: `La profundidad total (${metros(totalDepth)}) excede el ancho del depósito (${metros(layout.warehouseWidth)}).` })

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
