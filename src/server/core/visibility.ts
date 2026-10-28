/** Qué pedidos puede ver cada perfil. Lo usan los pedidos, el historial y el tablero. */
import { hasPermission, type Ctx } from './context'

/** Filtro SQL sobre la tabla de pedidos (con el alias `o`). */
export function orderVisibility(ctx: Ctx): { sql: string; params: Record<string, unknown> } {
  if (hasPermission(ctx, 'pedidos.ver_todos')) return { sql: '1 = 1', params: {} }
  const parts: string[] = []
  const params: Record<string, unknown> = { me: ctx.actor.id, company: ctx.actor.companyId }
  // "sus pedidos": los materiales que pidió su empresa; las reposiciones internas del almacén
  // no le corresponden (salvo que las haya pedido él mismo)
  if (hasPermission(ctx, 'pedidos.ver_propios'))
    parts.push(`(o.company_id = :company AND (o.type = 'salida' OR o.requester_id = :me))`)
  if (hasPermission(ctx, 'pedidos.ver_asignados'))
    parts.push(`(o.assigned_to = :me OR (o.type = 'salida' AND o.status = 'aprobado' AND o.assigned_to IS NULL))`)
  return { sql: parts.length ? `(${parts.join(' OR ')})` : '0 = 1', params }
}
