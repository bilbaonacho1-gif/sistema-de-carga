/** Administración: usuarios, perfiles y permisos, productos, racks, empresas y presupuestos. */
import { Box, Building2, Calculator, MailCheck, Pencil, Plus, RotateCcw, Save, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ROLE_LABEL } from '../../../shared/permissions'
import type { Company, Product, Quote, Role, User } from '../../../shared/types'
import { api } from '../../api/client'
import {
  useAnswerQuote, useCompanies, useCreateCompany, useDeleteRack, useProducts, useQuotes, useRoles, useSaveUser, useUsers, useWarehouseMap,
} from '../../api/queries'
import { useAuth, useMe } from '../../auth/AuthContext'
import { ConfirmDialog, Dialog, useToast } from '../../components/overlays'
import {
  Avatar, Badge, Button, Card, EmptyState, ErrorNote, Field, Input, KeyValue, LinkButton, Loadable, PageHeader, Segmented, Select, StockBadge,
} from '../../components/ui'
import { fmt, fmtDate, fmtDateTime } from '../../lib/format'
import { useDesigner } from '../designer/designerStore'
import { ProductDialog } from '../inventory/StockDialogs'

type Tab = 'usuarios' | 'permisos' | 'productos' | 'racks' | 'empresas' | 'presupuestos'

export function AdminPage() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const quotes = useQuotes(can('usuarios.gestionar'))
  const unanswered = quotes.data?.filter((x) => x.status === 'nuevo').length ?? 0
  const tabs: { value: Tab; label: string }[] = [
    ...(can('usuarios.gestionar') ? [{ value: 'usuarios' as const, label: 'Usuarios' }, { value: 'permisos' as const, label: 'Perfiles y permisos' }] : []),
    ...(can('productos.editar') ? [{ value: 'productos' as const, label: 'Productos' }] : []),
    ...(can('almacen.editar') ? [{ value: 'racks' as const, label: 'Racks' }] : []),
    ...(can('usuarios.gestionar') ? [
      { value: 'empresas' as const, label: 'Empresas' },
      { value: 'presupuestos' as const, label: unanswered ? `Presupuestos (${unanswered})` : 'Presupuestos' },
    ] : []),
  ]
  const tab = (tabs.find((t) => t.value === params.get('tab'))?.value ?? tabs[0]?.value) as Tab
  return (
    <div className="page">
      <PageHeader title="Administración" subtitle="Usuarios, perfiles de acceso, catálogo de productos, estructura del almacén y presupuestos." />
      <Segmented label="Sección" value={tab} onChange={(t) => setParams({ tab: t })} options={tabs} />
      {tab === 'usuarios' && <UsersTab />}
      {tab === 'permisos' && <PermissionsTab />}
      {tab === 'productos' && <ProductsTab />}
      {tab === 'racks' && <RacksTab />}
      {tab === 'empresas' && <CompaniesTab />}
      {tab === 'presupuestos' && <QuotesTab />}
    </div>
  )
}

/* ------------------------------ Usuarios ------------------------------ */

