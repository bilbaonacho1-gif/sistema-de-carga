/**
 * Pedidos: SOLICITAR → REVISAR → APROBAR (reserva stock) → PREPARAR (checklist)
 *          → ENTREGAR (egreso) → FINALIZAR.   Reposición: … → RECIBIR (ingreso) → FINALIZAR.
 *
 * Cada cambio de estado se valida contra la máquina de estados (shared/orders.ts)
 * y contra los permisos del perfil, deja historial y avisa a quien corresponde.
 */
import { CLOSED_STATUSES, STATUS_META, TYPE_LABEL, canTransition, orderNumber } from '../../shared/orders'
import type {
  Comment, NewOrderInput, OrderAction, OrderDetail, OrderItem, OrderStatus, OrderSummary, OrderType, Priority, Role, StatusChange,
} from '../../shared/types'
import { logActivity } from './activity'
import { bool, conflict, firstName, forbidden, hasPermission, invalid, notFound, requirePermission, type Ctx } from './context'
import { addStock, consumeItem, getLocation, getProductRow, releaseItem, reserveItem } from './inventory'
import { notifyRoles, notifyUsers } from './notifications'
import { getCompany } from './users'
import { orderVisibility } from './visibility'

/* ------------------------------ Lectura ------------------------------ */

interface OrderRow {
  id: number; type: OrderType; status: OrderStatus; priority: Priority; company_id: number; company_name: string
  sector: string; requester_id: number; requester_name: string; created_by: number; created_by_name: string
  assigned_to: number | null; assigned_name: string | null; needed_by: string | null; notes: string
  created_at: string; updated_at: string; finalized_at: string | null
  item_count: number; total_units: number; picked_count: number; short_count: number
}

const ORDER_SELECT = `
  SELECT o.*, c.name AS company_name, r.name AS requester_name, cb.name AS created_by_name, a.name AS assigned_name,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
         (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS total_units,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.picked = 1) AS picked_count,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.reserved < oi.quantity) AS short_count
    FROM orders o
    JOIN companies c ON c.id = o.company_id
    JOIN users r ON r.id = o.requester_id
    JOIN users cb ON cb.id = o.created_by
    LEFT JOIN users a ON a.id = o.assigned_to`

const toSummary = (r: OrderRow): OrderSummary => ({
  id: r.id,
  number: orderNumber(r.id),
  type: r.type,
  status: r.status,
  priority: r.priority,
  companyId: r.company_id,
  companyName: r.company_name,
  sector: r.sector,
  requesterId: r.requester_id,
  requesterName: r.requester_name,
  assignedToId: r.assigned_to,
  assignedToName: r.assigned_name,
  neededBy: r.needed_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  itemCount: r.item_count,
  totalUnits: r.total_units,
  pickedCount: r.picked_count,
  // la falta de stock sólo importa mientras el pedido de salida tiene que reservar
  shortage: r.type === 'salida' && ['aprobado', 'en_preparacion'].includes(r.status) && r.short_count > 0,
})

function loadRow(ctx: Ctx, id: number): OrderRow {
  const v = orderVisibility(ctx)
  const r = ctx.db.get<OrderRow>(`${ORDER_SELECT} WHERE o.id = :id AND ${v.sql}`, { ...v.params, id })
  if (!r) throw notFound(`El pedido ${orderNumber(id)}`)
  return r
}

export interface OrderFilter {
  status?: OrderStatus[]
  type?: OrderType
  search?: string
  assignedToMe?: boolean
  limit?: number
}

