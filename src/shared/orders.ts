/**
 * Máquina de estados de los pedidos. La usa el servidor para validar cada cambio
 * y la interfaz para dibujar etiquetas, colores y la línea de tiempo.
 */
import type { OrderStatus, OrderType, Priority } from './types'

export const STATUS_META: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  solicitado: { label: 'Solicitado', color: '#4b5563', bg: '#eef0f3' },
  en_revision: { label: 'En revisión', color: '#6d4fb3', bg: '#f1ecfb' },
  aprobado: { label: 'Aprobado', color: '#1f5f8b', bg: '#e7f0f7' },
  en_preparacion: { label: 'En preparación', color: '#9a6400', bg: '#fdf2dc' },
  preparado: { label: 'Preparado', color: '#0f766e', bg: '#e1f4f1' },
  entregado: { label: 'Entregado', color: '#24733e', bg: '#e5f3e9' },
  recibido: { label: 'Recibido', color: '#24733e', bg: '#e5f3e9' },
  finalizado: { label: 'Finalizado', color: '#353535', bg: '#e9eaec' },
  cancelado: { label: 'Cancelado', color: '#b2182b', bg: '#fbe9eb' },
}

export const TYPE_LABEL: Record<OrderType, string> = {
  salida: 'Solicitud de material',
  reposicion: 'Reposición de stock',
}

export const PRIORITY_META: Record<Priority, { label: string; rank: number }> = {
  baja: { label: 'Baja', rank: 0 },
  normal: { label: 'Normal', rank: 1 },
  alta: { label: 'Alta', rank: 2 },
  urgente: { label: 'Urgente', rank: 3 },
}

/** Recorrido normal de cada tipo de pedido (para la línea de tiempo). */
export const FLOW: Record<OrderType, OrderStatus[]> = {
  salida: ['solicitado', 'en_revision', 'aprobado', 'en_preparacion', 'preparado', 'entregado', 'finalizado'],
  reposicion: ['solicitado', 'en_revision', 'aprobado', 'recibido', 'finalizado'],
}

/** Cambios de estado permitidos. Cualquier otro cambio se rechaza. */
export const TRANSITIONS: Record<OrderType, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  salida: {
    solicitado: ['en_revision', 'aprobado', 'cancelado'],
    en_revision: ['aprobado', 'cancelado'],
    aprobado: ['en_preparacion', 'cancelado'],
    en_preparacion: ['preparado', 'cancelado'],
    preparado: ['entregado', 'cancelado'],
    entregado: ['finalizado'],
  },
  reposicion: {
    solicitado: ['en_revision', 'aprobado', 'cancelado'],
    en_revision: ['aprobado', 'cancelado'],
    aprobado: ['recibido', 'cancelado'],
    recibido: ['finalizado'],
  },
}

export const CLOSED_STATUSES: OrderStatus[] = ['finalizado', 'cancelado']
export const ACTIVE_STATUSES: OrderStatus[] = (Object.keys(STATUS_META) as OrderStatus[]).filter((s) => !CLOSED_STATUSES.includes(s))

/** Estados en los que el pedido tiene stock reservado. */
export const RESERVING_STATUSES: OrderStatus[] = ['aprobado', 'en_preparacion', 'preparado']

export function canTransition(type: OrderType, from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[type][from]?.includes(to) ?? false
}

/** "#00482" */
export const orderNumber = (n: number) => `#${String(n).padStart(5, '0')}`
