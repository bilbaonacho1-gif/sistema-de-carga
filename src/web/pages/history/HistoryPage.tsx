/** HISTORIAL: todo lo que pasa en el sistema, con filtros y exportación a CSV. */
import { Download, History, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { Activity, ActivityFilter } from '../../../shared/types'
import { useActivity, useCatalog, useSectors, useUsers } from '../../api/queries'
import { useAuth } from '../../auth/AuthContext'
import { Button, EmptyState, Field, Input, Loadable, PageHeader, Select } from '../../components/ui'
import { dayLabel, fmtDateTime, fmtTime } from '../../lib/format'

const TYPES: { value: string; label: string }[] = [
  { value: '', label: 'Todos los movimientos' },
  { value: 'pedido', label: 'Pedidos (todo)' },
  { value: 'pedido.creado', label: 'Pedidos creados' },
  { value: 'pedido.estado', label: 'Cambios de estado' },
  { value: 'pedido.preparacion', label: 'Preparación' },
  { value: 'pedido.comentario', label: 'Comentarios' },
  { value: 'stock', label: 'Stock (todo)' },
  { value: 'stock.ingreso', label: 'Ingresos' },
  { value: 'stock.egreso', label: 'Egresos / despachos' },
  { value: 'stock.reserva', label: 'Reservas' },
  { value: 'stock.liberacion', label: 'Liberaciones' },
  { value: 'stock.traslado', label: 'Traslados' },
  { value: 'stock.ajuste', label: 'Ajustes' },
  { value: 'conteo', label: 'Conteos' },
  { value: 'producto', label: 'Productos' },
  { value: 'rack', label: 'Racks' },
  { value: 'usuario', label: 'Usuarios' },
  { value: 'presupuesto', label: 'Presupuestos' },
]

const EMPTY = { from: '', to: '', userId: '', productId: '', type: '', orderId: '', sector: '' }

export function HistoryPage() {
  const { can } = useAuth()
  const full = can('historial.ver_todo')
  // sin el historial completo sólo hay movimientos de pedidos (y el stock que reservan o despachan)
  const types = full ? TYPES : TYPES.filter((t) => !/^(conteo|producto|rack|usuario|presupuesto)/.test(t.value))
  const [f, setF] = useState(EMPTY)
  const [limit, setLimit] = useState(100)
  const filter: ActivityFilter = useMemo(() => ({
    from: f.from ? `${f.from}T00:00:00` : undefined,
    to: f.to ? `${f.to}T23:59:59` : undefined,
    userId: f.userId ? Number(f.userId) : undefined,
    productId: f.productId ? Number(f.productId) : undefined,
    type: f.type || undefined,
    orderId: f.orderId ? Number(f.orderId.replace(/\D/g, '')) || undefined : undefined,
    sector: f.sector || undefined,
    limit,
  }), [f, limit])
  // las fechas del filtro se interpretan en hora local
  const q = useActivity({ ...filter, from: filter.from && new Date(filter.from).toISOString(), to: filter.to && new Date(filter.to).toISOString() })
  const users = useUsers()
  const catalog = useCatalog()
  const sectors = useSectors(1)
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => { setF((x) => ({ ...x, [k]: e.target.value })); setLimit(100) }
  const active = Object.values(f).some(Boolean)

  const exportCsv = (rows: Activity[]) => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [['Fecha', 'Tipo', 'Usuario', 'Pedido', 'Producto', 'Ubicación', 'Sector', 'Cantidad', 'Detalle'].join(';')]
      .concat(rows.map((a) => [fmtDateTime(a.createdAt), a.type, a.userName, a.orderNumber, a.productName, a.locationCode, a.sector, a.quantity, a.message].map(esc).join(';')))
      .join('\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `historial-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <PageHeader phase={3} title="Historial" subtitle={full ? 'Cada pedido, movimiento de stock, conteo y cambio queda registrado con fecha, hora y usuario.' : 'Lo que pasó con los pedidos de tu empresa.'}
        actions={q.data?.length ? <Button icon={Download} onClick={() => exportCsv(q.data!)}>Exportar CSV</Button> : undefined} />

      <section className="filters" aria-label="Filtros">
        <Field label="Desde">{(id) => <Input id={id} type="date" value={f.from} onChange={set('from')} />}</Field>
        <Field label="Hasta">{(id) => <Input id={id} type="date" value={f.to} onChange={set('to')} />}</Field>
        <Field label="Tipo">{(id) => <Select id={id} value={f.type} onChange={set('type')}>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>}</Field>
        {full && <Field label="Usuario">{(id) => (
          <Select id={id} value={f.userId} onChange={set('userId')}>
            <option value="">Todos</option>
            {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}</Field>}
        <Field label="Producto">{(id) => (
          <Select id={id} value={f.productId} onChange={set('productId')}>
            <option value="">Todos</option>
            {(catalog.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}</Field>
        <Field label="Pedido">{(id) => <Input id={id} value={f.orderId} onChange={set('orderId')} placeholder="#00482" inputMode="numeric" />}</Field>
        {full && <Field label="Sector">{(id) => (
          <Select id={id} value={f.sector} onChange={set('sector')}>
            <option value="">Todos</option>
            {(sectors.data ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        )}</Field>}
        {active && <Button variant="ghost" icon={RotateCcw} onClick={() => setF(EMPTY)} className="filters__reset">Limpiar filtros</Button>}
      </section>

      <Loadable query={q}>{(rows) => rows.length ? (
        <>
          <HistoryList rows={rows} />
          {rows.length >= limit && <Button variant="secondary" onClick={() => setLimit((l) => l + 100)} className="load-more">Cargar más</Button>}
        </>
      ) : <EmptyState icon={History} title="No hay movimientos con estos filtros" />}</Loadable>
    </div>
  )
}

function HistoryList({ rows }: { rows: Activity[] }) {
  const groups: { day: string; items: Activity[] }[] = []
  for (const a of rows) {
    const day = dayLabel(a.createdAt)
    const g = groups[groups.length - 1]
    if (g?.day === day) g.items.push(a)
    else groups.push({ day, items: [a] })
  }
  return (
    <div className="history">
      {groups.map((g) => (
        <section key={g.day} className="history__day">
          <h2 className="history__date">{g.day}</h2>
          <ul>
            {g.items.map((a) => (
              <li key={a.id} className={`history__row feed__item--${a.type.split('.')[0]}`}>
                <time className="history__time" dateTime={a.createdAt}>{fmtTime(a.createdAt)}</time>
                <span className="feed__dot" aria-hidden />
                <div className="history__body">
                  <p>{a.message}</p>
                  <span className="feed__meta">
                    {a.userName && <span>{a.userName}</span>}
                    {a.orderId && <> · <Link to={`/pedidos/${a.orderId}`}>{a.orderNumber}</Link></>}
                    {a.productId && a.productName && <> · <Link to={`/inventario/${a.productId}`}>{a.productName}</Link></>}
                    {a.locationCode && <> · <span className="mono">{a.locationCode}</span></>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