function UsersTab() {
  const q = useUsers()
  const [editing, setEditing] = useState<User | 'new' | null>(null)
  return (
    <Card title="Usuarios" actions={<Button variant="primary" size="sm" icon={UserPlus} onClick={() => setEditing('new')}>Nuevo usuario</Button>} padded={false}>
      <Loadable query={q}>{(users) => (
        <div className="table-wrap table-wrap--flush">
          <table className="table table--click">
            <thead><tr><th>Nombre</th><th>Perfil</th><th>Empresa · sector</th><th>Alta</th><th>Estado</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} onClick={() => setEditing(u)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEditing(u)}>
                  <td><span className="person"><Avatar name={u.name} size={30} /><span><strong>{u.name}</strong><span className="sub">{u.email}</span></span></span></td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>{u.companyName}{u.sector && <span className="sub">{u.sector}</span>}</td>
                  <td className="muted">{fmtDate(u.createdAt)}</td>
                  <td>{u.active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}</Loadable>
      {editing && <UserDialog user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function UserDialog({ user, onClose }: { user: User | null; onClose(): void }) {
  const me = useMe()
  const companies = useCompanies()
  const save = useSaveUser()
  const toast = useToast()
  const [f, setF] = useState({
    name: user?.name ?? '', email: user?.email ?? '', role: user?.role ?? 'operario' as Role,
    companyId: user?.companyId ?? me.companyId, sector: user?.sector ?? '', password: '', active: user?.active ?? true,
  })
  const company = companies.data?.find((c) => c.id === f.companyId)
  const self = user?.id === me.id
  return (
    <Dialog open onClose={onClose} title={user ? `Editar ${user.name}` : 'Nuevo usuario'}
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button>
        <Button variant="primary" icon={Save} loading={save.isPending}
          onClick={() => save.mutate({ id: user?.id, ...f, password: f.password || undefined }, { onSuccess: (u) => { toast.ok(`${u.name} guardado`); onClose() } })}>Guardar</Button></>}>
      <div className="form-grid">
        <div className="form-grid__full"><Field label="Nombre y apellido">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field></div>
        <div className="form-grid__full"><Field label="Email">{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field></div>
        <Field label="Perfil" hint={self ? 'No podés cambiar tu propio perfil.' : undefined}>{(id) => (
          <Select id={id} value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        )}</Field>
        <Field label="Empresa">{(id) => (
          <Select id={id} value={f.companyId} onChange={(e) => setF({ ...f, companyId: Number(e.target.value) })}>
            {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}</Field>
        <Field label="Sector" optional>{(id) => (
          <>
            <Input id={id} list={`${id}-l`} value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} />
            <datalist id={`${id}-l`}>{(company?.sectors ?? []).map((s) => <option key={s} value={s} />)}</datalist>
          </>
        )}</Field>
        <Field label={user ? 'Nueva contraseña' : 'Contraseña inicial'} optional={!!user} hint="Mínimo 8 caracteres.">{(id) => <Input id={id} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
        {user && !self && (
          <label className="check-line form-grid__full"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Usuario activo (si lo desactivás, se cierra su sesión)</label>
        )}
      </div>
      <ErrorNote error={save.error} />
    </Dialog>
  )
}

/* ------------------------------ Perfiles y permisos ------------------------------ */

function PermissionsTab() {
  const q = useRoles()
  const qc = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState<Record<Role, string[]> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (q.data && !draft) setDraft(q.data.matrix) }, [q.data, draft])
  const roles = Object.keys(ROLE_LABEL) as Role[]
  const dirty = !!q.data && !!draft && roles.some((r) => [...draft[r]].sort().join() !== [...q.data!.matrix[r]].sort().join())

  const toggle = (role: Role, perm: string) => setDraft((d) => d && ({ ...d, [role]: d[role].includes(perm) ? d[role].filter((p) => p !== perm) : [...d[role], perm] }))
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      for (const r of roles) await api.put(`/roles/${r}`, { permissions: draft![r] })
      await qc.invalidateQueries()
      setDraft(null)
      toast.ok('Permisos guardados. Se aplican en la próxima acción de cada usuario.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const reset = async () => {
    await api.post('/roles/reset')
    await qc.invalidateQueries()
    setDraft(null)
    toast.ok('Se restablecieron los permisos de fábrica')
  }

  return (
    <Card title="Qué puede hacer cada perfil" actions={<>
      <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>Valores de fábrica</Button>
      <Button size="sm" variant="primary" icon={Save} disabled={!dirty} loading={saving} onClick={save}>Guardar cambios</Button>
    </>} padded={false}>
      <Loadable query={q}>{(data) => draft && (
        <div className="table-wrap table-wrap--flush">
          <table className="table perm-table">
            <thead><tr><th>Permiso</th>{roles.map((r) => <th key={r} className="center">{ROLE_LABEL[r]}</th>)}</tr></thead>
            <tbody>
              {Object.entries(data.permissions).map(([perm, label]) => (
                <tr key={perm}>
                  <td>{label}<span className="sub mono">{perm}</span></td>
                  {roles.map((r) => (
                    <td key={r} className="center">
                      <input type="checkbox" checked={draft[r].includes(perm)} onChange={() => toggle(r, perm)}
                        disabled={r === 'admin' && perm === 'usuarios.gestionar'}
                        aria-label={`${ROLE_LABEL[r]}: ${label}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}</Loadable>
      {error && <div className="card__body"><p className="error-note">{error}</p></div>}
    </Card>
  )
}

/* ------------------------------ Productos ------------------------------ */

function ProductsTab() {
  const q = useProducts({})
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  return (
    <Card title="Catálogo de productos" actions={<Button variant="primary" size="sm" icon={Plus} onClick={() => setEditing('new')}>Nuevo producto</Button>} padded={false}>
      <Loadable query={q}>{(list) => (
        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th className="num">Mínimo</th><th className="num">Stock</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.code}</td>
                  <td><Link to={`/inventario/${p.id}`}><strong>{p.name}</strong></Link></td>
                  <td>{p.category}</td>
                  <td className="num">{fmt(p.minStock)} <span className="unit">{p.unit === 'u' ? '' : p.unit}</span></td>
                  <td className="num">{fmt(p.total)}</td>
                  <td><StockBadge status={p.status} /></td>
                  <td className="actions-cell"><Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(p)}>Editar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}</Loadable>
      {editing && <ProductDialog product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

/* ------------------------------ Racks ------------------------------ */

function RacksTab() {
  const q = useWarehouseMap(1)
  const del = useDeleteRack()
  const toast = useToast()
  const [deleting, setDeleting] = useState<{ id: number; code: string } | null>(null)
  return (
    <Card title="Racks del almacén" actions={<LinkButton to="/disenador" size="sm" variant="primary" icon={Box}>Agregar desde el Cotizador 3D</LinkButton>} padded={false}>
      <Loadable query={q}>{(map) => (
        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead><tr><th>Rack</th><th>Estructura</th><th className="num">Posiciones</th><th className="num">Ocupadas</th><th>Medidas</th><th /></tr></thead>
            <tbody>
              {map.racks.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/almacen?rack=${r.id}`} className="mono strong">{r.code}</Link><span className="sub">Pasillo {r.aisle}</span></td>
                  <td>{r.modules} módulos × {r.levels} niveles × {r.slotsPerModule} por módulo</td>
                  <td className="num">{fmt(r.positions)}</td>
                  <td className="num">{fmt(r.occupied)}</td>
                  <td className="mono small">{fmt(r.lengthMm)} × {fmt(r.depthMm)} × {fmt(r.heightMm)} mm</td>
                  <td className="actions-cell">
                    <Button size="sm" variant="ghost" icon={Trash2} disabled={r.occupied > 0} title={r.occupied ? 'Tiene stock: mové la mercadería primero' : undefined} onClick={() => setDeleting({ id: r.id, code: r.code })}>Quitar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}</Loadable>
      <ConfirmDialog
        open={!!deleting} onClose={() => setDeleting(null)} title={`¿Quitar el rack ${deleting?.code}?`} tone="danger" confirmLabel="Quitar rack"
        loading={del.isPending} error={del.error?.message}
        onConfirm={() => del.mutate(deleting!.id, { onSuccess: () => { toast.ok(`Rack ${deleting!.code} quitado`); setDeleting(null) } })}
      >
        Sus posiciones dejan de existir en el mapa. El historial de movimientos se conserva.
      </ConfirmDialog>
    </Card>
  )
}

/* ------------------------------ Empresas ------------------------------ */

function CompaniesTab() {
  const q = useCompanies()
  const [creating, setCreating] = useState(false)
  return (
    <Card title="Empresas" actions={<Button variant="primary" size="sm" icon={Building2} onClick={() => setCreating(true)}>Nueva empresa</Button>} padded={false}>
      <Loadable query={q}>{(list) => (
        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead><tr><th>Empresa</th><th>Tipo</th><th>Sectores</th></tr></thead>
            <tbody>
              {list.map((c: Company) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.kind === 'interna' ? <Badge tone="red">Interna</Badge> : <Badge tone="blue">Cliente</Badge>}</td>
                  <td>{c.sectors.join(' · ') || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}</Loadable>
      {creating && <CompanyDialog onClose={() => setCreating(false)} />}
    </Card>
  )
}

function CompanyDialog({ onClose }: { onClose(): void }) {
  const create = useCreateCompany()
  const toast = useToast()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'cliente' | 'interna'>('cliente')
  const [sectors, setSectors] = useState('')
  return (
    <Dialog open onClose={onClose} title="Nueva empresa"
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button>
        <Button variant="primary" icon={Save} loading={create.isPending}
          onClick={() => create.mutate({ name, kind, sectors: sectors.split(',').map((s) => s.trim()) }, { onSuccess: (c) => { toast.ok(`${c.name} creada`); onClose() } })}>Crear</Button></>}>
      <Field label="Nombre">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Tipo">{() => <Segmented label="Tipo" value={kind} onChange={setKind} options={[{ value: 'cliente', label: 'Cliente' }, { value: 'interna', label: 'Interna' }]} />}</Field>
      <Field label="Sectores" hint="Separados por coma: Depósito, Compras, Planta 2" optional>{(id) => <Input id={id} value={sectors} onChange={(e) => setSectors(e.target.value)} />}</Field>
      <ErrorNote error={create.error} />
    </Dialog>
  )
}

/* ------------------------------ Presupuestos ------------------------------ */

const quoteNumber = (id: number) => `#${String(id).padStart(3, '0')}`

function QuotesTab() {
  const q = useQuotes()
  const [openId, setOpenId] = useState<number | null>(null)
  // se busca en la lista (no se guarda una copia) para ver el estado actualizado después de responder
  const open = q.data?.find((x) => x.id === openId) ?? null
  return (
    <Card title="Pedidos de presupuesto" actions={<LinkButton to="/disenador" size="sm" icon={Box}>Abrir el Cotizador 3D</LinkButton>} padded={false}>
      <Loadable query={q}>{(list) => list.length ? (
        <div className="table-wrap table-wrap--flush">
          <table className="table table--click">
            <thead><tr><th>N.º</th><th>Cliente</th><th>Rack pedido</th><th>Fecha</th><th>Estado</th></tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id} onClick={() => setOpenId(x.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(x.id)}>
                  <td className="mono strong">{quoteNumber(x.id)}</td>
                  <td><strong>{x.userName}</strong><span className="sub">{x.companyName}</span></td>
                  <td>{x.headline}</td>
                  <td className="nowrap">{fmtDateTime(x.createdAt)}</td>
                  <td>{x.status === 'nuevo' ? <Badge tone="red">Sin responder</Badge> : <Badge tone="green">Respondido</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon={Calculator} title="Todavía no hay pedidos de presupuesto">Los clientes los mandan desde el Cotizador 3D con el botón "Solicitar presupuesto".</EmptyState>}</Loadable>
      {open && <QuoteDialog quote={open} onClose={() => setOpenId(null)} />}
    </Card>
  )
}

function QuoteDialog({ quote, onClose }: { quote: Quote; onClose(): void }) {
  const answer = useAnswerQuote()
  const load = useDesigner((s) => s.load)
  const navigate = useNavigate()
  const toast = useToast()
  const subject = encodeURIComponent(`Presupuesto rack selectivo ${quoteNumber(quote.id)} · Sistemas de Carga S.A.`)
  return (
    <Dialog open onClose={onClose} title={`Presupuesto ${quoteNumber(quote.id)}`} width={640}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        <Button icon={Box} onClick={() => { load(quote.config); navigate('/disenador') }}>Ver en 3D</Button>
        {quote.status === 'nuevo' && (
          <Button variant="primary" icon={MailCheck} loading={answer.isPending}
            onClick={() => answer.mutate(quote.id, { onSuccess: () => toast.ok(`Listo: le avisamos a ${quote.userName} que respondimos su pedido`) })}>
            Marcar como respondido
          </Button>
        )}
      </>}>
      <KeyValue items={[
        ['Cliente', `${quote.userName} · ${quote.companyName}`],
        ['Email', <a key="mail" href={`mailto:${quote.userEmail}?subject=${subject}`}>{quote.userEmail}</a>],
        ['Pedido el', fmtDateTime(quote.createdAt)],
        ['Estado', quote.status === 'nuevo'
          ? <Badge key="st" tone="red">Sin responder</Badge>
          : `Respondido por ${quote.answeredBy ?? '—'}${quote.answeredAt ? ` el ${fmtDateTime(quote.answeredAt)}` : ''}`],
      ]} />
      {quote.comments && <blockquote className="quote-comments">{quote.comments}</blockquote>}
      <pre className="quote-summary">{quote.summary}</pre>
      <ErrorNote error={answer.error} />
    </Dialog>
  )
}