export function listOrders(ctx: Ctx, f: OrderFilter = {}): OrderSummary[] {
  const v = orderVisibility(ctx)
  const where = [v.sql]
  const p: Record<string, unknown> = { ...v.params, limit: f.limit ?? 300 }
  if (f.status?.length) {
    where.push(`o.status IN (${f.status.map((_, i) => `:s${i}`).join(', ')})`)
    f.status.forEach((s, i) => (p[`s${i}`] = s))
  }
  if (f.type) { where.push('o.type = :type'); p.type = f.type }
  if (f.assignedToMe) { where.push('o.assigned_to = :me'); p.me = ctx.actor.id }
  if (f.search) {
    where.push(`(CAST(o.id AS TEXT) LIKE :q OR c.name LIKE :q OR o.sector LIKE :q OR r.name LIKE :q
                 OR EXISTS (SELECT 1 FROM order_items oi JOIN products pr ON pr.id = oi.product_id
                             WHERE oi.order_id = o.id AND (pr.name LIKE :q OR pr.code LIKE :q)))`)
    p.q = `%${f.search.replace(/^#0*/, '')}%`
  }
  return ctx.db
    .all<OrderRow>(`${ORDER_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT :limit`, p)
    .map(toSummary)
}

export function getOrder(ctx: Ctx, id: number): OrderDetail {
  const r = loadRow(ctx, id)
  const items = ctx.db.all<{
    id: number; product_id: number; code: string; name: string; unit: string; quantity: number; reserved: number
    received: number; picked: number; picked_name: string | null; picked_at: string | null; notes: string
  }>(
    `SELECT oi.id, oi.product_id, p.code, p.name, p.unit, oi.quantity, oi.reserved, oi.received, oi.picked,
            u.name AS picked_name, oi.picked_at, oi.notes
       FROM order_items oi JOIN products p ON p.id = oi.product_id LEFT JOIN users u ON u.id = oi.picked_by
      WHERE oi.order_id = :id ORDER BY oi.id`,
    { id },
  )
  const allocs = ctx.db.all<{ order_item_id: number; inventory_id: number; code: string; quantity: number }>(
    `SELECT a.order_item_id, a.inventory_id, l.code, a.quantity FROM order_allocations a
       JOIN order_items oi ON oi.id = a.order_item_id
       JOIN inventory i ON i.id = a.inventory_id
       JOIN warehouse_locations l ON l.id = i.location_id
      WHERE oi.order_id = :id ORDER BY l.code`,
    { id },
  )
  const history = ctx.db.all<{ id: number; from_status: OrderStatus | null; to_status: OrderStatus; name: string; note: string; created_at: string }>(
    `SELECT h.id, h.from_status, h.to_status, u.name, h.note, h.created_at FROM order_status_history h
       JOIN users u ON u.id = h.user_id WHERE h.order_id = :id ORDER BY h.id`,
    { id },
  )
  const comments = ctx.db.all<{ id: number; user_id: number; name: string; role: Role; body: string; created_at: string }>(
    `SELECT c.id, c.user_id, u.name, u.role, c.body, c.created_at FROM comments c
       JOIN users u ON u.id = c.user_id WHERE c.order_id = :id ORDER BY c.id`,
    { id },
  )
  const detail: OrderDetail = {
    ...toSummary(r),
    notes: r.notes,
    createdByName: r.created_by_name,
    finalizedAt: r.finalized_at,
    items: items.map<OrderItem>((i) => ({
      id: i.id, productId: i.product_id, productCode: i.code, productName: i.name, unit: i.unit,
      quantity: i.quantity, reserved: i.reserved, received: i.received, picked: bool(i.picked),
      pickedByName: i.picked_name, pickedAt: i.picked_at, notes: i.notes,
      allocations: allocs.filter((a) => a.order_item_id === i.id).map((a) => ({ inventoryId: a.inventory_id, locationCode: a.code, quantity: a.quantity })),
    })),
    history: history.map<StatusChange>((h) => ({ id: h.id, from: h.from_status, to: h.to_status, userName: h.name, note: h.note, createdAt: h.created_at })),
    comments: comments.map<Comment>((c) => ({ id: c.id, orderId: id, userId: c.user_id, userName: c.name, userRole: c.role, body: c.body, createdAt: c.created_at })),
    actions: [],
  }
  detail.actions = allowedActions(ctx, detail)
  return detail
}

