/**
 * Tipos compartidos entre el servidor (API + base de datos) y la interfaz.
 * Cantidades en unidades del producto, medidas en mm, fechas en ISO 8601.
 */
import type { RackConfiguration } from './rack/types'

/* ------------------------------ Usuarios ------------------------------ */

export type Role = 'admin' | 'encargado' | 'operario' | 'cliente'

export interface Company {
  id: number
  name: string
  kind: 'interna' | 'cliente'
  sectors: string[]
}

export interface User {
  id: number
  companyId: number
  companyName: string
  name: string
  email: string
  role: Role
  sector: string
  active: boolean
  createdAt: string
}

export interface Session {
  token: string
  user: User
  permissions: string[]
}

/* ------------------------------ Productos y stock ------------------------------ */

export type StockStatus = 'disponible' | 'stock_bajo' | 'sin_stock' | 'reservado'

export interface Product {
  id: number
  code: string
  name: string
  category: string
  unit: string
  minStock: number
  description: string
  active: boolean
  createdAt: string
}

export interface ProductStock extends Product {
  total: number
  reserved: number
  available: number
  status: StockStatus
  /** Cantidad de ubicaciones con stock. */
  locations: number
  /** Ubicación con más stock (para mostrar en listas). */
  mainLocation: string | null
  /** Pedido de reposición abierto para este producto, si existe. */
  replenishmentOrder: { id: number; number: string; quantity: number } | null
}

export interface InventoryRow {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  locationId: number
  locationCode: string
  locationKind: LocationKind
  sector: string
  quantity: number
  reserved: number
  available: number
  /** Pedidos que tienen reservado stock en esta fila. */
  orders: { orderId: number; number: string; quantity: number; status: OrderStatus }[]
}

export interface ProductDetail extends ProductStock {
  inventory: InventoryRow[]
  movements: Movement[]
  openOrders: OrderSummary[]
}

export type MovementType = 'ingreso' | 'egreso' | 'reserva' | 'liberacion' | 'traslado' | 'ajuste'

export interface Movement {
  id: number
  type: MovementType
  productId: number
  productCode: string
  productName: string
  fromLocation: string | null
  toLocation: string | null
  quantity: number
  orderId: number | null
  orderNumber: string | null
  countId: number | null
  userId: number
  userName: string
  note: string
  createdAt: string
}

/* ------------------------------ Almacén ------------------------------ */

export type LocationKind = 'rack' | 'zona'
export type PositionStatus = 'libre' | 'disponible' | 'parcial' | 'reservado'

export interface Warehouse {
  id: number
  name: string
  address: string
  lengthMm: number
  widthMm: number
}

export interface Zone {
  id: number
  code: string
  name: string
  /** Rectángulo en planta (mm). */
  x: number
  y: number
  w: number
  h: number
  units: number
}

export interface Location {
  id: number
  warehouseId: number
  code: string
  kind: LocationKind
  name: string
  sector: string
}

export interface RackSummary {
  id: number
  warehouseId: number
  code: string
  aisle: string
  number: number
  /** Esquina frontal izquierda en planta (mm) y hacia dónde mira el frente. */
  x: number
  y: number
  facing: 1 | -1
  lengthMm: number
  depthMm: number
  heightMm: number
  modules: number
  levels: number
  slotsPerModule: number
  config: RackConfiguration
  positions: number
  occupied: number
  reserved: number
  units: number
}

export interface PositionContent {
  inventoryId: number
  productId: number
  productCode: string
  productName: string
  unit: string
  quantity: number
  reserved: number
  available: number
  orders: { orderId: number; number: string; quantity: number; status: OrderStatus }[]
}

export interface RackPosition {
  id: number
  rackId: number
  rackCode: string
  locationId: number
  code: string
  module: number
  level: number
  slot: number
  status: PositionStatus
  contents: PositionContent[]
}

export interface RackDetail extends RackSummary {
  positionsList: RackPosition[]
}

export interface WarehouseMap {
  warehouse: Warehouse
  zones: Zone[]
  racks: RackSummary[]
  aisles: { aisle: string; racks: number; positions: number; occupied: number }[]
  totals: { positions: number; occupied: number; reserved: number; units: number }
}

export interface LocationDetail {
  location: Location
  position: RackPosition | null
  rack: RackSummary | null
  contents: PositionContent[]
  status: PositionStatus
}

/* ------------------------------ Pedidos ------------------------------ */

export type OrderType = 'salida' | 'reposicion'
export type OrderStatus =
  | 'solicitado' | 'en_revision' | 'aprobado' | 'en_preparacion' | 'preparado'
  | 'entregado' | 'recibido' | 'finalizado' | 'cancelado'
export type Priority = 'baja' | 'normal' | 'alta' | 'urgente'
export type OrderAction =
  | 'review' | 'approve' | 'start' | 'prepared' | 'deliver' | 'receive'
  | 'finalize' | 'cancel' | 'reserve' | 'pick' | 'comment'

export interface OrderSummary {
  id: number
  number: string
  type: OrderType
  status: OrderStatus
  priority: Priority
  companyId: number
  companyName: string
  sector: string
  requesterId: number
  requesterName: string
  assignedToId: number | null
  assignedToName: string | null
  neededBy: string | null
  createdAt: string
  updatedAt: string
  itemCount: number
  totalUnits: number
  pickedCount: number
  /** Algún renglón no tiene todo el stock reservado. */
  shortage: boolean
}

