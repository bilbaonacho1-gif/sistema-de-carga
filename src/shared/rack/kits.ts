/**
 * MÓDULO INICIAL Y MÓDULO ADICIONAL. Una fila de rack se arma con un módulo inicial (dos pórticos
 * y sus vigas: se sostiene solo) y módulos adicionales (un pórtico y sus vigas: se enganchan al
 * anterior y comparten su pórtico). Acá se saca qué piezas lleva cada uno.
 */
import { calculateRackStructure } from './calculateRackStructure'
import type { MaterialLine, RackConfiguration } from './types'

export interface ModuleKits {
  /** Piezas del módulo inicial. */
  initial: MaterialLine[]
  /** Piezas que suma cada módulo adicional. */
  extra: MaterialLine[]
}

/** Una fila simple de `modules` módulos con esta configuración. */
function row(config: RackConfiguration, modules: number) {
  const one = calculateRackStructure({ ...config, sections: [], positions: 1, layout: { ...config.layout, rows: 1, backToBack: false } })
  return calculateRackStructure({
    ...one.config, sections: [], positions: one.palletsPerModule * one.storageLevels * modules,
    layout: { ...one.config.layout, rows: 1, backToBack: false },
  })
}

/**
 * Qué lleva el módulo inicial y qué suma cada adicional: el inicial es una fila de un módulo; el
 * adicional es lo que hay de más en una fila de dos. Lo que va una vez por fila (protectores de
 * punta, defensas, carteles de fila) queda en el inicial.
 */
export function moduleKits(config: RackConfiguration): ModuleKits {
  const initial = row(config, 1).materials
  const base = new Map(initial.map((l) => [l.code, l.qty]))
  const extra = row(config, 2).materials
    .map((l) => ({ ...l, qty: l.qty - (base.get(l.code) ?? 0) }))
    .filter((l) => l.qty > 0)
  return { initial, extra }
}

/** Cuántos módulos iniciales y adicionales hay en `rows` filas con `modules` módulos en total. */
export function moduleSplit(rows: number, modules: number): { initial: number; extra: number } {
  const initial = Math.min(rows, modules)
  return { initial, extra: Math.max(0, modules - initial) }
}