/* ------------------------------ Reglas de acciones ------------------------------ */

const isOwnCompany = (ctx: Ctx, o: { companyId: number }) => o.companyId === ctx.actor.companyId

/** Qué puede hacer el usuario con este pedido ahora (la interfaz muestra sólo esto). */
export function allowedActions(ctx: Ctx, o: OrderDetail | OrderSummary & { items?: OrderItem[] }): OrderAction[] {
  const a: OrderAction[] = []
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(ctx, p)
  const t = (to: OrderStatus) => canTransition(o.type, o.status, to)
  const isAssignee = o.assignedToId === ctx.actor.id
  const operarioOk = ctx.actor.role !== 'operario' || isAssignee || o.assignedToId === null

  if (t('en_revision') && can('pedidos.revisar')) a.push('review')
  if (t('aprobado') && can('pedidos.revisar')) a.push('approve')
  if (t('en_preparacion') && can('pedidos.preparar') && operarioOk) a.push('start')
  if (o.status === 'en_preparacion' && can('pedidos.preparar') && operarioOk) a.push('pick')
  if (t('preparado') && can('pedidos.preparar') && operarioOk) a.push('prepared')
  if (t('entregado') && can('pedidos.entregar')) a.push('deliver')
  if (t('recibido') && can('pedidos.entregar')) a.push('receive')
  if (t('finalizado') && can('pedidos.finalizar') && (ctx.actor.role !== 'cliente' || isOwnCompany(ctx, o))) a.push('finalize')
  if (t('cancelado')) {
    const staff = can('pedidos.cancelar')
    const ownEarly = isOwnCompany(ctx, o) && can('pedidos.crear') && ['solicitado', 'en_revision'].includes(o.status)
    if (staff || ownEarly) a.push('cancel')
  }
  if (actionFitsState(o, 'reserve') && can('pedidos.revisar')) a.push('reserve')
  if (actionFitsState(o, 'comment') && can('pedidos.comentar')) a.push('comment')
  return a
}

const TARGET: Partial<Record<OrderAction, OrderStatus>> = {
  review: 'en_revision', approve: 'aprobado', start: 'en_preparacion', prepared: 'preparado',
  deliver: 'entregado', receive: 'recibido', finalize: 'finalizado', cancel: 'cancelado',
}

/** ¿La acción tiene sentido en el estado actual del pedido (sin mirar permisos)? */
function actionFitsState(o: OrderSummary, action: OrderAction): boolean {
  switch (action) {
    case 'pick': return o.status === 'en_preparacion'
    case 'reserve': return o.type === 'salida' && ['aprobado', 'en_preparacion'].includes(o.status) && o.shortage
    case 'comment': return !CLOSED_STATUSES.includes(o.status)
    default: return canTransition(o.type, o.status, TARGET[action]!)
  }
}

const VERBS: Record<OrderAction, string> = {
  review: 'pasar a revisión', approve: 'aprobar', start: 'comenzar la preparación de', prepared: 'marcar como preparado',
  deliver: 'registrar la entrega de', receive: 'registrar la recepción de', finalize: 'finalizar', cancel: 'cancelar',
  reserve: 'reservar stock para', pick: 'preparar productos de', comment: 'comentar en',
}

/** Rechaza la acción con un motivo claro: el estado no lo permite (409) o el perfil no puede (403). */
function assertAction(ctx: Ctx, o: OrderDetail, action: OrderAction): void {
  if (o.actions.includes(action)) return
  if (!actionFitsState(o, action)) {
    if (action === 'reserve') throw conflict(`El pedido ${o.number} no tiene faltantes para reservar.`)
    throw conflict(`No se puede ${VERBS[action]} el pedido ${o.number} en estado "${STATUS_META[o.status].label}".`)
  }
  throw forbidden(ctx.actor.role === 'operario' && o.assignedToId && o.assignedToId !== ctx.actor.id
    ? `El pedido ${o.number} está asignado a ${o.assignedToName}.`
    : undefined)
}

