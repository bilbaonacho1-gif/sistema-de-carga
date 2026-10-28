/**
 * Modelo de dominio del Rack Selectivo.
 * Todas las medidas en milímetros (mm) y los pesos en kilogramos (kg).
 *
 * Jerarquía: FILA → BASTIDOR | MÓDULO | BASTIDOR … → NIVEL → POSICIÓN → PALLET
 */

/** Lo que el usuario configura. */
export interface RackConfiguration {
  /** Luz libre del módulo = largo de la viga (entre parantes). */
  width: number
  /** Profundidad del bastidor. */
  depth: number
  /** Altura de los parantes. */
  height: number
  /** Niveles de almacenamiento (incluye el piso si floorStorage = true). */
  levels: number
  /** Posiciones de pallet que el cliente necesita. */
  positions: number
  /** Se usa el piso como primer nivel de almacenamiento. */
  floorStorage: boolean
  /** Tipo de pallet (id del catálogo). */
  palletTypeId: string
  /** Peso por pallet. */
  palletWeight: number
  /** 'auto' = el motor decide cuántos pallets entran por módulo. */
  palletsPerModule: number | 'auto'
  /** Distribución en el depósito. */
  layout: WarehouseLayout
  /**
   * Tramos con medidas propias (altura, largo de viga, niveles). Vacío = rack uniforme
   * con las medidas de arriba. Con tramos, width/height/levels reflejan el rack completo.
   */
  sections?: RackSection[]
  /** Medidas del pallet cuando palletTypeId = 'custom'. */
  customPallet?: { front: number; deep: number; height: number }
  /** Perfiles elegidos a mano. 'auto' = el motor elige el más liviano que alcanza. */
  uprightId?: string
  beamId?: string
  accessories?: Partial<AccessoryConfig>
}

/** Un tramo: varios módulos iguales dentro de la misma fila. */
export interface RackSection {
  modules: number
  /** Largo de viga (luz libre del módulo). */
  width: number
  /** Altura de los parantes del tramo. */
  height: number
  /** Niveles de almacenamiento del tramo (incluye el piso si floorStorage = true). */
  levels: number
}

export interface AccessoryConfig {
  /** Protectores de columna del lado del pasillo. */
  protectors: 'none' | 'ends' | 'all'
  /** Guardarraíles en las cabeceras de fila. */
  guardrails: boolean
  /** Conectores superiores que unen las filas por arriba. */
  topTies: boolean
  /** Cruces de arriostramiento en la cara posterior. */
  crossBracing: boolean
  /** Carteles de capacidad (uno por módulo). */
  capacitySigns: boolean
  /** Piso apoyado sobre las vigas de cada nivel. */
  decking: 'none' | 'wood' | 'mesh'
  /** Travesaños de apoyo de pallet (refuerzo entre vigas). */
  palletSupports: boolean
}

/** Una línea de la lista de materiales. */
export interface MaterialLine {
  code: string
  group: 'Estructura' | 'Fijación' | 'Accesorios'
  name: string
  detail?: string
  qty: number
  /** Precio unitario si está cargado en la lista de precios. */
  unitPrice?: number
}

export interface WarehouseLayout {
  /** Cantidad de filas de rack. */
  rows: number
  /** Ancho de pasillo entre filas. */
  aisleWidth: number
  /** Filas apareadas espalda con espalda (unidas con distanciadores). */
  backToBack: boolean
  /** Medidas del depósito (opcional, 0 = no se controla). */
  warehouseLength: number
  warehouseWidth: number
}

/* ---------- Catálogo técnico ---------- */

export interface PalletType {
  id: string
  name: string
  /** Lado que queda de frente al pasillo (a lo largo de la viga). */
  front: number
  /** Lado que apoya sobre las dos vigas (profundidad). */
  deep: number
  height: number
}

export interface UprightProfile {
  id: string
  name: string
  faceWidth: number
  depth: number
  thickness: number
  /** Carga máxima por bastidor (referencial). */
  maxFrameLoad: number
}

