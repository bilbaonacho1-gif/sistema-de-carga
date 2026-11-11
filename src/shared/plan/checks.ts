/**
 * REVISIÓN DEL PLANO: lo que un proyectista mira antes de mandar un plano. Cada punto dice qué pasa
 * en palabras simples y, si corresponde, qué elemento hay que tocar para arreglarlo.
 */
import { edges, outlinePolygon, outwardNormal, pointOnEdge, tangentOnEdge } from './geometry'
import { placementRect } from './layout'
import type { Plan, PlanSelection, RackPlacement } from './types'
import { metros } from '../units'

export type CheckLevel = 'error' | 'aviso' | 'consejo'
export interface PlanCheck { level: CheckLevel; text: string; target?: PlanSelection }

export interface CheckInput {
  /** Cada rack con su altura real (la propia o la de todo el depósito). */
  racks: { placement: RackPlacement; height: number }[]
  issues: Record<string, string>
  /** Ancho de pasillo entre filas elegido. */
  aisle: number
}

/** Espacio libre mínimo entre lo más alto del rack y el techo. */
export const ROOF_CLEARANCE = 300
/** Espacio libre delante de cada portón (para entrar y maniobrar). */
export const DOOR_CLEARANCE = 3000
/** Por debajo de este ancho, un pasillo es angosto para un autoelevador común. */
export const MIN_AISLE = 2500

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export function planChecks(plan: Plan, input: CheckInput): PlanCheck[] {
  if (plan.outline.points.length < 3) return []
  const out: PlanCheck[] = []
  const { racks, issues } = input

  const bad = Object.keys(issues)
  if (bad.length) out.push({ level: 'error', text: `${bad.length === 1 ? 'Hay 1 rack' : `Hay ${bad.length} racks`} con problemas: ${issues[bad[0]].toLowerCase()}${bad.length > 1 ? ', entre otros' : ''}.`, target: { kind: 'rack', id: bad[0] } })

  const tall = racks.filter((r) => r.height > plan.wallHeight - ROOF_CLEARANCE)
  if (tall.length) out.push({
    level: 'error',
    text: `${tall.length === 1 ? 'Un rack' : `${tall.length} racks`} de ${metros(tall[0].height)} no ${tall.length === 1 ? 'deja' : 'dejan'} ${metros(ROOF_CLEARANCE)} libres bajo el techo de ${metros(plan.wallHeight)}.`,
    target: { kind: 'rack', id: tall[0].placement.id },
  })

  if (racks.length && input.aisle < MIN_AISLE)
    out.push({ level: 'aviso', text: `Pasillos de ${metros(input.aisle)} entre filas: angostos para un autoelevador común (lo habitual es 3 m).` })
  for (const a of plan.aisles ?? []) {
    const w = Math.min(a.w, a.d)
    if (w < MIN_AISLE) out.push({ level: 'aviso', text: `Un pasillo marcado mide ${metros(w)} de ancho: angosto para un autoelevador común.`, target: { kind: 'aisle', id: a.id } })
  }

  // portones tapados: un rack dentro de los 3 m que hay delante, hacia adentro del depósito
  const poly = outlinePolygon(plan.outline, 200)
  const es = edges(plan.outline)
  for (const d of plan.doors) {
    const e = es[d.edge]
    if (!e) continue
    const c = pointOnEdge(e, d.t), t = tangentOnEdge(e, d.t), n = outwardNormal(e, poly)
    const pts = [-1, 1].flatMap((s) => [0, 1].map((k) => ({
      x: c.x + t.x * s * d.width / 2 - n.x * k * DOOR_CLEARANCE,
      y: c.y + t.y * s * d.width / 2 - n.y * k * DOOR_CLEARANCE,
    })))
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    const front = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    const blocker = racks.find((r) => overlap(placementRect(r.placement), front))
    if (blocker) out.push({ level: 'aviso', text: `Un rack queda a menos de ${metros(DOOR_CLEARANCE)} delante de un portón: lo tapa o no deja maniobrar.`, target: { kind: 'rack', id: blocker.placement.id } })
  }

  // consejos para que el plano esté completo
  if (!plan.doors.length) out.push({ level: 'consejo', text: 'Marcá los portones: así se revisa que ningún rack los tape.' })
  const has = (k: string) => (plan.symbols ?? []).some((s) => s.kind === k)
  if (racks.length && !has('salida')) out.push({ level: 'consejo', text: 'Marcá las salidas de emergencia (herramienta Símbolos).' })
  if (racks.length && !has('matafuego')) out.push({ level: 'consejo', text: 'Marcá dónde van los matafuegos (herramienta Símbolos).' })
  return out
}