/* ------------------------------ Crear ------------------------------ */

export function createOrder(ctx: Ctx, input: NewOrderInput): OrderDetail {
  if (input.type === 'reposicion') requirePermission(ctx, 'inventario.reponer')
  else requirePermission(ctx, 'pedidos.crear')
  if (!input.items?.length) throw invalid('Agregá al menos un producto al pedido.')

  // un cliente siempre pide para su propia empresa y a su nombre
  const isClient = ctx.actor.role === 'cliente'
  const companyId = isClient || !input.companyId ? ctx.actor.companyId : input.companyId
  const company = getCompany(ctx.db, companyId)
  const requesterId = isClient || !input.requesterId ? ctx.actor.id : input.requesterId
  const requester = ctx.db.get<{ id: number; company_id: number }>('SELECT id, company_id FROM users WHERE id = :id AND active = 1', { id: requesterId })
  if (!requester) throw invalid('El solicitante no existe o está desactivado.')
  if (requester.company_id !== companyId) throw invalid('El solicitante no pertenece a esa empresa.')
  if (input.neededBy && Number.isNaN(Date.parse(input.neededBy))) throw invalid('La fecha necesaria no es válida.')

  // el mismo producto dos veces se suma en un solo renglón
  const merged = new Map<number, { productId: number; quantity: number; notes: string }>()
  for (const it of input.items) {
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) throw invalid('Las cantidades tienen que ser números enteros mayores a cero.')
    const p = getProductRow(ctx.db, it.productId)
    if (!p.active) throw invalid(`${p.name} está dado de baja.`)
    const prev = merged.get(it.productId)
    merged.set(it.productId, {
      productId: it.productId,
      quantity: (prev?.quantity ?? 0) + it.quantity,
      notes: [prev?.notes, it.notes?.trim()].filter(Boolean).join(' · '),
    })
  }

  const id = ctx.db.transaction(() => {
    const now = ctx.clock.now()
    const { lastInsertRowid: orderId } = ctx.db.run(
      `INSERT INTO orders (type, status, priority, company_id, sector, requester_id, created_by, needed_by, notes, created_at, updated_at)
       VALUES (:type, 'solicitado', :priority, :companyId, :sector, :requesterId, :me, :neededBy, :notes, :now, :now)`,
      {
        type: input.type, priority: input.priority ?? 'normal', companyId, sector: input.sector?.trim() ?? '',
        requesterId, me: ctx.actor.id, neededBy: input.neededBy || null, notes: input.notes?.trim() ?? '', now,
      },
    )
    for (const it of merged.values())
      ctx.db.run('INSERT INTO order_items (order_id, product_id, quantity, notes) VALUES (:orderId, :productId, :quantity, :notes)', { ...it, orderId })
    ctx.db.run(
      'INSERT INTO order_status_history (order_id, from_status, to_status, user_id, note, created_at) VALUES (:orderId, NULL, :s, :me, :note, :now)',
      { orderId, s: 'solicitado', me: ctx.actor.id, note: '', now },
    )
    const units = [...merged.values()].reduce((s, i) => s + i.quantity, 0)
    const from = [company.name, input.sector?.trim()].filter(Boolean).join(' · ')
    logActivity(ctx, {
      type: 'pedido.creado',
      message: `${firstName(ctx.actor.name)} creó el pedido ${orderNumber(orderId)} (${TYPE_LABEL[input.type].toLowerCase()}, ${units} u.) para ${from}`,
      orderId, sector: input.sector || null, quantity: units,
    })
    notifyRoles(ctx, ['admin', 'encargado'], {
      type: 'pedido.nuevo',
      title: `${input.type === 'reposicion' ? 'Reposición' : 'Nuevo pedido'} ${orderNumber(orderId)}`,
      body: `${from} · ${merged.size} producto${merged.size === 1 ? '' : 's'}, ${units} u.`,
      orderId,
    })
    return orderId
  })
  return getOrder(ctx, id)
}

