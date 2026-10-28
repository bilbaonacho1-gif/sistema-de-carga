/**
 * API REST. Usa sólo Request/Response estándar (Hono), así que la misma app corre:
 *  - en Node (src/server/node.ts) con la base en un archivo, para varios dispositivos;
 *  - dentro del navegador (src/server/browser.ts) para la demo autocontenida.
 *
 * Cada ruta: valida la entrada (zod) → arma el contexto con el usuario de la sesión →
 * llama al servicio, que es quien aplica permisos y reglas de negocio.
 */
import { Hono, type Context } from 'hono'
import { z, ZodError } from 'zod'
import { PERMISSIONS, ROLE_LABEL } from '../../shared/permissions'
import type { Role } from '../../shared/types'
import type { Db } from '../db/db'
import { listActivity } from '../core/activity'
import { login, logout, resolveSession, sessionFor } from '../core/auth'
import { AppError, hasPermission, systemClock, type Actor, type Clock, type Ctx } from '../core/context'
import { addCountLine, cancelCount, confirmCount, getCount, listCounts, setCountLine, startCount } from '../core/counts'
import { getDashboard } from '../core/dashboard'
import { manualMove, manualReceive } from '../core/inventory'
import { listNotifications, markNotificationsRead } from '../core/notifications'
import { addComment, createOrder, getOrder, listOrders, pickItem, receiveOrder, retryReservation, transitionOrder } from '../core/orders'
import {
  catalog, createProduct, getProduct, inventoryRows, listCategories, listMovements, listProducts, requestReplenishment, updateProduct,
} from '../core/products'
import { createQuote, listQuotes, markQuoteAnswered } from '../core/quotes'
import { permissionMatrix, resetRolePermissions, setRolePermissions } from '../core/roles'
import { createCompany, createUser, listCompanies, listUsers, updateUser } from '../core/users'
import {
  allPositions, createRack, deleteRack, getLocationDetail, getRack, getWarehouseMap, listSectors, listWarehouses, searchLocations,
} from '../core/warehouse'
import { DEMO_PASSWORD, DEMO_USERS } from '../seed'

type Env = { Variables: { actor: Actor; token: string } }

export interface AppOptions {
  db: Db
  clock?: Clock
  /** Muestra las cuentas de demostración en la pantalla de ingreso. */
  demo?: boolean
}

/* ------------------------------ Esquemas de entrada ------------------------------ */

const id = z.coerce.number().int().positive()
const role = z.enum(['admin', 'encargado', 'operario', 'cliente'])
const status = z.enum(['solicitado', 'en_revision', 'aprobado', 'en_preparacion', 'preparado', 'entregado', 'recibido', 'finalizado', 'cancelado'])