export interface BeamProfile {
  id: string
  name: string
  height: number
  depth: number
  /** Capacidad por par de vigas según la luz. Ordenado por maxSpan ascendente. */
  capacityBySpan: { maxSpan: number; capacity: number }[]
}

/* ---------- Resultado del motor ---------- */

export type Facing = 1 | -1

export interface FrameLayout {
  id: string
  row: number
  index: number
  /** Centro del bastidor a lo largo de la fila (eje X local de la fila). */
  x: number
  /** Altura del bastidor (la mayor de los dos módulos que sostiene). */
  height: number
}

export interface ModuleLayout {
  id: string
  row: number
  index: number
  /** Inicio de la luz libre (cara interna del parante izquierdo). */
  xStart: number
  xEnd: number
  /** Bastidores que lo limitan: comparte el derecho con el módulo siguiente. */
  leftFrame: number
  rightFrame: number
  /** Tramo al que pertenece y sus medidas. */
  section: number
  width: number
  height: number
  palletsPerModule: number
  levels: LevelLayout[]
  beam: BeamProfile
}

export interface LevelLayout {
  index: number
  /** Cota de apoyo del pallet (piso = 0, si no cara superior de la viga). */
  elevation: number
  hasBeam: boolean
  /** Altura libre disponible hasta la viga siguiente (o hasta el tope). */
  clearHeight: number
  /** Altura de la carga dibujada sobre el pallet. */
  loadHeight: number
}

export interface BeamLayout {
  id: string
  row: number
  module: number
  level: number
  side: 'front' | 'back'
  length: number
  elevation: number
}

export interface PositionSlot {
  id: string
  /** Orden de llenado (0 = primera posición). */
  order: number
  row: number
  module: number
  level: number
  slot: number
  /** Centro del pallet en X local de la fila. */
  x: number
  elevation: number
  occupied: boolean
}

export interface RowLayout {
  index: number
  /** Z de la cara frontal (la que da al pasillo). */
  zFront: number
  facing: Facing
  frames: FrameLayout[]
  modules: ModuleLayout[]
}

export type WarningLevel = 'info' | 'warning' | 'validation'

export interface RackWarning {
  code: string
  level: WarningLevel
  message: string
}

export interface ComponentCounts {
  frames: number
  uprights: number
  beams: number
  connectors: number
  safetyPins: number
  diagonals: number
  horizontals: number
  basePlates: number
  anchorBolts: number
  protectors: number
  spacers: number
  guardrails: number
  topTies: number
  crossBraces: number
  capacitySigns: number
  deckPanels: number
  palletSupports: number
}

export interface RackStructure {
  config: RackConfiguration
  pallet: PalletType
  upright: UprightProfile
  /** Viga del primer tramo (cada módulo lleva la suya en ModuleLayout.beam). */
  beam: BeamProfile
  /** Tramos resueltos (un rack uniforme tiene uno solo). */
  sections: RackSection[]
  accessories: AccessoryConfig

  rows: RowLayout[]
  frames: FrameLayout[]
  modules: ModuleLayout[]
  beams: BeamLayout[]
  levels: LevelLayout[]
  positions: PositionSlot[]
  pallets: PositionSlot[]

  modulesPerRow: number
  palletsPerModule: number
  palletsPerLevel: number
  storageLevels: number
  beamLevels: number
  positionsAvailable: number
  positionsRequested: number

  totalWidth: number
  totalDepth: number
  totalHeight: number
  /** Capacidad total = posiciones disponibles × peso por pallet. */
  totalCapacity: number
  /** Carga por nivel de un módulo (plano de carga). */
  levelLoad: number
  /** Carga sobre el bastidor más exigido. */
  maxFrameLoad: number
  /** Capacidad del par de vigas elegido para la luz configurada. */
  beamCapacity: number

  counts: ComponentCounts
  materials: MaterialLine[]
  warnings: RackWarning[]
}