/* ------------------------------ Cambios de estado ------------------------------ */

function setStatus(ctx: Ctx, o: OrderDetail, to: OrderStatus, note = ''): void {
  const now = ctx.clock.now()
  ctx.db.run(
    `UPDATE orders SET status = :to, updated_at = :now ${to === 'finalizado' ? ', finalized_at = :now' : ''} WHERE id = :id`,
    { id: o.id, to, now },
  )
  ctx.db.run(
    'INSERT INTO order_status_history (order_id, from_status, to_status, user_id, note, created_at) VALUES (:id, :from, :to, :me, :note, :now)',
    { id: o.id, from: o.status, to, me: ctx.actor.id, note, now },
  )
  logActivity(ctx, {
    type: 'pedido.estado',
    message: `${firstName(ctx.actor.name)} pasó el pedido ${o.number} a "${STATUS_META[to].label}"${note ? `: ${note}` : ''}`,
    orderId: o.id, sector: o.sector || null,
  })
}

export interface TransitionInput {
  to: OrderStatus
  note?: string
  /** Al aprobar: operario que lo va a preparar (opcional). */
  assigneeId?: number | null
}

export function transitionOrder(ctx: Ctx, id: number, input: TransitionInput): OrderDetail {
  const o = getOrder(ctx, id)
  const action: Partial<Record<OrderStatus, OrderAction>> = {
    en_revision: 'review', aprobado: 'approve', en_preparacion: 'start', preparado: 'prepared',
    entregado: 'deliver', finalizado: 'finalize', cancelado: 'cancel',
  }
  const act = action[input.to]
  if (!act) throw invalid(input.to === 'recibido' ? 'Para registrar la recepción usá "Recibir".' : 'Estado no válido.')
  assertAction(ctx, o, act)
  const note = input.note?.trim() ?? ''

  ctx.db.transaction(() => {
    switch (input.to) {
      case 'en_revision': {
        setStatus(ctx, o, 'en_revision', note)
        notifyUsers(ctx, [o.requesterId], { type: 'pedido.revision', title: `Pedido ${o.number} en revisión`, body: `${firstName(ctx.actor.name)} está revisando tu pedido.`, orderId: o.id })
        break
      }
      case 'aprobado': {
        let assignee: number | null = null
        if (input.assigneeId) {
          const op = ctx.db.get<{ id: number; role: Role }>('SELECT id, role FROM users WHERE id = :id AND active = 1', { id: input.assigneeId })
          if (!op || !['operario', 'encargado'].includes(op.role)) throw invalid('Elegí un operario o encargado activo para preparar el pedido.')
          assignee = op.id
          ctx.db.run('UPDATE orders SET assigned_to = :a WHERE id = :id', { a: assignee, id: o.id })
        }
        setStatus(ctx, o, 'aprobado', note)
        let shortage = false
        if (o.type === 'salida') {
          for (const item of o.items) {
            reserveItem(ctx, item.id)
            const after = ctx.db.get<{ reserved: number }>('SELECT reserved FROM order_items WHERE id = :id', { id: item.id })!
            if (after.reserved < item.quantity) shortage = true
          }
        }
        notifyUsers(ctx, [o.requesterId], {
          type: 'pedido.aprobado', title: `Pedido ${o.number} aprobado`,
          body: shortage ? 'Aprobado con faltantes: parte de la mercadería todavía no tiene stock.' : 'El stock quedó reservado para tu pedido.',
          orderId: o.id,
        })
        if (o.type === 'salida') {
          const to = assignee ? [assignee] : null
          const n = { type: 'pedido.para_preparar' as const, title: `Pedido ${o.number} listo para preparar`, body: `${o.itemCount} productos · ${o.totalUnits} u.`, orderId: o.id }
          if (to) notifyUsers(ctx, to, n)
          else notifyRoles(ctx, ['operario'], n)
        }
        break
      }
      case 'en_preparacion': {
        // quien empieza la preparación queda asignado si nadie lo estaba
        if (!o.assignedToId) ctx.db.run('UPDATE orders SET assigned_to = :me WHERE id = :id', { me: ctx.actor.id, id: o.id })
        setStatus(ctx, o, 'en_preparacion', note)
        logActivity(ctx, { type: 'pedido.preparacion', message: `${firstName(ctx.actor.name)} comenzó a preparar el pedido ${o.number}`, orderId: o.id })
        break
      }
      case 'preparado': {
        const pending = o.items.filter((i) => !i.picked)
        if (pending.length) throw conflict(`Faltan marcar ${pending.length} producto${pending.length === 1 ? '' : 's'} en el checklist.`)
        setStatus(ctx, o, 'preparado', note)
        notifyUsers(ctx, [o.requesterId], { type: 'pedido.preparado', title: `Pedido ${o.number} preparado`, body: 'Tu pedido está listo para entregar.', orderId: o.id })
        notifyRoles(ctx, ['encargado'], { type: 'pedido.preparado', title: `Pedido ${o.number} preparado`, body: `Preparado por ${ctx.actor.name}. Listo para entregar.`, orderId: o.id })
        break
      }
      case 'entregado': {
        for (const item of o.items) consumeItem(ctx, item.id)
        setStatus(ctx, o, 'entregado', note)
        notifyUsers(ctx, [o.requesterId], { type: 'pedido.entregado', title: `Pedido ${o.number} entregado`, body: 'Confirmá la recepción para finalizarlo.', orderId: o.id })
        break
      }
      case 'finalizado': {
        setStatus(ctx, o, 'finalizado', note)
        notifyUsers(ctx, [o.requesterId, o.assignedToId], { type: 'pedido.finalizado', title: `Pedido ${o.number} finalizado`, body: 'Quedó registrado en el historial.', orderId: o.id })
        notifyRoles(ctx, ['encargado'], { type: 'pedido.finalizado', title: `Pedido ${o.number} finalizado`, body: `Finalizado por ${ctx.actor.name}.`, orderId: o.id })
        break
      }
      case 'cancelado': {
        if (!note) throw invalid('Indicá el motivo de la cancelación.')
        for (const item of o.items) releaseItem(ctx, item.id, `Cancelación de ${o.number}`)
        setStatus(ctx, o, 'cancelado', note)
        notifyUsers(ctx, [o.requesterId, o.assignedToId], { type: 'pedido.cancelado', title: `Pedido ${o.number} cancelado`, body: note, orderId: o.id })
        notifyRoles(ctx, ['encargado'], { type: 'pedido.cancelado', title: `Pedido ${o.number} cancelado`, body: note, orderId: o.id })
        break
      }
    }
  })
  return getOrder(ctx, id)
}

