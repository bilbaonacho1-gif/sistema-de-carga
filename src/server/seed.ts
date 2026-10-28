/**
 * Datos de demostración. Salvo las empresas y los usuarios iniciales, TODO se carga
 * a través de los mismos servicios que usa la app (alta de productos, ingresos de stock,
 * pedidos que se aprueban, preparan, entregan…), con fechas hacia atrás.
 * Así el stock, las reservas, los movimientos y el historial cierran entre sí.
 */
import { DEFAULT_CONFIGURATION } from '../shared/rack/technicalSpecs'
import type { Role } from '../shared/types'
import type { Db } from './db/db'
import { hashPassword } from './core/auth'
import type { Clock, Ctx } from './core/context'
import { actorFor } from './core/roles'
import { confirmCount, setCountLine, startCount } from './core/counts'
import { addStock } from './core/inventory'
import { addComment, createOrder, pickItem, receiveOrder, transitionOrder } from './core/orders'
import { createProduct } from './core/products'
import { createQuote, markQuoteAnswered } from './core/quotes'
import { createRack, createZone } from './core/warehouse'

export const DEMO_PASSWORD = 'demo1234'

export const DEMO_USERS: { name: string; email: string; role: Role; company: number; sector: string }[] = [
  { name: 'Lucía Fernández', email: 'lucia@sdc.demo', role: 'admin', company: 1, sector: 'Administración' },
  { name: 'Martín Gómez', email: 'martin@sdc.demo', role: 'encargado', company: 1, sector: 'Almacén' },
  { name: 'Diego Sosa', email: 'diego@sdc.demo', role: 'operario', company: 1, sector: 'Almacén' },
  { name: 'Ana Torres', email: 'ana@sdc.demo', role: 'operario', company: 1, sector: 'Almacén' },
  { name: 'Juan Pérez', email: 'juan@sdc.demo', role: 'cliente', company: 1, sector: 'Producción' },
  { name: 'Carolina Díaz', email: 'carolina@andina.demo', role: 'cliente', company: 2, sector: 'Depósito Central' },
]

const PRODUCTS: [code: string, name: string, category: string, unit: string, min: number, description: string][] = [
  ['PAR-80-4500', 'Parante 80 × 70 · 4.500 mm', 'Parantes', 'u', 12, 'Parante perforado galvanizado, perfil C con pliegue central.'],
  ['PAR-80-6000', 'Parante 80 × 70 · 6.000 mm', 'Parantes', 'u', 12, 'Parante perforado galvanizado, perfil C con pliegue central.'],
  ['PAR-100-8000', 'Parante 100 × 85 · 8.000 mm', 'Parantes', 'u', 6, 'Parante reforzado para racks de gran altura.'],
  ['VIG-120-2300', 'Viga caja 120 × 50 · 2.300 mm', 'Vigas', 'u', 20, 'Larguero caja con conectores soldados, pintura epoxi roja.'],
  ['VIG-140-2700', 'Viga caja 140 × 50 · 2.700 mm', 'Vigas', 'u', 24, 'Larguero caja con conectores soldados, pintura epoxi roja.'],
  ['VIG-160-3300', 'Viga caja 160 × 60 · 3.300 mm', 'Vigas', 'u', 10, 'Larguero caja reforzado para luces largas.'],
  ['BAS-1100-6000', 'Bastidor armado 1.100 × 6.000', 'Bastidores', 'u', 4, 'Dos parantes con travesaños y diagonales en zigzag.'],
  ['DIA-1100', 'Diagonal de bastidor 1.100', 'Bastidores', 'u', 40, 'Perfil C galvanizado con bulonería.'],
  ['TRA-1100', 'Travesaño de bastidor 1.100', 'Bastidores', 'u', 20, 'Perfil C galvanizado con bulonería.'],
  ['PRO-COL', 'Protector de columna 400 mm', 'Protecciones', 'u', 10, 'Chapa plegada en V, roja, con pestañas abulonadas al piso.'],
  ['PRO-BAS', 'Protector de bastidor (guardarraíl)', 'Protecciones', 'u', 4, 'Defensa lateral para cabeceras de rack.'],
  ['PAS-SEG', 'Pasador de seguridad', 'Accesorios', 'u', 200, 'Traba el conector de la viga al parante.'],
  ['PLA-BASE', 'Placa base con anclajes', 'Accesorios', 'u', 20, 'Placa roja con 4 bulones de anclaje.'],
  ['ANC-M12', 'Anclaje químico M12', 'Accesorios', 'u', 100, 'Fijación de placas base a piso de hormigón.'],
  ['DIS-200', 'Distanciador espalda-espalda 200 mm', 'Accesorios', 'u', 10, 'Une filas de rack espalda con espalda.'],
  ['CAR-CARGA', 'Placa de carga (señalética)', 'Señalización', 'u', 15, 'Cartel con la capacidad por nivel y por bastidor.'],
  ['PAL-ARLOG', 'Pallet Arlog 1.000 × 1.200', 'Pallets y estiba', 'u', 30, 'Pallet de madera estándar Arlog.'],
  ['REJ-1100', 'Rejilla de apoyo 1.100', 'Pallets y estiba', 'u', 10, 'Rejilla electrosoldada para cargas sin pallet.'],
  ['PIN-EPX-ROJO', 'Pintura epoxi roja RAL 3020', 'Insumos', 'l', 40, 'Pintura para retoques de vigas y protectores.'],
  ['TOR-M10', 'Tornillo M10 × 25 (caja × 100)', 'Insumos', 'caja', 10, 'Bulonería para diagonales y travesaños.'],
]