const S = {
  login: z.object({ email: z.string().min(3), password: z.string().min(1) }),
  user: z.object({
    name: z.string().min(1), email: z.string().email('Ingresá un email válido.'), role, companyId: id,
    sector: z.string().optional(), password: z.string().min(8, 'La contraseña tiene que tener al menos 8 caracteres.').optional(), active: z.boolean().optional(),
  }),
  company: z.object({ name: z.string().min(1), kind: z.enum(['interna', 'cliente']), sectors: z.array(z.string()) }),
  product: z.object({
    code: z.string(), name: z.string(), category: z.string(), unit: z.string(), minStock: z.number().int().min(0),
    description: z.string().optional(), active: z.boolean().optional(),
  }),
  order: z.object({
    type: z.enum(['salida', 'reposicion']),
    companyId: id.optional(),
    sector: z.string().default(''),
    requesterId: id.optional(),
    priority: z.enum(['baja', 'normal', 'alta', 'urgente']).default('normal'),
    neededBy: z.string().nullable().default(null),
    notes: z.string().default(''),
    items: z.array(z.object({ productId: id, quantity: z.number().int().positive('Las cantidades tienen que ser mayores a cero.'), notes: z.string().optional() })).min(1, 'Agregá al menos un producto al pedido.'),
  }),
  transition: z.object({ to: status, note: z.string().optional(), assigneeId: id.nullable().optional() }),
  pick: z.object({ picked: z.boolean() }),
  receive: z.object({ lines: z.array(z.object({ itemId: id, quantity: z.number().int().min(0), locationId: id })), note: z.string().optional() }),
  comment: z.object({ body: z.string().min(1, 'Escribí el comentario.') }),
  stockIn: z.object({ productId: id, locationId: id, quantity: z.number().int().positive(), note: z.string().optional() }),
  move: z.object({ inventoryId: id, toLocationId: id, quantity: z.number().int().positive(), note: z.string().optional() }),
  replenish: z.object({ quantity: z.number().int().positive().optional() }),
  rack: z.object({
    warehouseId: id, aisle: z.string().min(1), number: z.number().int().positive().optional(),
    config: z.record(z.string(), z.unknown()), x: z.number().int().optional(), y: z.number().int().optional(),
    facing: z.union([z.literal(1), z.literal(-1)]).optional(),
  }),
  count: z.object({ warehouseId: id, sector: z.string().min(1) }),
  countLine: z.object({ countedQty: z.number().int().min(0).nullable() }),
  countFound: z.object({ productId: id, locationId: id, countedQty: z.number().int().min(0) }),
  read: z.object({ ids: z.array(id).optional(), all: z.boolean().optional() }),
  rolePerms: z.object({ permissions: z.array(z.string()) }),
  quote: z.object({ config: z.record(z.string(), z.unknown()), comments: z.string().max(2000).optional() }),
}

/* ------------------------------ App ------------------------------ */

