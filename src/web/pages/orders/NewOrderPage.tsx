import { Minus, PackageOpen, Plus, Send, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { PRIORITY_META, TYPE_LABEL } from '../../../shared/orders'
import type { OrderType, Priority, Product } from '../../../shared/types'
import { useCatalog, useCompanies, useCreateOrder, useUsers } from '../../api/queries'
import { useAuth, useMe } from '../../auth/AuthContext'
import { useToast } from '../../components/overlays'
import { ProductPicker } from '../../components/ProductPicker'
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Segmented, Select, Textarea } from '../../components/ui'
import { fmt, fmtDate } from '../../lib/format'

interface Line { product: Product & { available: number }; quantity: number; notes: string }

export function NewOrderPage() {
  const me = useMe()
  const { can } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const catalog = useCatalog()
  const companies = useCompanies()
  const isClient = me.role === 'cliente'
  const canReplenish = can('inventario.reponer')
  const canOrder = can('pedidos.crear')

  const [type, setType] = useState<OrderType>(canOrder ? 'salida' : 'reposicion')
  const [companyId, setCompanyId] = useState(me.companyId)
  const company = companies.data?.find((c) => c.id === companyId)
  const users = useUsers()
  const companyUsers = (users.data ?? []).filter((u) => u.companyId === companyId && u.active)
  const [requesterId, setRequesterId] = useState(me.id)
  const [sector, setSector] = useState(me.sector)
  const [priority, setPriority] = useState<Priority>('normal')
  const [neededBy, setNeededBy] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const create = useCreateOrder()

  // al cambiar de empresa, el solicitante y el sector se acomodan
  useEffect(() => {
    if (!companyUsers.length) return
    if (!companyUsers.some((u) => u.id === requesterId)) setRequesterId(companyUsers[0].id)
  }, [companyId, companyUsers.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (type === 'reposicion') { setSector('Almacén'); setCompanyId(me.companyId) }
  }, [type, me.companyId])

  const units = lines.reduce((s, l) => s + l.quantity, 0)
  const short = lines.filter((l) => type === 'salida' && l.quantity > l.product.available)
  const today = new Date().toISOString().slice(0, 10)

  const setLine = (id: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.product.id === id ? { ...l, ...patch } : l)))

  const submit = () => {
    create.mutate({
      type, companyId, requesterId, sector, priority, neededBy: neededBy || null, notes,
      items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, notes: l.notes })),
    }, {
      onSuccess: (o) => {
        toast.ok(`Pedido ${o.number} enviado`)
        navigate(`/pedidos/${o.id}`)
      },
    })
  }

  const sectors = useMemo(() => [...new Set([...(company?.sectors ?? []), sector].filter(Boolean))], [company, sector])

  return (
    <div className="page">
      <PageHeader phase={1} title="Nuevo pedido" back={{ to: '/pedidos', label: 'Pedidos' }} subtitle="Completá quién pide, para cuándo y qué productos. Al enviarlo, el almacén recibe el aviso." />

      <div className="form-layout">
        <div className="form-layout__main">
          <Card title="Datos del pedido">
            <div className="form-grid">
              {canOrder && canReplenish && (
                <div className="form-grid__full">
                  <Field label="Tipo de pedido">{() => (
                    <Segmented label="Tipo de pedido" value={type} onChange={setType} options={[
                      { value: 'salida', label: TYPE_LABEL.salida }, { value: 'reposicion', label: TYPE_LABEL.reposicion },
                    ]} />
                  )}</Field>
                </div>
              )}
              <Field label="Empresa">{(id) => isClient || type === 'reposicion'
                ? <Input id={id} value={company?.name ?? me.companyName} readOnly />
                : (
                  <Select id={id} value={companyId} onChange={(e) => setCompanyId(Number(e.target.value))}>
                    {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                )}</Field>
              <Field label="Sector">{(id) => (
                <>
                  <Input id={id} list={`${id}-list`} value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Producción, Montaje…" />
                  <datalist id={`${id}-list`}>{sectors.map((s) => <option key={s} value={s} />)}</datalist>
                </>
              )}</Field>
              <Field label="Solicitante">{(id) => isClient
                ? <Input id={id} value={me.name} readOnly />
                : (
                  <Select id={id} value={requesterId} onChange={(e) => setRequesterId(Number(e.target.value))}>
                    {companyUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                )}</Field>
              <Field label="Fecha">{(id) => <Input id={id} value={fmtDate(today)} readOnly />}</Field>
              <Field label="Prioridad">{() => (
                <Segmented label="Prioridad" value={priority} onChange={setPriority} options={(Object.keys(PRIORITY_META) as Priority[]).map((p) => ({ value: p, label: PRIORITY_META[p].label }))} />
              )}</Field>
              <Field label="Fecha necesaria" optional>{(id) => <Input id={id} type="date" min={today} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />}</Field>
              <div className="form-grid__full">
                <Field label="Comentarios" optional>{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Para qué es, dónde se entrega, cualquier detalle útil." />}</Field>
              </div>
            </div>
          </Card>

          <Card title="Productos">
            <div className="lines">
              <ProductPicker
                catalog={catalog.data ?? []}
                exclude={lines.map((l) => l.product.id)}
                onPick={(p) => setLines((ls) => [...ls, { product: p, quantity: 1, notes: '' }])}
              />
              {!lines.length ? (
                <EmptyState icon={PackageOpen} title="Todavía no agregaste productos">Buscalos por nombre o código.</EmptyState>
              ) : (
                <ul className="line-list">
                  {lines.map((l) => (
                    <li key={l.product.id} className="line">
                      <div className="line__product">
                        <span className="line__code">{l.product.code}</span>
                        <strong>{l.product.name}</strong>
                        <span className={type === 'salida' && l.quantity > l.product.available ? 'late' : 'muted'}>
                          Disponible: {fmt(l.product.available)} {l.product.unit === 'u' ? 'u.' : l.product.unit}
                          {type === 'salida' && l.quantity > l.product.available && ' · se reservará lo que haya'}
                        </span>
                      </div>
                      <div className="stepper" role="group" aria-label={`Cantidad de ${l.product.name}`}>
                        <button type="button" onClick={() => setLine(l.product.id, { quantity: Math.max(1, l.quantity - 1) })} aria-label="Restar uno"><Minus size={16} /></button>
                        <input
                          inputMode="numeric"
                          value={l.quantity}
                          onChange={(e) => setLine(l.product.id, { quantity: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })}
                          aria-label="Cantidad"
                        />
                        <button type="button" onClick={() => setLine(l.product.id, { quantity: l.quantity + 1 })} aria-label="Sumar uno"><Plus size={16} /></button>
                        <span className="stepper__unit">{l.product.unit === 'u' ? 'u.' : l.product.unit}</span>
                      </div>
                      <Input className="input line__notes" value={l.notes} onChange={(e) => setLine(l.product.id, { notes: e.target.value })} placeholder="Observaciones" aria-label={`Observaciones de ${l.product.name}`} />
                      <button type="button" className="line__remove" onClick={() => setLines((ls) => ls.filter((x) => x.product.id !== l.product.id))} aria-label={`Quitar ${l.product.name}`}><Trash2 size={17} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        <aside className="form-layout__side">
          <Card title="Resumen">
            <dl className="kv">
              <div className="kv__row"><dt>Tipo</dt><dd>{TYPE_LABEL[type]}</dd></div>
              <div className="kv__row"><dt>Empresa</dt><dd>{company?.name ?? me.companyName}</dd></div>
              <div className="kv__row"><dt>Productos</dt><dd>{lines.length}</dd></div>
              <div className="kv__row"><dt>Unidades</dt><dd className="mono">{fmt(units)}</dd></div>
              <div className="kv__row"><dt>Prioridad</dt><dd>{PRIORITY_META[priority].label}</dd></div>
              <div className="kv__row"><dt>Necesario</dt><dd>{neededBy ? fmtDate(neededBy) : 'Sin fecha'}</dd></div>
            </dl>
            {!!short.length && (
              <p className="note note--amber">
                {short.length === 1 ? 'Un producto supera' : `${short.length} productos superan`} el stock disponible. El pedido se puede enviar: al aprobarse se reserva lo que haya y el resto queda como faltante.
              </p>
            )}
            <ErrorNote error={create.error} />
            <Button variant="primary" size="lg" block icon={Send} disabled={!lines.length} loading={create.isPending} onClick={submit}>
              Enviar pedido
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  )
}