/** Stock inicial por ubicación. */
const STOCK: [code: string, location: string, qty: number][] = [
  ['VIG-140-2700', 'A-03-01-01', 30], ['VIG-140-2700', 'A-04-03-02', 12],
  ['VIG-120-2300', 'A-01-01-01', 34], ['VIG-160-3300', 'A-01-01-02', 14],
  ['PAR-80-4500', 'A-02-01-01', 22], ['PAR-80-6000', 'A-02-01-02', 24], ['PAR-80-6000', 'A-02-02-01', 10],
  ['PAR-100-8000', 'A-02-01-03', 8], ['BAS-1100-6000', 'A-04-01-01', 6], ['BAS-1100-6000', 'A-04-01-02', 4],
  ['DIA-1100', 'B-01-02-01', 60], ['TRA-1100', 'B-01-02-02', 34], ['PRO-COL', 'B-02-01-01', 6], ['PRO-BAS', 'B-02-01-02', 9],
  ['PAS-SEG', 'B-03-03-01', 380], ['PLA-BASE', 'B-03-02-01', 72], ['ANC-M12', 'B-03-02-02', 160],
  ['CAR-CARGA', 'C-01-03-01', 28], ['PAL-ARLOG', 'C-02-01-01', 40], ['PAL-ARLOG', 'C-02-01-02', 35],
  ['REJ-1100', 'C-02-02-01', 8], ['PIN-EPX-ROJO', 'C-03-01-01', 120], ['TOR-M10', 'C-03-02-01', 19],
  ['ANC-M12', 'REC', 40],
]