/** Vuelve a intentar reservar lo que faltaba (por ejemplo, después de recibir una reposición). */
export function retryReservation(ctx: Ctx, id: number): OrderDetail {
  const o = getOrder(ctx, id)
  assertAction(ctx, o, 'reserve')
  ctx.db.transaction(() => {
    for (const item of o.items) if (item.reserved < item.quantity) reserveItem(ctx, item.id)
  })
  return getOrder(ctx, id)
}

/** Checklist de preparación: marcar o desmarcar un producto. */
export function pickItem(ctx: Ctx, id: number, itemId: number, picked: boolean): OrderDetail {
  const o = getOrder(ctx, id)
  assertAction(ctx, o, 'pick')
  const item = o.items.find((i) => i.id === itemId)
  if (!item) throw notFound('El producto del pedido')
  if (picked && item.reserved < item.quantity)
    throw conflict(`No se puede preparar ${item.productName}: faltan ${item.quantity - item.reserved} u. sin stock reservado.`)
  ctx.db.transaction(() => {
    ctx.db.run(
      'UPDATE order_items SET picked = :picked, picked_by = :by, picked_at = :at WHERE id = :itemId',
      { itemId, picked, by: picked ? ctx.actor.id : null, at: picked ? ctx.clock.now() : null },
    )
    logActivity(ctx, {
      type: 'pedido.preparacion',
      message: picked
        ? `${firstName(ctx.actor.name)} preparó ${item.quantity} × ${item.productName} del pedido ${o.number}`
        : `${firstName(ctx.actor.name)} desmarcó ${item.productName} en el pedido ${o.number}`,
      orderId: o.id, productId: item.productId, quantity: picked ? item.quantity : null,
    })
  })
  return getOrder(ctx, id)
}

