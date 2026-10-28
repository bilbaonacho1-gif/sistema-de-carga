/**
 * DATOS TÉCNICOS — el único archivo que hay que tocar cuando Sistemas de Carga
 * entregue las medidas y capacidades reales. El resto del programa lee de acá.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ OFFICIAL_REFERENCE: publicado en sistemasdecargas.com.ar/rackselectivo   │
 * │ El resto (catálogo de perfiles/vigas, holguras, etc.) son VALORES        │
 * │ ILUSTRATIVOS para la demo y deben reemplazarse por los de fábrica.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import type { AccessoryConfig, BeamProfile, PalletType, RackConfiguration, UprightProfile } from './types'

/** Datos publicados por la empresa (referencia, no certificación). */
export const OFFICIAL_REFERENCE = {
  source: 'https://sistemasdecargas.com.ar/rackselectivo/',
  /** "altura máxima de hasta 10 metros" */
  maxHeight: 10_000,
  /** "Admitiendo un peso para pallets de 1500 …" */
  maxPalletWeight: 1_500,
  /** "… y 3000 de carga por plano" */
  maxLevelLoad: 3_000,
} as const

export const CONTACT = {
  company: 'Sistemas de Carga S.A.',
  phone: '0810-220-2030',
  email: 'info@sistemasdecargas.com.ar',
  address: 'Rutherford 4669, Malvinas Argentinas, Buenos Aires',
} as const

/* ------------------------------------------------------------------------ */
/* Catálogo (ILUSTRATIVO)                                                   */
/* ------------------------------------------------------------------------ */

export const PALLET_TYPES: PalletType[] = [
  { id: 'arlog', name: 'Arlog 1000 × 1200', front: 1000, deep: 1200, height: 144 },
  { id: 'euro', name: 'Europeo 800 × 1200', front: 800, deep: 1200, height: 144 },
  { id: 'americano', name: 'Americano 1016 × 1219', front: 1016, deep: 1219, height: 150 },
  { id: 'industrial', name: 'Industrial 1200 × 1000', front: 1200, deep: 1000, height: 144 },
]

/** Parantes, de menor a mayor. El motor elige el primero que soporta la carga. */
export const UPRIGHT_PROFILES: UprightProfile[] = [
  { id: 'P80', name: 'Parante 80 × 70', faceWidth: 80, depth: 70, thickness: 2.5, maxFrameLoad: 9_000 },
  { id: 'P100', name: 'Parante 100 × 85', faceWidth: 100, depth: 85, thickness: 2.5, maxFrameLoad: 16_000 },
  { id: 'P120', name: 'Parante 120 × 95', faceWidth: 120, depth: 95, thickness: 3, maxFrameLoad: 24_000 },
]

/** Vigas caja, de menor a mayor. Capacidad por PAR de vigas (un plano de carga). */
export const BEAM_PROFILES: BeamProfile[] = [
  {
    id: 'V100', name: 'Viga caja 100 × 50', height: 100, depth: 50,
    capacityBySpan: [{ maxSpan: 1800, capacity: 2_600 }, { maxSpan: 2300, capacity: 2_000 }, { maxSpan: 2700, capacity: 1_600 }, { maxSpan: 3300, capacity: 1_200 }],
  },
  {
    id: 'V120', name: 'Viga caja 120 × 50', height: 120, depth: 50,
    capacityBySpan: [{ maxSpan: 1800, capacity: 3_400 }, { maxSpan: 2300, capacity: 3_000 }, { maxSpan: 2700, capacity: 2_500 }, { maxSpan: 3300, capacity: 2_000 }],
  },
  {
    id: 'V140', name: 'Viga caja 140 × 50', height: 140, depth: 50,
    capacityBySpan: [{ maxSpan: 1800, capacity: 4_500 }, { maxSpan: 2300, capacity: 3_800 }, { maxSpan: 2700, capacity: 3_200 }, { maxSpan: 3300, capacity: 2_700 }],
  },
  {
    id: 'V160', name: 'Viga caja 160 × 60', height: 160, depth: 60,
    capacityBySpan: [{ maxSpan: 1800, capacity: 5_500 }, { maxSpan: 2300, capacity: 4_800 }, { maxSpan: 2700, capacity: 4_000 }, { maxSpan: 3300, capacity: 3_400 }],
  },
]

/* ------------------------------------------------------------------------ */
/* Reglas de diseño (ILUSTRATIVAS)                                          */
/* ------------------------------------------------------------------------ */

