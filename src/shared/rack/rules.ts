/**
 * REGLAS MODULARES — cómo se cuentan y se arman las piezas.
 *
 * Toda la lógica de "cuántos bastidores / vigas / protectores lleva" está acá,
 * en un objeto que se le pasa a calculateRackStructure(). Para cambiar una regla
 * comercial o técnica se reemplaza la función correspondiente, sin tocar la UI
 * ni el motor 3D.
 *
 * Esquema de una fila:  BASTIDOR | MÓDULO | BASTIDOR | MÓDULO | BASTIDOR
 * Los módulos vecinos COMPARTEN el bastidor del medio.
 */
import { DESIGN_RULES } from './technicalSpecs'
import type { BeamProfile, PalletType, UprightProfile } from './types'

export interface StructuralRules {
  /** Bastidores de una fila con `modules` módulos. */
  framesPerRow(modules: number): number
  /** Vigas por nivel de carga de un módulo (frente + fondo). */
  beamsPerLevel(): number
  /** Pallets que entran a lo ancho de un módulo. */
  palletsPerModule(clearWidth: number, pallet: PalletType): number
  /** Módulos necesarios para alojar `positions` posiciones en una fila. */
  modulesForPositions(positions: number, palletsPerModule: number, storageLevels: number): number
  /** Diagonales de un bastidor según su altura. */
  diagonalsPerFrame(height: number): number
  /** Travesaños horizontales de un bastidor. */
  horizontalsPerFrame(height: number): number
  /** Protectores de una fila. */
  protectorsPerRow(framesPerRow: number): number
  /** Distanciadores entre dos filas espalda con espalda. */
  spacersPerPair(framesPerRow: number): number
  /** Elige la viga más liviana que soporta la carga del plano. */
  selectBeam(beams: BeamProfile[], span: number, levelLoad: number): { beam: BeamProfile; capacity: number; ok: boolean }
  /** Elige el parante más liviano que soporta la carga del bastidor. */
  selectUpright(uprights: UprightProfile[], frameLoad: number): { upright: UprightProfile; ok: boolean }
}

export function beamCapacityForSpan(beam: BeamProfile, span: number): number {
  return beam.capacityBySpan.find((c) => span <= c.maxSpan)?.capacity ?? 0
}

export const defaultRules: StructuralRules = {
  framesPerRow: (modules) => (modules > 0 ? modules + 1 : 0),

  beamsPerLevel: () => DESIGN_RULES.beamsPerLevel,

  palletsPerModule: (clearWidth, pallet) => {
    const gap = DESIGN_RULES.minPalletGap
    return Math.max(0, Math.floor((clearWidth - gap) / (pallet.front + gap)))
  },

  modulesForPositions: (positions, palletsPerModule, storageLevels) =>
    Math.max(1, Math.ceil(positions / Math.max(1, palletsPerModule * storageLevels))),

  diagonalsPerFrame: (height) => Math.max(2, Math.round((height - 300) / DESIGN_RULES.diagonalPitch)),

  horizontalsPerFrame: () => 2,

  protectorsPerRow: (framesPerRow) => {
    switch (DESIGN_RULES.protectorRule) {
      case 'front': return framesPerRow
      case 'ends': return Math.min(2, framesPerRow)
      default: return 0
    }
  },

  spacersPerPair: (framesPerRow) => framesPerRow * DESIGN_RULES.spacersPerFrame,

  selectBeam: (beams, span, levelLoad) => {
    for (const beam of beams) {
      const capacity = beamCapacityForSpan(beam, span)
      if (capacity >= levelLoad) return { beam, capacity, ok: true }
    }
    const beam = beams[beams.length - 1]
    return { beam, capacity: beamCapacityForSpan(beam, span), ok: false }
  },

  selectUpright: (uprights, frameLoad) => {
    const upright = uprights.find((u) => u.maxFrameLoad >= frameLoad)
    return upright ? { upright, ok: true } : { upright: uprights[uprights.length - 1], ok: false }
  },
}
