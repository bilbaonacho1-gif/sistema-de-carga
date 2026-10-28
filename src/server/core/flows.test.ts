/**
 * Pruebas de los flujos de negocio contra una base SQLite real (en memoria),
 * cargada con los mismos datos de demostración.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIGURATION, DESIGN_RULES } from '../../shared/rack/technicalSpecs'
import { createApp } from '../api/app'
import { bootstrap } from '../bootstrap'
import { NodeSqliteDb } from '../db/nodeSqlite'
import { migrate } from '../db/schema'
import { seed } from '../seed'
import { login } from './auth'
import type { Actor, Ctx } from './context'
import { confirmCount, getCount, listCounts, setCountLine, startCount } from './counts'
import { manualMove } from './inventory'
import { checkInvariants } from './inventory'
import { actorFor } from './roles'
import { listActivity } from './activity'
import { listNotifications } from './notifications'
import { addComment, createOrder, getOrder, listOrders, pickItem, receiveOrder, retryReservation, transitionOrder } from './orders'
import { getProduct, listProducts, requestReplenishment } from './products'
import { createQuote, listQuotes, markQuoteAnswered } from './quotes'
import { createRack, getLocationDetail } from './warehouse'

let db: NodeSqliteDb
const clock = { now: () => new Date().toISOString() }
const actors = new Map<string, Actor>()
const as = (who: string): Ctx => ({ db, clock, actor: actors.get(who)! })
const pid = (code: string) => db.get<{ id: number }>('SELECT id FROM products WHERE code = :code', { code })!.id
const stock = (code: string) => listProducts(as('lucia')).find((p) => p.code === code)!

beforeEach(async () => {
  db = new NodeSqliteDb(':memory:')
  migrate(db)
  await seed(db, { now: new Date('2026-10-03T12:00:00') })
  for (const u of db.all<{ id: number; email: string; name: string; role: Actor['role']; company_id: number }>('SELECT * FROM users'))
    actors.set(u.email.split('@')[0], actorFor(db, { id: u.id, name: u.name, role: u.role, companyId: u.company_id }))
})

describe('datos de demostración', () => {
  it('cierran: las reservas coinciden con el stock', () => {
    expect(checkInvariants(db)).toEqual([])
  })

  it('el pedido #00482 está en preparación con 2 protectores faltantes', () => {
    const o = getOrder(as('martin'), 482)
    expect(o.status).toBe('en_preparacion')
    expect(o.requesterName).toBe('Juan Pérez')
    const prot = o.items.find((i) => i.productCode === 'PRO-COL')!
    expect(prot.quantity - prot.reserved).toBe(2)
    expect(o.items.filter((i) => i.picked).map((i) => i.productCode).sort()).toEqual(['PAR-80-6000', 'VIG-140-2700'])
    expect(o.comments.map((c) => c.body)).toEqual(['Faltan 2 protectores.', 'Llegan mañana.', 'Perfecto.'])
  })

  it('la viga quedó reservada en A-04-03-02 para el #00482 (mejor ajuste)', () => {
    const loc = getLocationDetail(as('martin'), 'A-04-03-02')
    expect(loc.status).toBe('reservado')
    expect(loc.contents[0]).toMatchObject({ productCode: 'VIG-140-2700', quantity: 12, reserved: 12 })
    expect(loc.contents[0].orders[0].number).toBe('#00482')
    expect(stock('VIG-140-2700')).toMatchObject({ total: 42, reserved: 12, available: 30 })
  })
})

describe('flujo completo de un pedido', () => {
  it('SOLICITAR → APROBAR → PREPARAR → ENTREGAR → FINALIZAR mueve el stock y deja historial', () => {
    const before = stock('PAL-ARLOG')
    const o = createOrder(as('carolina'), {
      type: 'salida', sector: 'Depósito Central', priority: 'alta', neededBy: null, notes: '',
      items: [{ productId: pid('PAL-ARLOG'), quantity: 5 }],
    })
    expect(o.status).toBe('solicitado')
    // los encargados se enteran
    expect(listNotifications(as('martin')).items[0].title).toContain(o.number)

    transitionOrder(as('martin'), o.id, { to: 'en_revision' })
    transitionOrder(as('martin'), o.id, { to: 'aprobado', assigneeId: actors.get('ana')!.id })
    expect(stock('PAL-ARLOG')).toMatchObject({ total: before.total, reserved: before.reserved + 5, available: before.available - 5 })

    let d = transitionOrder(as('ana'), o.id, { to: 'en_preparacion' })
    expect(() => transitionOrder(as('ana'), o.id, { to: 'preparado' })).toThrow(/checklist/)
    d = pickItem(as('ana'), o.id, d.items[0].id, true)
    d = transitionOrder(as('ana'), o.id, { to: 'preparado' })
    expect(d.status).toBe('preparado')

    transitionOrder(as('martin'), o.id, { to: 'entregado' })
    expect(stock('PAL-ARLOG')).toMatchObject({ total: before.total - 5, reserved: before.reserved, available: before.available - 5 })

    d = transitionOrder(as('carolina'), o.id, { to: 'finalizado' })
    expect(d.status).toBe('finalizado')
    expect(d.history.map((h) => h.to)).toEqual(['solicitado', 'en_revision', 'aprobado', 'en_preparacion', 'preparado', 'entregado', 'finalizado'])
    expect(checkInvariants(db)).toEqual([])
  })

  it('cancelar libera lo reservado y exige motivo', () => {
    const before = stock('TRA-1100')
    expect(() => transitionOrder(as('martin'), 477, { to: 'cancelado' })).toThrow(/motivo/)
    transitionOrder(as('martin'), 477, { to: 'cancelado', note: 'El cliente lo pidió.' })
    const after = stock('TRA-1100')
    expect(after.reserved).toBe(before.reserved - 10)
    expect(after.total).toBe(before.total)
    expect(checkInvariants(db)).toEqual([])
  })

  it('no permite saltar estados', () => {
    expect(() => transitionOrder(as('martin'), 480, { to: 'entregado' })).toThrow(/No se puede/)
  })
})

describe('perfiles', () => {
  it('un operario no puede aprobar', () => {
    expect(() => transitionOrder(as('diego'), 481, { to: 'aprobado' })).toThrow()
  })

  it('un cliente sólo ve los pedidos de su empresa', () => {
    const carolina = listOrders(as('carolina'))
    expect(carolina.length).toBeGreaterThan(0)
    expect(carolina.every((o) => o.companyName === 'Logística Andina S.A.')).toBe(true)
    expect(() => getOrder(as('carolina'), 482)).toThrow(/no existe/)
  })

  it('un sector interno con perfil cliente no ve las reposiciones del almacén (ni en el historial)', () => {
    const juan = listOrders(as('juan')).map((o) => o.number)
    expect(juan).toContain('#00482')
    expect(juan).not.toContain('#00483')
    expect(juan).not.toContain('#00484')
    expect(() => getOrder(as('juan'), 483)).toThrow(/no existe/)
    const history = listActivity(as('juan'), { limit: 500 })
    expect(history.some((a) => a.orderNumber === '#00482')).toBe(true)
    expect(history.some((a) => a.orderNumber === '#00483' || a.orderId === null)).toBe(false)
  })

  it('un operario sólo ve los pedidos asignados a él (o sin asignar listos para preparar)', () => {
    expect(listOrders(as('ana')).every((o) => o.assignedToName === 'Ana Torres' || (o.status === 'aprobado' && !o.assignedToId))).toBe(true)
    expect(() => pickItem(as('ana'), 482, getOrder(as('martin'), 482).items[2].id, true)).toThrow(/no existe/)
  })
})

describe('faltantes y reposición', () => {
  it('RECIBIR la reposición y reintentar la reserva completa el #00482', () => {
    const repo = getOrder(as('martin'), 483)
    const rec = db.get<{ id: number }>("SELECT id FROM warehouse_locations WHERE code = 'B-02-01-01'")!
    receiveOrder(as('martin'), 483, { lines: [{ itemId: repo.items[0].id, quantity: 20, locationId: rec.id }] })
    expect(stock('PRO-COL').total).toBe(26)

    let o = retryReservation(as('martin'), 482)
    const prot = o.items.find((i) => i.productCode === 'PRO-COL')!
    expect(prot.reserved).toBe(8)
    o = pickItem(as('diego'), 482, prot.id, true)
    o = transitionOrder(as('diego'), 482, { to: 'preparado' })
    expect(o.status).toBe('preparado')
    expect(checkInvariants(db)).toEqual([])
  })

  it('"Solicitar material" genera una reposición y no la duplica', () => {
    const p = stock('REJ-1100')
    expect(p.available).toBeLessThan(p.minStock)
    const o = requestReplenishment(as('martin'), p.id)
    expect(o.type).toBe('reposicion')
    expect(o.items[0].quantity).toBe(p.minStock * 2 - p.available)
    expect(() => requestReplenishment(as('martin'), p.id)).toThrow(/Ya hay una reposición/)
  })
})

describe('conteo de inventario', () => {
  it('las diferencias generan ajustes y, si no alcanza, liberan reservas', () => {
    // A-04-03-02 tiene 12 vigas reservadas para el #00482: se cuentan 10
    const c = startCount(as('martin'), { warehouseId: 1, sector: 'Pasillo A' })
    const line = c.lines.find((l) => l.locationCode === 'A-04-03-02')!
    setCountLine(as('martin'), c.id, line.id, 10)
    const done = confirmCount(as('martin'), c.id)
    expect(done.status).toBe('confirmado')
    expect(getLocationDetail(as('martin'), 'A-04-03-02').contents[0]).toMatchObject({ quantity: 10, reserved: 10 })
    const viga = getOrder(as('martin'), 482).items.find((i) => i.productCode === 'VIG-140-2700')!
    expect(viga.reserved).toBe(10)
    expect(viga.picked).toBe(false)
    expect(getProduct(as('martin'), viga.productId).movements[0].type).toBe('ajuste')
    expect(checkInvariants(db)).toEqual([])

    // el informe del conteo cerrado conserva la diferencia aunque el stock ya se ajustó
    expect(done.summary).toMatchObject({ differences: 1, minus: 2, plus: 0 })
    expect(done.lines.find((l) => l.id === line.id)).toMatchObject({ currentQty: 12, countedQty: 10 })
  })

  it('un conteo cerrado no cambia con movimientos posteriores', () => {
    // el conteo de la demo (Pasillo C) encontró 1 tornillo menos
    const seeded = listCounts(as('martin')).find((c) => c.sector === 'Pasillo C')!
    expect(seeded.summary).toMatchObject({ differences: 1, minus: 1 })

    const tor = getCount(as('martin'), seeded.id).lines.find((l) => l.productCode === 'TOR-M10')!
    const dest = db.get<{ id: number }>("SELECT id FROM warehouse_locations WHERE code = 'C-03-03-01'")!.id
    manualMove(as('martin'), { inventoryId: tor.inventoryId!, toLocationId: dest, quantity: 5 })
    expect(getCount(as('martin'), seeded.id).lines.find((l) => l.id === tor.id)).toMatchObject({ currentQty: tor.currentQty, countedQty: tor.countedQty })
  })
})

describe('diseñador 3D → almacén', () => {
  it('un rack diseñado se convierte en posiciones del mapa', () => {
    const rack = createRack(as('lucia'), { warehouseId: 1, aisle: 'D', config: { ...DEFAULT_CONFIGURATION, positions: 24, levels: 4 } })
    expect(rack.code).toBe('D-01')
    expect(rack.positions).toBe(24)
    expect(rack.positionsList.some((p) => p.code === 'D-01-04-06')).toBe(true)
    expect(() => createRack(as('diego'), { warehouseId: 1, aisle: 'D', config: DEFAULT_CONFIGURATION })).toThrow()
  })
})

describe('API', () => {
  it('pide sesión, valida la entrada y responde con el usuario logueado', async () => {
    const app = createApp({ db, clock, demo: true })
    const anon = await app.fetch(new Request('http://x/api/orders'))
    expect(anon.status).toBe(401)

    const login = await app.fetch(new Request('http://x/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'martin@sdc.demo', password: 'demo1234' }),
    }))
    const session = await login.json()
    expect(session.user.name).toBe('Martín Gómez')
    const auth = { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }

    const orders = await (await app.fetch(new Request('http://x/api/orders?status=en_preparacion', { headers: auth }))).json()
    expect(orders.map((o: { number: string }) => o.number)).toContain('#00482')

    const bad = await app.fetch(new Request('http://x/api/orders', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'salida', items: [] }) }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error.message).toMatch(/al menos un producto/)

    const wrong = await app.fetch(new Request('http://x/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'martin@sdc.demo', password: 'otra' }),
    }))
    expect(wrong.status).toBe(400)
  })

  it('un comentario notifica a los participantes', () => {
    addComment(as('martin'), 482, 'Ya los ubiqué.')
    expect(listNotifications(as('juan')).items[0].title).toContain('Martín comentó en #00482')
  })
})

/** Cliente HTTP de prueba: inicia sesión y devuelve una función para llamar a la API como ese usuario. */
async function loginAs(app: ReturnType<typeof createApp>, email: string, password = 'demo1234') {
  const res = await app.fetch(new Request('http://x/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  }))
  const { token } = await res.json()
  return (method: string, path: string, body?: unknown) => app.fetch(new Request(`http://x/api${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

describe('perfiles y permisos editables', () => {
  it('lo que cambia el administrador rige desde la próxima operación, y se puede volver a fábrica', async () => {
    const app = createApp({ db, clock, demo: true })
    const lucia = await loginAs(app, 'lucia@sdc.demo')
    const diego = await loginAs(app, 'diego@sdc.demo')

    // un operario no ve un pedido en revisión que no le asignaron
    expect((await diego('GET', '/orders/479')).status).toBe(404)

    const { matrix } = await (await lucia('GET', '/roles')).json()
    const put = await lucia('PUT', '/roles/operario', { permissions: [...matrix.operario, 'pedidos.ver_todos', 'pedidos.revisar', 'no.existe'] })
    expect(put.status).toBe(200)
    const after = (await put.json()).matrix.operario as string[]
    expect(after).toContain('pedidos.revisar')
    expect(after).not.toContain('no.existe')

    // con los permisos nuevos Diego ve y aprueba el pedido
    const approved = await diego('POST', '/orders/479/transition', { to: 'aprobado' })
    expect(approved.status).toBe(200)
    expect((await approved.json()).status).toBe('aprobado')

    // valores de fábrica: vuelve a no ver los pedidos de otros
    expect((await lucia('POST', '/roles/reset')).status).toBe(200)
    expect((await diego('GET', '/orders/480')).status).toBe(404)
  })

  it('sólo el administrador edita permisos y no puede quitarse la administración', async () => {
    const app = createApp({ db, clock, demo: true })
    const lucia = await loginAs(app, 'lucia@sdc.demo')
    const martin = await loginAs(app, 'martin@sdc.demo')
    expect((await martin('PUT', '/roles/operario', { permissions: [] })).status).toBe(403)
    const lockout = await lucia('PUT', '/roles/admin', { permissions: ['pedidos.ver_todos'] })
    expect(lockout.status).toBe(400)
    expect((await lockout.json()).error.message).toMatch(/Administrador/)
  })
})

describe('pedidos de presupuesto (diseñador 3D)', () => {
  it('la demo trae uno respondido y uno sin responder', () => {
    const list = listQuotes(as('lucia'))
    expect(list.map((q) => [q.userName, q.status])).toEqual([['Juan Pérez', 'nuevo'], ['Carolina Díaz', 'respondido']])
    expect(list[1].answeredBy).toBe('Lucía Fernández')
    expect(list[0].headline).toMatch(/^120 posiciones · 4 niveles/)
  })

  it('el servidor recalcula y sanea la configuración, avisa a los administradores y al responder avisa al cliente', () => {
    const q = createQuote(as('carolina'), { config: { height: 99_999, positions: -5, width: 'mucho' }, comments: '  Urgente  ' })
    expect(q.config.height).toBe(DESIGN_RULES.limits.height.max)
    expect(q.config.positions).toBeGreaterThanOrEqual(1)
    expect(q.summary).toMatch(/^CONFIGURACIÓN DE RACK SELECTIVO/)
    expect(q.comments).toBe('Urgente')
    const n = listNotifications(as('lucia')).items[0]
    expect(n).toMatchObject({ type: 'presupuesto.nuevo', link: '/admin?tab=presupuestos' })

    // el encargado no administra presupuestos; un operario no usa el diseñador
    expect(() => listQuotes(as('martin'))).toThrow()
    expect(() => createQuote(as('diego'), { config: DEFAULT_CONFIGURATION })).toThrow()

    const answered = markQuoteAnswered(as('lucia'), q.id)
    expect(answered).toMatchObject({ status: 'respondido', answeredBy: 'Lucía Fernández' })
    expect(listNotifications(as('carolina')).items[0]).toMatchObject({ type: 'presupuesto.respondido', title: 'Respondimos tu pedido de presupuesto' })
    expect(() => markQuoteAnswered(as('lucia'), q.id)).toThrow(/ya figura como respondido/)
  })
})

describe('base de datos', () => {
  it('avisa cada escritura confirmada, también las sueltas (así el navegador guarda la sesión)', async () => {
    let commits = 0
    db.onCommit(() => commits++)
    await login(db, clock, 'lucia@sdc.demo', 'demo1234')
    expect(commits).toBe(1)
    db.transaction(() => {
      db.run("UPDATE users SET sector = 'Depósito' WHERE id = 1")
      db.run("UPDATE users SET sector = 'Administración' WHERE id = 1")
    })
    expect(commits).toBe(2)
    db.run('DELETE FROM sessions WHERE token = :t', { t: 'no-existe' })
    expect(commits).toBe(2)
  })
})

describe('arranque sin demo', () => {
  it('crea la empresa, el almacén con sus zonas y el primer administrador, que ya puede entrar', async () => {
    const fresh = new NodeSqliteDb(':memory:')
    migrate(fresh)
    await expect(bootstrap(fresh, { adminName: 'Admin', adminEmail: 'no-es-un-email', adminPassword: 'clave-segura' })).rejects.toThrow(/email válido/)
    expect(await bootstrap(fresh, { adminName: 'Rocío Admin', adminEmail: 'Rocio@Empresa.com', adminPassword: 'clave-segura' })).toBe(true)
    // si ya hay usuarios no vuelve a crear nada
    expect(await bootstrap(fresh, { adminName: 'Otra', adminEmail: 'otra@empresa.com', adminPassword: 'clave-segura' })).toBe(false)

    const app = createApp({ db: fresh, clock })
    const admin = await loginAs(app, 'rocio@empresa.com', 'clave-segura')
    const me = await (await admin('GET', '/me')).json()
    expect(me.user).toMatchObject({ name: 'Rocío Admin', role: 'admin' })
    const map = await (await admin('GET', '/warehouses/1/map')).json()
    expect(map.zones.map((z: { code: string }) => z.code).sort()).toEqual(['DES', 'REC'])
    expect(map.racks).toEqual([])
    expect(await (await admin('GET', '/products')).json()).toEqual([])
    // sin demo, la pantalla de ingreso no ofrece cuentas de ejemplo
    expect((await (await app.fetch(new Request('http://x/api/demo/users'))).json()).users).toEqual([])
  })
})