export async function seed(db: Db, opts: { now?: Date } = {}): Promise<boolean> {
  if (db.get('SELECT id FROM companies LIMIT 1')) return false
  const base = opts.now ?? new Date()

  // reloj que se puede mover hacia atrás para fechar cada evento
  let current = base
  const clock: Clock = { now: () => current.toISOString() }
  const at = (daysAgo: number, h: number, m = 0) => {
    const d = new Date(base)
    d.setDate(d.getDate() - daysAgo)
    d.setHours(h, m, 0, 0)
    current = d.getTime() > base.getTime() ? base : d
  }
  at(12, 8)

  // empresas y usuarios iniciales (arranque: todavía no hay nadie que pueda dar de alta)
  const hash = await hashPassword(DEMO_PASSWORD)
  db.transaction(() => {
    const companies: [string, string, string[]][] = [
      ['Sistemas de Carga S.A.', 'interna', ['Producción', 'Montaje', 'Mantenimiento', 'Almacén', 'Despacho', 'Administración']],
      ['Logística Andina S.A.', 'cliente', ['Depósito Central', 'Compras']],
      ['Metalúrgica del Sur', 'cliente', ['Planta 2']],
    ]
    for (const [name, kind, sectors] of companies)
      db.run('INSERT INTO companies (name, kind, sectors, created_at) VALUES (:name, :kind, :sectors, :now)', { name, kind, sectors: JSON.stringify(sectors), now: clock.now() })
    for (const u of DEMO_USERS)
      db.run(
        `INSERT INTO users (company_id, name, email, password_hash, role, sector, active, created_at)
         VALUES (:company, :name, :email, :hash, :role, :sector, 1, :now)`,
        { ...u, hash, now: clock.now() },
      )
    db.run(
      `INSERT INTO warehouses (name, address, length_mm, width_mm, created_at)
       VALUES ('Planta Malvinas Argentinas', 'Rutherford 4669, Malvinas Argentinas', 32000, 22000, :now)`,
      { now: clock.now() },
    )
  })

  const users = new Map(db.all<{ id: number; email: string; name: string; role: Role; company_id: number }>(
    'SELECT id, email, name, role, company_id FROM users',
  ).map((u) => [u.email.split('@')[0], actorFor(db, { id: u.id, name: u.name, role: u.role, companyId: u.company_id })]))
  const as = (who: string): Ctx => ({ db, clock, actor: users.get(who)! })

  const lucia = () => as('lucia')
  const martin = () => as('martin')

  db.transaction(() => {
    // zonas de piso y racks (12 racks iguales armados con el diseñador)
    createZone(lucia(), { warehouseId: 1, code: 'REC', name: 'Recepción', x: 1000, y: 800, w: 6500, h: 3600 })
    createZone(lucia(), { warehouseId: 1, code: 'DES', name: 'Despacho', x: 24500, y: 800, w: 6500, h: 3600 })
    const rackConfig = { ...DEFAULT_CONFIGURATION, width: 2700, depth: 1100, height: 6000, levels: 4, positions: 16, palletWeight: 1500 }
    for (const aisle of ['A', 'B', 'C']) for (let n = 1; n <= 4; n++) createRack(lucia(), { warehouseId: 1, aisle, config: rackConfig })

    const product = new Map<string, number>()
    for (const [code, name, category, unit, minStock, description] of PRODUCTS)
      product.set(code, createProduct(lucia(), { code, name, category, unit, minStock, description }).id)
    const loc = (code: string) => db.get<{ id: number }>('SELECT id FROM warehouse_locations WHERE code = :code', { code })!.id

    at(11, 9)
    for (const [code, location, qty] of STOCK)
      addStock(martin(), { productId: product.get(code)!, locationId: loc(location), quantity: qty, note: 'Stock inicial' })

    const p = (code: string) => product.get(code)!
    type Step = () => void
    const order = (who: string, sector: string, items: [string, number][], notes = '', priority: 'baja' | 'normal' | 'alta' | 'urgente' = 'normal', neededInDays = 7) =>
      createOrder(as(who), {
        type: 'salida', sector, priority, notes,
        neededBy: new Date(current.getTime() + neededInDays * 86_400_000).toISOString().slice(0, 10),
        items: items.map(([code, quantity]) => ({ productId: p(code), quantity })),
      }).id
    const run = (steps: [number, number, Step][]) => { for (const [d, h, step] of steps) { at(d, h); step() } }
    const pickAll = (who: string, id: number) => {
      const o = transitionOrder(as(who), id, { to: 'en_preparacion' })
      for (const it of o.items) pickItem(as(who), id, it.id, true)
    }
    const fullFlow = (id: number, operario: string, d: number, finalizer: string) => run([
      [d, 10, () => transitionOrder(martin(), id, { to: 'en_revision' })],
      [d, 11, () => transitionOrder(martin(), id, { to: 'aprobado', assigneeId: users.get(operario)!.id })],
      [d, 14, () => pickAll(operario, id)],
      [d, 16, () => transitionOrder(as(operario), id, { to: 'preparado' })],
      [d - 1, 9, () => transitionOrder(martin(), id, { to: 'entregado', note: 'Retiró el transporte del cliente' })],
      [d - 1, 15, () => transitionOrder(as(finalizer), id, { to: 'finalizado' })],
    ])

    // #00470 a #00473: pedidos ya cerrados
    at(8, 9); const o470 = order('juan', 'Producción', [['PAR-80-4500', 4], ['VIG-120-2300', 8]], 'Reemplazo de parantes golpeados en línea 2.')
    fullFlow(o470, 'diego', 8, 'juan')
    at(7, 10); const o471 = order('carolina', 'Depósito Central', [['PAL-ARLOG', 10]], 'Ampliación de estiba en nave 3.')
    fullFlow(o471, 'ana', 7, 'carolina')
    at(7, 12); const o472 = order('juan', 'Montaje', [['DIA-1100', 20]])
    at(7, 15); transitionOrder(martin(), o472, { to: 'cancelado', note: 'Se pidió con la medida equivocada; se rehace con 1.100 mm confirmados.' })
    at(6, 9); const o473 = order('carolina', 'Compras', [['CAR-CARGA', 6], ['PAS-SEG', 100]], 'Señalética para la auditoría de seguridad.')
    fullFlow(o473, 'diego', 6, 'carolina')

    // #00474: reposición recibida y cerrada (pasadores)
    at(5, 9)
    const o474 = createOrder(martin(), { type: 'reposicion', sector: 'Almacén', priority: 'alta', neededBy: null, notes: 'Reposición mensual de pasadores.', items: [{ productId: p('PAS-SEG'), quantity: 300 }] }).id
    run([
      [5, 11, () => transitionOrder(lucia(), o474, { to: 'aprobado', note: 'Orden de producción emitida.' })],
      [3, 10, () => receiveOrder(martin(), o474, { lines: [{ itemId: db.get<{ id: number }>('SELECT id FROM order_items WHERE order_id = :id', { id: o474 })!.id, quantity: 300, locationId: loc('B-03-03-01') }] })],
      [3, 12, () => transitionOrder(martin(), o474, { to: 'finalizado' })],
    ])

    // #00475 finalizado, #00476 entregado (falta que el cliente confirme), #00477 preparado
    at(5, 14); const o475 = order('juan', 'Montaje', [['BAS-1100-6000', 2], ['PLA-BASE', 8]], 'Armado de cabecera nueva en planta.')
    fullFlow(o475, 'ana', 5, 'martin')
    at(4, 10); const o476 = order('carolina', 'Depósito Central', [['PLA-BASE', 12], ['ANC-M12', 48]], 'Anclajes para 12 bastidores.', 'alta')
    run([
      [3, 9, () => transitionOrder(martin(), o476, { to: 'aprobado', assigneeId: users.get('diego')!.id })],
      [2, 10, () => pickAll('diego', o476)],
      [2, 12, () => transitionOrder(as('diego'), o476, { to: 'preparado' })],
      [1, 9, () => transitionOrder(martin(), o476, { to: 'entregado', note: 'Entregado en Depósito Central.' })],
    ])
    at(3, 15); const o477 = order('juan', 'Montaje', [['TRA-1100', 10], ['DIA-1100', 16]], 'Arriostramiento de bastidores nuevos.')
    run([
      [2, 9, () => transitionOrder(martin(), o477, { to: 'en_revision' })],
      [2, 10, () => transitionOrder(martin(), o477, { to: 'aprobado', assigneeId: users.get('ana')!.id })],
      [1, 11, () => pickAll('ana', o477)],
      [1, 12, () => transitionOrder(as('ana'), o477, { to: 'preparado' })],
    ])

    // conteo físico del pasillo C con una diferencia
    at(3, 16)
    const count = startCount(martin(), { warehouseId: 1, sector: 'Pasillo C' })
    for (const l of count.lines) setCountLine(martin(), count.id, l.id, l.productCode === 'TOR-M10' ? l.systemQty - 1 : l.systemQty)
    confirmCount(martin(), count.id)

    // presupuestos del diseñador: Carolina cotizó un rack de 8 m (respondido; después hizo el pedido #00480)
    at(2, 9)
    const q1 = createQuote(as('carolina'), {
      config: { ...DEFAULT_CONFIGURATION, width: 3300, height: 8000, levels: 5, positions: 60, palletWeight: 1200 },
      comments: 'Ampliación del Depósito Central. Necesitamos aprovechar la altura de la nave nueva.',
    })
    at(2, 11); markQuoteAnswered(lucia(), q1.id)

    // #00478 aprobado y asignado, #00479 en revisión, #00480 y #00481 recién pedidos
    at(2, 15); const o478 = order('carolina', 'Depósito Central', [['PAL-ARLOG', 20], ['REJ-1100', 4]], '', 'normal', 5)
    at(1, 10); transitionOrder(martin(), o478, { to: 'aprobado', assigneeId: users.get('diego')!.id })
    at(1, 11); const o479 = order('juan', 'Mantenimiento', [['PIN-EPX-ROJO', 20], ['TOR-M10', 4]], 'Mantenimiento preventivo de racks de la nave 1.')
    at(1, 12); transitionOrder(martin(), o479, { to: 'en_revision' })
    at(1, 13); order('carolina', 'Compras', [['VIG-160-3300', 6], ['PAR-100-8000', 4]], 'Cotizado con el diseñador 3D: rack de 8 m.', 'alta', 10)
    at(1, 14); order('juan', 'Producción', [['CAR-CARGA', 10]], 'Carteles para los racks nuevos.')

    // #00482: el ejemplo del pedido en preparación con un faltante y comentarios
    at(1, 15)
    const o482 = order('juan', 'Producción', [['VIG-140-2700', 12], ['PAR-80-6000', 6], ['PRO-COL', 8]], 'Necesario para armado de rack nuevo.', 'alta', 3)
    at(1, 16); transitionOrder(martin(), o482, { to: 'en_revision' })
    at(1, 17); transitionOrder(martin(), o482, { to: 'aprobado', assigneeId: users.get('diego')!.id })
    // Juan pide presupuesto de un rack doble para la nave 2 (todavía sin responder)
    at(0, 7)
    createQuote(as('juan'), {
      config: { ...DEFAULT_CONFIGURATION, positions: 120, levels: 4, palletWeight: 1000, layout: { ...DEFAULT_CONFIGURATION.layout, rows: 2, backToBack: true } },
      comments: 'Para la nave 2: dos filas espalda con espalda. Pallets ARLOG de unos 1.000 kg.',
    })
    at(0, 8)
    const prep = transitionOrder(as('diego'), o482, { to: 'en_preparacion' })
    at(0, 8); pickItem(as('diego'), o482, prep.items.find((i) => i.productCode === 'VIG-140-2700')!.id, true)
    at(0, 9); pickItem(as('diego'), o482, prep.items.find((i) => i.productCode === 'PAR-80-6000')!.id, true)
    at(0, 9); addComment(as('juan'), o482, 'Faltan 2 protectores.')

    // #00483: reposición de protectores (aprobada, llega mañana) y #00484: distanciadores sin stock
    at(0, 9)
    const o483 = createOrder(martin(), {
      type: 'reposicion', sector: 'Almacén', priority: 'urgente', neededBy: new Date(base.getTime() + 86_400_000).toISOString().slice(0, 10),
      notes: 'Protectores para completar el pedido #00482.', items: [{ productId: p('PRO-COL'), quantity: 20 }],
    }).id
    at(0, 10); transitionOrder(lucia(), o483, { to: 'aprobado', note: 'Producción los entrega mañana.' })
    at(0, 10); addComment(martin(), o482, 'Llegan mañana.')
    at(0, 10); addComment(as('juan'), o482, 'Perfecto.')
    at(0, 11)
    createOrder(martin(), {
      type: 'reposicion', sector: 'Almacén', priority: 'urgente', neededBy: null,
      notes: 'Sin stock de distanciadores.', items: [{ productId: p('DIS-200'), quantity: 20 }],
    })
  })
  return true
}