export const DESIGN_RULES = {
  /** Holgura mínima entre pallets y entre pallet y parante. */
  minPalletGap: 75,
  /** Espacio libre mínimo sobre la carga hasta la viga siguiente. */
  minTopClearance: 100,
  /** Distancia del último larguero al tope del parante. */
  topMargin: 150,
  /** Si no se usa el piso, altura del primer larguero. */
  firstBeamWithoutFloor: 200,
  /** Los largueros se enganchan cada este paso (perforación del parante). */
  holePitch: 50,
  /** Altura máxima de carga dibujada sobre un pallet. */
  maxLoadHeight: 1_600,
  minLoadHeight: 250,
  /** Paso aproximado de las diagonales del bastidor. */
  diagonalPitch: 650,
  /** Separación entre filas espalda con espalda. */
  backToBackGap: 200,
  spacersPerFrame: 2,
  anchorBoltsPerPlate: 4,
  /** 'front' = un protector por parante del lado del pasillo. */
  protectorRule: 'front' as 'front' | 'ends' | 'none',
  beamsPerLevel: 2,
  /** Voladizo recomendado del pallet sobre cada viga (profundidad). */
  palletOverhang: { min: 0, max: 150 },
  limits: {
    width: { min: 1200, max: 3600 },
    depth: { min: 600, max: 1500 },
    height: { min: 1500, max: 12_000 },
    levels: { min: 1, max: 8 },
    positions: { min: 1, max: 600 },
    palletWeight: { min: 50, max: 4_000 },
    rows: { min: 1, max: 8 },
    aisleWidth: { min: 1500, max: 5000 },
    /** Tramos por fila y módulos por tramo. */
    sections: { min: 1, max: 12 },
    sectionModules: { min: 1, max: 40 },
    /** Pallet a medida. */
    palletFront: { min: 400, max: 2000 },
    palletDeep: { min: 400, max: 2000 },
    palletHeight: { min: 80, max: 300 },
  },
  /** Cruces de arriostramiento: una cada este número de módulos (mínimo una por fila). */
  modulesPerCrossBrace: 5,
  /** Travesaños de apoyo por posición de pallet. */
  supportsPerPallet: 2,
} as const

/** Accesorios con los que arranca una configuración nueva. */
export const DEFAULT_ACCESSORIES: AccessoryConfig = {
  protectors: 'all',
  guardrails: false,
  topTies: false,
  crossBracing: false,
  capacitySigns: false,
  decking: 'none',
  palletSupports: false,
}

/**
 * LISTA DE PRECIOS (vacía hasta que Sistemas de Carga cargue la suya).
 * Clave = código de la pieza en la lista de materiales (ver bom.ts), valor = precio unitario.
 * Ej.: { 'PROT-COL': 18500, 'PAS-SEG': 350 }. Si una pieza no tiene precio, el
 * cotizador muestra sólo la cantidad y no calcula el total.
 */
export const PRICE_LIST: Record<string, number> = {}

/* ------------------------------------------------------------------------ */
/* Geometría visual (tomada del modelo rack_selectivo.blend)                */
/* ------------------------------------------------------------------------ */

export const VISUAL = {
  holes: {
    pitch: 50,
    squareSide: 9,
    circleRadius: 6.5,
    /** Distancia del centro del círculo al centro de cada cuadrado. */
    squareOffset: 10,
    /** Distancia del eje del parante a cada columna de la cara frontal. */
    columnOffsetRatio: 0.28,
    startAt: 150,
    endMargin: 50,
  },
  groove: { halfWidth: 5, depth: 4 },
  lipRatio: 0.2,
  connectorHeight: 240,
  basePlate: { width: 150, depth: 130, thickness: 8 },
  protector: { height: 400, thickness: 5 },
  brace: { width: 50, thickness: 30 },
  guardrail: { height: 400, railHeight: 120, offset: 250 },
  sign: { width: 300, height: 200, elevation: 1500 },
  deck: { thickness: 25 },
} as const

export const DEFAULT_CONFIGURATION: RackConfiguration = {
  width: 2700,
  depth: 1100,
  height: 6000,
  levels: 3,
  positions: 18,
  floorStorage: true,
  palletTypeId: 'arlog',
  palletWeight: 1500,
  palletsPerModule: 'auto',
  layout: {
    rows: 1,
    aisleWidth: 3000,
    backToBack: false,
    warehouseLength: 0,
    warehouseWidth: 0,
  },
  sections: [],
  customPallet: { front: 1000, deep: 1200, height: 144 },
  uprightId: 'auto',
  beamId: 'auto',
  accessories: DEFAULT_ACCESSORIES,
}