export interface OrderAllocation {
  inventoryId: number
  locationCode: string
  quantity: number
}

export interface OrderItem {
  id: number
  productId: number
  productCode: string
  productName: string
  unit: string
  quantity: number
  reserved: number
  received: number
  picked: boolean
  pickedByName: string | null
  pickedAt: string | null
  notes: string
  allocations: OrderAllocation[]
}

export interface StatusChange {
  id: number
  from: OrderStatus | null
  to: OrderStatus
  userName: string
  note: string
  createdAt: string
}

export interface Comment {
  id: number
  orderId: number
  userId: number
  userName: string
  userRole: Role
  body: string
  createdAt: string
}

export interface OrderDetail extends OrderSummary {
  notes: string
  createdByName: string
  finalizedAt: string | null
  items: OrderItem[]
  history: StatusChange[]
  comments: Comment[]
  /** Acciones que el usuario actual puede hacer ahora mismo. */
  actions: OrderAction[]
}

export interface NewOrderInput {
  type: OrderType
  companyId?: number
  sector: string
  requesterId?: number
  priority: Priority
  neededBy: string | null
  notes: string
  items: { productId: number; quantity: number; notes?: string }[]
}

/* ------------------------------ Control ------------------------------ */

export type CountStatus = 'en_curso' | 'confirmado' | 'cancelado'

export interface CountLine {
  id: number
  inventoryId: number | null
  productId: number
  productCode: string
  productName: string
  unit: string
  locationCode: string
  systemQty: number
  countedQty: number | null
  /** Stock del sistema contra el que se compara: el actual mientras el conteo está abierto, el que había al cerrarlo después. */
  currentQty: number
}

export interface InventoryCount {
  id: number
  warehouseId: number
  sector: string
  status: CountStatus
  startedById: number
  startedByName: string
  startedAt: string
  confirmedByName: string | null
  confirmedAt: string | null
  summary: { lines: number; counted: number; differences: number; plus: number; minus: number }
}

export interface InventoryCountDetail extends InventoryCount {
  lines: CountLine[]
}

export type ActivityType =
  | 'pedido.creado' | 'pedido.estado' | 'pedido.comentario' | 'pedido.preparacion'
  | 'stock.ingreso' | 'stock.egreso' | 'stock.reserva' | 'stock.liberacion' | 'stock.traslado' | 'stock.ajuste'
  | 'conteo.iniciado' | 'conteo.confirmado' | 'conteo.cancelado'
  | 'producto.creado' | 'producto.editado' | 'rack.creado' | 'rack.eliminado'
  | 'usuario.creado' | 'usuario.editado' | 'presupuesto.solicitado' | 'presupuesto.respondido'

export interface Activity {
  id: number
  type: ActivityType
  message: string
  userId: number | null
  userName: string | null
  orderId: number | null
  orderNumber: string | null
  productId: number | null
  productName: string | null
  locationCode: string | null
  sector: string | null
  quantity: number | null
  createdAt: string
}

export interface ActivityFilter {
  from?: string
  to?: string
  userId?: number
  productId?: number
  type?: string
  orderId?: number
  sector?: string
  limit?: number
  before?: number
}

export type NotificationType =
  | 'pedido.nuevo' | 'pedido.revision' | 'pedido.aprobado' | 'pedido.para_preparar' | 'pedido.preparado'
  | 'pedido.entregado' | 'pedido.recibido' | 'pedido.finalizado' | 'pedido.cancelado' | 'pedido.comentario'
  | 'stock.bajo' | 'stock.sin_stock' | 'conteo.diferencias' | 'presupuesto.nuevo' | 'presupuesto.respondido'

export interface Notification {
  id: number
  type: NotificationType
  title: string
  body: string
  orderId: number | null
  productId: number | null
  /** Pantalla a la que lleva (también sirve como destino de una notificación push). */
  link: string | null
  readAt: string | null
  createdAt: string
}

export interface Task {
  kind: 'revisar' | 'aprobar' | 'preparar' | 'entregar' | 'recibir' | 'finalizar' | 'reponer' | 'conteo'
  title: string
  detail: string
  orderId?: number
  productId?: number
  countId?: number
}

export interface DashboardData {
  kpis: {
    products: number
    lowStock: number
    outOfStock: number
    activeOrders: number
    inPreparation: number
    prepared: number
    finalized: number
    positions: number
    occupiedPositions: number
  }
  /** Pedidos por estado (para la tira del flujo). */
  flow: Record<OrderStatus, number>
  recent: Activity[]
  tasks: Task[]
}

/* ------------------------------ Presupuestos ------------------------------ */

export type QuoteStatus = 'nuevo' | 'respondido'

/** Pedido de presupuesto armado en el Diseñador 3D. */
export interface Quote {
  id: number
  userId: number
  userName: string
  userEmail: string
  companyName: string
  /** Configuración ya saneada por el servidor (se puede volver a abrir en el Diseñador). */
  config: RackConfiguration
  summary: string
  headline: string
  comments: string
  status: QuoteStatus
  createdAt: string
  answeredAt: string | null
  answeredBy: string | null
}
