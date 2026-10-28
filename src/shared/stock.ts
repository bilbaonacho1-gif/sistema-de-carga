/** Reglas de estado de stock, iguales en el servidor y en la interfaz. */
import type { PositionStatus, StockStatus } from './types'

export const STOCK_META: Record<StockStatus, { label: string; color: string; bg: string; dot: string }> = {
  disponible: { label: 'Disponible', color: '#24733e', bg: '#e5f3e9', dot: '#2e9e55' },
  stock_bajo: { label: 'Stock bajo', color: '#8a5a00', bg: '#fdf2dc', dot: '#e0a100' },
  sin_stock: { label: 'Sin stock', color: '#b2182b', bg: '#fbe9eb', dot: '#d32f2f' },
  reservado: { label: 'Reservado', color: '#1f5f8b', bg: '#e7f0f7', dot: '#2f80c0' },
}

export const POSITION_META: Record<PositionStatus, { label: string; fill: string; stroke: string }> = {
  libre: { label: 'Libre', fill: '#ffffff', stroke: '#c9cdd2' },
  disponible: { label: 'Ocupada', fill: '#2e9e55', stroke: '#24733e' },
  parcial: { label: 'Reserva parcial', fill: '#79b3dd', stroke: '#2f80c0' },
  reservado: { label: 'Reservada', fill: '#2f80c0', stroke: '#1f5f8b' },
}

/**
 * - Sin stock: no hay unidades.
 * - Reservado: hay unidades pero todas comprometidas en pedidos.
 * - Stock bajo: lo disponible quedó por debajo del mínimo.
 */
export function stockStatus(total: number, reserved: number, minStock: number): StockStatus {
  const available = total - reserved
  if (total <= 0) return 'sin_stock'
  if (available <= 0) return 'reservado'
  if (available < minStock) return 'stock_bajo'
  return 'disponible'
}

export function positionStatus(quantity: number, reserved: number): PositionStatus {
  if (quantity <= 0) return 'libre'
  if (reserved <= 0) return 'disponible'
  if (reserved >= quantity) return 'reservado'
  return 'parcial'
}

/** Cantidad sugerida para reponer: llevar lo disponible al doble del mínimo. */
export function suggestedReplenishment(available: number, minStock: number): number {
  return Math.max(minStock * 2 - Math.max(available, 0), minStock, 1)
}
