/**
 * PLANO DEL DEPÓSITO. Medidas en mm. Ejes del plano: x hacia la derecha, y hacia abajo
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

export interface Plan {
  outline: PlanOutline
  wallHeight: number
  wallThickness: number
  columns: PlanColumn[]
  walls: PlanWall[]
  doors: PlanDoor[]
  zones: PlanZone[]
}

/** Lo que se puede seleccionar en el editor. */
export type PlanSelection =
  | { kind: 'vertex'; index: number }
  | { kind: 'edge'; index: number }
  | { kind: 'column'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'door'; id: string }
  | { kind: 'zone'; id: string }
  | null
