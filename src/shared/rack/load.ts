/**
 * CARGA DEL PALLET ARMADA CON CAJAS: con la medida de la caja se calcula cuántas entran por capa
 * sobre la tarima (probando la caja derecha y girada), cuántas capas hasta el alto máximo y el peso.
 */
import type { PalletType, RackConfiguration } from './types'

export interface LoadSpec {
  /** 'block': la carga es un bloque (como hasta ahora). 'boxes': cajas apiladas. */
  mode: 'block' | 'boxes'
  boxW: number
  boxD: number
  boxH: number
  /** Peso de cada caja (kg). */
  boxKg: number
  /** Alto máximo de la carga sobre la tarima (mm). */
  maxHeight: number
}

export const DEFAULT_LOAD: LoadSpec = { mode: 'block', boxW: 400, boxD: 300, boxH: 300, boxKg: 12, maxHeight: 1200 }
/** Peso de la tarima vacía (madera). */
export const PALLET_TARE = 25

export interface Stack {
  /** Cajas a lo ancho (frente del pallet) y a lo fondo, y si van giradas. */
  cols: number
  rows: number
  rotated: boolean
  perLayer: number
  layers: number
  total: number
  /** Medida de cada caja como queda apoyada (a lo ancho y a lo fondo del pallet). */
  w: number
  d: number
  /** Alto de la carga (mm) y su peso (kg, sin la tarima). */
  height: number
  weight: number
}

/** Cómo se apilan las cajas sobre la tarima (sin pasarse del borde ni del alto máximo). */
export function stackBoxes(pallet: { front: number; deep: number }, load: LoadSpec): Stack {
  const fit = (w: number, d: number) => ({ cols: Math.floor(pallet.front / w), rows: Math.floor(pallet.deep / d) })
  const a = fit(load.boxW, load.boxD), b = fit(load.boxD, load.boxW)
  const rotated = b.cols * b.rows > a.cols * a.rows
  const f = rotated ? b : a
  const perLayer = Math.max(0, f.cols * f.rows)
  const layers = load.boxH > 0 ? Math.max(0, Math.floor(load.maxHeight / load.boxH)) : 0
  const total = perLayer * layers
  return {
    cols: f.cols, rows: f.rows, rotated, perLayer, layers, total,
    w: rotated ? load.boxD : load.boxW, d: rotated ? load.boxW : load.boxD,
    height: layers * load.boxH, weight: Math.round(total * load.boxKg),
  }
}

/** La carga elegida en la configuración (o la de fábrica). */
export const loadOf = (c: RackConfiguration): LoadSpec => ({ ...DEFAULT_LOAD, ...c.load })

export type { PalletType }
