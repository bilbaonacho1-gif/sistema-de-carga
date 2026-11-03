import type { RackConfiguration } from '../rack/types'

/**
 * PLANO DEL DEPÓSITO. Medidas en mm (al usuario se le muestran en metros). Ejes del plano: x hacia la derecha, y hacia abajo
 * (como se dibuja en pantalla); en el 3D, y del plano pasa a ser z.
 */

export interface PlanPoint { x: number; y: number }

/** Contorno cerrado: la pared i va del punto i al i+1 (la última vuelve al primero). */
export interface PlanOutline {
  points: PlanPoint[]
  /**
   * Flecha de cada pared en mm: 0 = recta; ≠ 0 = arco que pasa por los dos extremos y
   * se separa esa distancia del medio de la recta (positivo = hacia la izquierda de la pared).
   */
  sags: number[]
}

export interface PlanColumn {
  id: string
  x: number
  y: number
  shape: 'rect' | 'round'
  /** Ancho (o diámetro) y fondo. */
  w: number
  d: number
}

/** Pared o tabique interno, de a hasta b. */
export interface PlanWall {
  id: string
  a: PlanPoint
  b: PlanPoint
  thickness: number
}

/** Portón sobre una pared del contorno: `t` = posición del centro (0 a 1 a lo largo de la pared). */
export interface PlanDoor {
  id: string
  edge: number
  t: number
  width: number
  height: number
}

/** Zona que no se puede ocupar con racks (oficinas, carga y descarga…). */
export interface PlanZone {
  id: string
  x: number
  y: number
  w: number
  d: number
  name: string
}

/**
 * Un rack ubicado en el depósito: su configuración (la del cotizador) y dónde está.
 * (x, y) es el origen local del rack (frente izquierdo de la primera fila); rotation en grados.
 */
export interface PlanRack {
  id: string
  x: number
  y: number
  rotation: number
  config: RackConfiguration
}

export interface Plan {
  outline: PlanOutline
  wallHeight: number
  wallThickness: number
  columns: PlanColumn[]
  walls: PlanWall[]
  doors: PlanDoor[]
  zones: PlanZone[]
  /** Racks ubicados (opcional: los planos guardados antes no los tenían). */
  racks?: PlanRack[]
}

/** Lo que se puede seleccionar en el editor. */
export type PlanSelection =
  | { kind: 'vertex'; index: number }
  | { kind: 'edge'; index: number }
  | { kind: 'column'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'door'; id: string }
  | { kind: 'zone'; id: string }
  | { kind: 'rack'; id: string }
  | null