export function createApp({ db, clock = systemClock, demo = false }: AppOptions) {
  const app = new Hono<Env>().basePath('/api')

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status)
    if (err instanceof ZodError) {
      const first = err.issues[0]
      return c.json({ error: { code: 'invalid', message: first?.message ?? 'Datos inválidos.', field: first?.path.join('.') } }, 400)
    }
    if (err instanceof SyntaxError) return c.json({ error: { code: 'invalid', message: 'El cuerpo de la solicitud no es JSON válido.' } }, 400)
    console.error(err)
    return c.json({ error: { code: 'internal', message: 'Ocurrió un error inesperado en el servidor.' } }, 500)
  })

  /* ---- públicas ---- */
  app.get('/health', (c) => c.json({ ok: true, time: clock.now() }))

  app.get('/demo/users', (c) => {
    if (!demo) return c.json({ users: [], password: null })
    return c.json({ password: DEMO_PASSWORD, users: DEMO_USERS.map((u) => ({ name: u.name, email: u.email, role: u.role, roleLabel: ROLE_LABEL[u.role], sector: u.sector })) })
  })

  app.post('/auth/login', async (c) => {
    const { email, password } = S.login.parse(await c.req.json())
    return c.json(await login(db, clock, email, password))
  })

  /* ---- desde acá, con sesión ---- */
  app.use('*', async (c, next) => {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
    c.set('actor', resolveSession(db, clock, token))
    c.set('token', token!)
    await next()
  })

  const ctx = (c: Context<Env>): Ctx => ({ db, clock, actor: c.get('actor') })
  const body = async <T extends z.ZodType>(c: Context<Env>, schema: T): Promise<z.infer<T>> => schema.parse(await c.req.json())
  const param = (c: Context<Env>, name: string) => id.parse(c.req.param(name))
  const queryNum = (c: Context<Env>, name: string) => (c.req.query(name) ? id.parse(c.req.query(name)) : undefined)

  app.post('/auth/logout', (c) => { logout(db, c.get('token')); return c.json({ ok: true }) })
  app.get('/me', (c) => c.json(sessionFor(db, c.get('token'), c.get('actor').id)))
  app.get('/dashboard', (c) => c.json(getDashboard(ctx(c))))

  // notificaciones
  app.get('/notifications', (c) => c.json(listNotifications(ctx(c))))
  app.post('/notifications/read', async (c) => {
    const b = await body(c, S.read)
    markNotificationsRead(ctx(c), b.all ? 'all' : b.ids ?? [])
    return c.json(listNotifications(ctx(c)))
  })

  // usuarios, empresas y perfiles
  app.get('/users', (c) => c.json(listUsers(ctx(c), { role: c.req.query('role') as Role | undefined })))
  app.post('/users', async (c) => c.json(await createUser(ctx(c), await body(c, S.user)), 201))
  app.patch('/users/:id', async (c) => c.json(await updateUser(ctx(c), param(c, 'id'), await body(c, S.user.partial()))))
  app.get('/companies', (c) => c.json(listCompanies(ctx(c))))
  app.post('/companies', async (c) => c.json(createCompany(ctx(c), await body(c, S.company)), 201))
  app.get('/roles', (c) => c.json({ permissions: PERMISSIONS, roles: ROLE_LABEL, matrix: permissionMatrix(db) }))
  app.put('/roles/:role', async (c) => c.json({ permissions: PERMISSIONS, roles: ROLE_LABEL, matrix: setRolePermissions(ctx(c), role.parse(c.req.param('role')), (await body(c, S.rolePerms)).permissions) }))
  app.post('/roles/reset', (c) => c.json({ permissions: PERMISSIONS, roles: ROLE_LABEL, matrix: resetRolePermissions(ctx(c)) }))

  // productos e inventario
  app.get('/products', (c) => c.json(listProducts(ctx(c), {
    search: c.req.query('search'), category: c.req.query('category'),
    status: c.req.query('status') as never, includeInactive: c.req.query('inactive') === '1',
  })))
  app.get('/products/catalog', (c) => c.json(catalog(ctx(c))))
  app.get('/products/categories', (c) => c.json(listCategories(ctx(c))))
  app.get('/products/:id', (c) => c.json(getProduct(ctx(c), param(c, 'id'))))
  app.post('/products', async (c) => c.json(createProduct(ctx(c), await body(c, S.product)), 201))
  app.put('/products/:id', async (c) => c.json(updateProduct(ctx(c), param(c, 'id'), await body(c, S.product))))
  app.post('/products/:id/replenish', async (c) => c.json(requestReplenishment(ctx(c), param(c, 'id'), (await body(c, S.replenish)).quantity), 201))

  app.get('/inventory/staging', (c) => {
    // "Por ubicar": stock que está en zonas de piso (por ejemplo, Recepción)
    const x = ctx(c)
    const zoneIds = db.all<{ id: number }>("SELECT id FROM warehouse_locations WHERE kind = 'zona' AND active = 1").map((r) => r.id)
    if (!hasPermission(x, 'inventario.ver')) return c.json([])
    return c.json(inventoryRows(x, { locationIds: zoneIds }))
  })
  app.post('/inventory/receive', async (c) => { manualReceive(ctx(c), await body(c, S.stockIn)); return c.json({ ok: true }, 201) })
  app.post('/inventory/move', async (c) => { manualMove(ctx(c), await body(c, S.move)); return c.json({ ok: true }) })
  app.get('/movements', (c) => {
    const x = ctx(c)
    if (!hasPermission(x, 'inventario.ver')) return c.json([])
    return c.json(listMovements(x, { productId: queryNum(c, 'productId'), orderId: queryNum(c, 'orderId'), limit: queryNum(c, 'limit') }))
  })

  // almacén
  app.get('/warehouses', (c) => c.json(listWarehouses(ctx(c))))
  app.get('/warehouses/:id/map', (c) => c.json(getWarehouseMap(ctx(c), param(c, 'id'))))
  app.get('/warehouses/:id/positions', (c) => c.json(allPositions(ctx(c), param(c, 'id'))))
  app.get('/warehouses/:id/sectors', (c) => c.json(listSectors(ctx(c), param(c, 'id'))))
  app.get('/racks/:id', (c) => c.json(getRack(ctx(c), param(c, 'id'))))
  app.post('/racks', async (c) => {
    const b = await body(c, S.rack)
    return c.json(createRack(ctx(c), { ...b, config: b.config as never }), 201)
  })
  app.delete('/racks/:id', (c) => { deleteRack(ctx(c), param(c, 'id')); return c.json({ ok: true }) })
  app.get('/locations', (c) => c.json(searchLocations(ctx(c), { search: c.req.query('search'), freeOnly: c.req.query('free') === '1' })))
  app.get('/locations/:code', (c) => c.json(getLocationDetail(ctx(c), c.req.param('code'))))

  // pedidos
  app.get('/orders', (c) => c.json(listOrders(ctx(c), {
    status: c.req.query('status')?.split(',').filter(Boolean).map((s) => status.parse(s)),
    type: c.req.query('type') ? z.enum(['salida', 'reposicion']).parse(c.req.query('type')) : undefined,
    search: c.req.query('search') || undefined,
    assignedToMe: c.req.query('mine') === '1',
  })))
  app.get('/orders/:id', (c) => c.json(getOrder(ctx(c), param(c, 'id'))))
  app.post('/orders', async (c) => c.json(createOrder(ctx(c), await body(c, S.order)), 201))
  app.post('/orders/:id/transition', async (c) => c.json(transitionOrder(ctx(c), param(c, 'id'), await body(c, S.transition))))
  app.post('/orders/:id/items/:itemId/pick', async (c) => c.json(pickItem(ctx(c), param(c, 'id'), param(c, 'itemId'), (await body(c, S.pick)).picked)))
  app.post('/orders/:id/reserve', (c) => c.json(retryReservation(ctx(c), param(c, 'id'))))
  app.post('/orders/:id/receive', async (c) => c.json(receiveOrder(ctx(c), param(c, 'id'), await body(c, S.receive))))
  app.post('/orders/:id/comments', async (c) => c.json(addComment(ctx(c), param(c, 'id'), (await body(c, S.comment)).body), 201))

  // conteos
  app.get('/counts', (c) => c.json(listCounts(ctx(c))))
  app.post('/counts', async (c) => c.json(startCount(ctx(c), await body(c, S.count)), 201))
  app.get('/counts/:id', (c) => c.json(getCount(ctx(c), param(c, 'id'))))
  app.patch('/counts/:id/lines/:lineId', async (c) => c.json(setCountLine(ctx(c), param(c, 'id'), param(c, 'lineId'), (await body(c, S.countLine)).countedQty)))
  app.post('/counts/:id/lines', async (c) => c.json(addCountLine(ctx(c), param(c, 'id'), await body(c, S.countFound)), 201))
  app.post('/counts/:id/confirm', (c) => c.json(confirmCount(ctx(c), param(c, 'id'))))
  app.post('/counts/:id/cancel', (c) => c.json(cancelCount(ctx(c), param(c, 'id'))))

  // presupuestos del diseñador 3D
  app.get('/quotes', (c) => c.json(listQuotes(ctx(c))))
  app.post('/quotes', async (c) => {
    return c.json(createQuote(ctx(c), await body(c, S.quote)), 201)
  })
  app.post('/quotes/:id/answered', (c) => c.json(markQuoteAnswered(ctx(c), param(c, 'id'))))

  // historial
  app.get('/activity', (c) => c.json(listActivity(ctx(c), {
    from: c.req.query('from'), to: c.req.query('to'), userId: queryNum(c, 'userId'), productId: queryNum(c, 'productId'),
    type: c.req.query('type'), orderId: queryNum(c, 'orderId'), sector: c.req.query('sector'),
    limit: queryNum(c, 'limit'), before: queryNum(c, 'before'),
  })))

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Ruta inexistente.' } }, 404))
  return app
}

export type ApiApp = ReturnType<typeof createApp>