/** Reposición: la mercadería llega y se guarda en las ubicaciones indicadas (ALMACENAR). */
export function receiveOrder(ctx: Ctx, id: number, input: { lines: { itemId: number; quantity: number; locationId: number }[]; note?: string }): OrderDetail {
  const o = getOrder(ctx, id)
  assertAction(ctx, o, 'receive')
  const lines = input.lines.filter((l) => l.quantity > 0)
  if (!lines.length) throw invalid('Indicá cuánto llegó de al menos un producto.')
  ctx.db.transaction(() => {
    for (const l of lines) {
      const item = o.items.find((i) => i.id === l.itemId)
      if (!item) throw notFound('El producto del pedido')
      const loc = getLocation(ctx.db, l.locationId)
      addStock(ctx, { productId: item.productId, locationId: loc.id, quantity: l.quantity, orderId: o.id, note: `Recepción ${o.number}` })
      ctx.db.run('UPDATE order_items SET received = received + :q WHERE id = :id', { q: l.quantity, id: item.id })
    }
    const total = lines.reduce((s, l) => s + l.quantity, 0)
    setStatus(ctx, o, 'recibido', input.note?.trim() || `Ingresaron ${total} u.`)
    notifyUsers(ctx, [o.requesterId], { type: 'pedido.recibido', title: `Reposición ${o.number} recibida`, body: `Ingresaron ${total} u. al almacén.`, orderId: o.id })
    notifyRoles(ctx, ['admin', 'encargado'], { type: 'pedido.recibido', title: `Reposición ${o.number} recibida`, body: `Ingresaron ${total} u. Revisá los pedidos con faltantes.`, orderId: o.id })
  })
  return getOrder(ctx, id)
}

/* ------------------------------ Comentarios ------------------------------ */

export function addComment(ctx: Ctx, id: number, body: string): OrderDetail {
  const o = getOrder(ctx, id)
  assertAction(ctx, o, 'comment')
  const text = body.trim()
  if (!text) throw invalid('Escribí el comentario.')
  if (text.length > 2000) throw invalid('El comentario es demasiado largo (máximo 2000 caracteres).')
  ctx.db.transaction(() => {
    ctx.db.run('INSERT INTO comments (order_id, user_id, body, created_at) VALUES (:id, :me, :body, :now)', { id, me: ctx.actor.id, body: text, now: ctx.clock.now() })
    logActivity(ctx, { type: 'pedido.comentario', message: `${firstName(ctx.actor.name)} comentó en ${o.number}: "${text.length > 80 ? `${text.slice(0, 77)}…` : text}"`, orderId: o.id })
    // participantes: solicitante, asignado y quienes ya comentaron; si comenta el cliente, también los encargados
    const commenters = o.comments.map((c) => c.userId)
    notifyUsers(ctx, [o.requesterId, o.assignedToId, ...commenters], {
      type: 'pedido.comentario', title: `${firstName(ctx.actor.name)} comentó en ${o.number}`, body: text, orderId: o.id,
    })
    if (ctx.actor.role === 'cliente') notifyRoles(ctx, ['encargado'], {
      type: 'pedido.comentario', title: `${firstName(ctx.actor.name)} comentó en ${o.number}`, body: text, orderId: o.id,
    })
  })
  return getOrder(ctx, id)
}
