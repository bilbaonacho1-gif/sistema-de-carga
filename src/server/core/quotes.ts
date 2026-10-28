/**
 * Pedidos de presupuesto desde el Diseñador 3D. El servidor vuelve a calcular la
 * estructura con la configuración recibida (no confía en el resumen del navegador),
 * la guarda y avisa a los administradores; al responder, le avisa a quien lo pidió.
 */
import { calculateRackStructure } from '../../shared/rack/calculateRackStructure'
import { configFromInput, rackHeadline, rackSummaryText } from '../../shared/rack/summary'
import type { Quote } from '../../shared/types'
import { logActivity } from './activity'
import { conflict, firstName, notFound, requirePermission, type Ctx } from './context'
import { notifyRoles, notifyUsers } from './notifications'

const QUOTES_LINK = '/admin?tab=presupuestos'

export function createQuote(ctx: Ctx, input: { config: unknown; comments?: string }): Quote {
  requirePermission(ctx, 'disenador.usar')
  const s = calculateRackStructure(configFromInput(input.config))
  const headline = rackHeadline(s)
  const id = ctx.db.transaction(() => {
    const { lastInsertRowid } = ctx.db.run(
      `INSERT INTO quotes (user_id, company_id, config, summary, comments, status, created_at)
       VALUES (:me, :company, :config, :summary, :comments, 'nuevo', :now)`,
      { me: ctx.actor.id, company: ctx.actor.companyId, config: JSON.stringify(s.config), summary: rackSummaryText(s), comments: input.comments?.trim() ?? '', now: ctx.clock.now() },
    )
    logActivity(ctx, { type: 'presupuesto.solicitado', message: `${firstName(ctx.actor.name)} pidió presupuesto de un rack selectivo (${headline})` })
    notifyRoles(ctx, ['admin'], { type: 'presupuesto.nuevo', title: `Pedido de presupuesto de ${ctx.actor.name}`, body: headline, link: QUOTES_LINK })
    return lastInsertRowid
  })
  return getQuote(ctx, id)
}

interface QuoteRow {
  id: number; user_id: number; user_name: string; user_email: string; company_name: string; config: string; summary: string
  comments: string; status: Quote['status']; created_at: string; answered_at: string | null; answered_by_name: string | null
}

function listRaw(ctx: Ctx, where: string, params: Record<string, unknown>): Quote[] {
  return ctx.db.all<QuoteRow>(
    `SELECT q.id, q.user_id, u.name AS user_name, u.email AS user_email, c.name AS company_name, q.config, q.summary, q.comments,
            q.status, q.created_at, q.answered_at, a.name AS answered_by_name
       FROM quotes q
       JOIN users u ON u.id = q.user_id
       JOIN companies c ON c.id = q.company_id
       LEFT JOIN users a ON a.id = q.answered_by
      ${where}
      ORDER BY q.id DESC`,
    params,
  ).map((r) => {
    const config = JSON.parse(r.config)
    return {
      id: r.id, userId: r.user_id, userName: r.user_name, userEmail: r.user_email, companyName: r.company_name,
      config, summary: r.summary, headline: rackHeadline(calculateRackStructure(config)), comments: r.comments,
      status: r.status, createdAt: r.created_at, answeredAt: r.answered_at, answeredBy: r.answered_by_name,
    }
  })
}

function getQuote(ctx: Ctx, id: number): Quote {
  const q = listRaw(ctx, 'WHERE q.id = :id', { id })[0]
  if (!q) throw notFound('El pedido de presupuesto')
  return q
}

export function listQuotes(ctx: Ctx): Quote[] {
  requirePermission(ctx, 'usuarios.gestionar')
  return listRaw(ctx, '', {})
}

export function markQuoteAnswered(ctx: Ctx, id: number): Quote {
  requirePermission(ctx, 'usuarios.gestionar')
  const q = getQuote(ctx, id)
  if (q.status === 'respondido') throw conflict(`El presupuesto #${q.id} ya figura como respondido.`)
  ctx.db.transaction(() => {
    ctx.db.run("UPDATE quotes SET status = 'respondido', answered_at = :now, answered_by = :me WHERE id = :id", { id, me: ctx.actor.id, now: ctx.clock.now() })
    logActivity(ctx, { type: 'presupuesto.respondido', message: `${firstName(ctx.actor.name)} respondió el pedido de presupuesto de ${q.userName} (${q.companyName})` })
    notifyUsers(ctx, [q.userId], {
      type: 'presupuesto.respondido', title: 'Respondimos tu pedido de presupuesto',
      body: `${q.headline}. Te enviamos la propuesta a ${q.userEmail}.`, link: '/disenador',
    })
  })
  return getQuote(ctx, id)
}
