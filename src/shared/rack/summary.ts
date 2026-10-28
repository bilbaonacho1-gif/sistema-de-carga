/**
 * Resumen en texto de un rack calculado. Lo usan el Diseñador (vista previa) y el
 * servidor, que vuelve a calcular la estructura y guarda este texto en el presupuesto.
 */
import { DEFAULT_CONFIGURATION } from './technicalSpecs'
import type { RackConfiguration, RackStructure } from './types'

const n = (v: number) => v.toLocaleString('es-AR')

/** Completa una configuración recibida de afuera con los valores por defecto (después se sanea al calcular). */
export function configFromInput(input: unknown): RackConfiguration {
  const c = (input && typeof input === 'object' ? input : {}) as Partial<RackConfiguration>
  return { ...DEFAULT_CONFIGURATION, ...c, layout: { ...DEFAULT_CONFIGURATION.layout, ...c.layout } }
}

export function rackSummaryText(s: RackStructure): string {
  const tramos = s.sections.length > 1
    ? ['', 'TRAMOS', ...s.sections.map((t, i) => `Tramo ${i + 1}: ${n(t.modules)} módulos · viga ${n(t.width)} mm · ${n(t.height)} mm de alto · ${n(t.levels)} niveles`)]
    : []
  const materiales = ['', 'LISTA DE MATERIALES', ...s.materials.map((l) => `${n(l.qty)} × ${l.name}${l.detail ? ` (${l.detail})` : ''}`)]
  return [
    'CONFIGURACIÓN DE RACK SELECTIVO', '',
    `${n(s.positionsRequested)} posiciones`, `${n(s.storageLevels)} niveles`, `${n(s.palletsPerLevel)} pallets por nivel`,
    `Altura: ${n(s.config.height)} mm`, `Ancho: ${n(s.totalWidth)} mm`, `Profundidad: ${n(s.totalDepth)} mm`,
    `Pallet: ${s.pallet.name} · ${n(s.config.palletWeight)} kg`, `Filas: ${n(s.config.layout.rows)}${s.config.layout.backToBack ? ' (espalda con espalda)' : ''}`,
    `Componentes: ${s.upright.name} · ${s.beam.name}`,
    ...tramos,
    ...materiales,
  ].join('\n')
}

/** Una línea para listados y avisos: "120 posiciones · 4 niveles · 6.000 mm de alto". */
export function rackHeadline(s: RackStructure): string {
  return `${n(s.positionsRequested)} posiciones · ${n(s.storageLevels)} niveles · ${n(s.config.height)} mm de alto`
}
