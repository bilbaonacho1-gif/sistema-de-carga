/**
 * ADMINISTRACIÓN: los pedidos de acceso que llegaron y todos los usuarios. El administrador da el
 * acceso eligiendo el permiso, lo cambia cuando quiere, bloquea, le pone otra contraseña o elimina.
 */
import { KeyRound, Lock, RefreshCw, Trash2, Unlock, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../web/components/overlays'
import { Button, Field, Input, Select } from '../web/components/ui'
import { adminCreate, adminDelete, adminPassword, adminSet, adminUsers, CloudError, roleName, ROLES, useAuth, type AdminUser, type Role } from './cloud'

const say = (e: unknown) => (e instanceof CloudError ? e.message : 'No se pudo hacer.')
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca')

export function AdminSection() {
  const toast = useToast()
  const me = useAuth((s) => s.user)
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // el permiso elegido para cada pedido, antes de aprobarlo
  const [grant, setGrant] = useState<Record<string, Role>>({})
  const load = useCallback(async () => {
    try { setUsers(await adminUsers()); setError(null); void useAuth.getState().check() } catch (e) { setError(say(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  /** Hace un cambio, avisa y vuelve a traer la lista. */
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); toast.ok(done) } catch (e) { toast.error(say(e)) }
    await load()
  }
  const newPassword = (u: AdminUser) => {
    const pass = window.prompt(`Contraseña nueva para ${u.full_name} (al menos 5 caracteres). Se la tenés que pasar vos; al entrar el sistema le va a pedir que la cambie.`)
    if (pass === null) return
    void act(() => adminPassword(u.id, pass), `Contraseña de ${u.full_name} cambiada.`)
  }
  const remove = (u: AdminUser, asking = false) => {
    const extra = u.projects ? ` También se borran sus ${u.projects} proyectos guardados.` : ''
    if (!window.confirm(asking ? `¿Rechazar el pedido de ${u.full_name}?` : `¿Eliminar a ${u.full_name}? No va a poder entrar más.${extra}`)) return
    void act(() => adminDelete(u.id), asking ? 'Pedido rechazado.' : `${u.full_name} fue eliminado.`)
  }

  if (!users) return <div className="adm"><p className="muted">{error ?? 'Cargando los usuarios…'}</p>{error && <Button icon={RefreshCw} onClick={load}>Probar de nuevo</Button>}</div>
  const pending = users.filter((u) => u.status === 'pending')
  const rest = users.filter((u) => u.status !== 'pending')

  return (
    <div className="adm">
      <section className="adm__card">
        <header className="adm__head">
          <h2>Pedidos de acceso {pending.length > 0 && <span className="adm__count">{pending.length}</span>}</h2>
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={load}>Actualizar</Button>
        </header>
        {!pending.length && <p className="muted">No hay pedidos esperando. Cuando alguien pida entrar, aparece acá.</p>}
        {pending.map((u) => {
          const role = grant[u.id] ?? 'editor'
          return (
            <div key={u.id} className="adm__ask">
              <div className="adm__who">
                <strong>{u.full_name}</strong> quiere entrar al sistema
                <span>usuario <b>{u.username}</b> · pidió el {when(u.created_at)}</span>
                {u.note && <q>{u.note}</q>}
              </div>
              <div className="adm__grant">
                <Field label="¿Qué permiso le das?" hint={ROLES.find((r) => r.id === role)?.what}>{(id) => (
                  <Select id={id} value={role} onChange={(e) => setGrant({ ...grant, [u.id]: e.target.value as Role })}>
                    {ROLES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </Select>
                )}</Field>
                <div className="adm__btns">
                  <Button variant="primary" icon={UserCheck} onClick={() => act(() => adminSet(u.id, { role, status: 'active' }), `${u.full_name} ya puede entrar (${roleName(role)}).`)}>Dar acceso</Button>
                  <Button icon={UserX} onClick={() => remove(u, true)}>Rechazar</Button>
                </div>
              </div>
            </div>
          )
        })}
      </section>

      <section className="adm__card">
        <header className="adm__head"><h2>Usuarios</h2><span className="muted small">{rest.length} con usuario</span></header>
        <div className="adm__list">
          {rest.map((u) => {
            const self = u.id === me?.id
            return (
              <div key={u.id} className={`adm__user${u.status === 'blocked' ? ' is-blocked' : ''}`}>
                <div className="adm__who">
                  <strong>{u.full_name}{self && <em> (vos)</em>}</strong>
                  <span>usuario <b>{u.username}</b> · entró por última vez: {when(u.last_login)} · {u.projects === 1 ? '1 proyecto' : `${u.projects} proyectos`}</span>
                  {u.status === 'blocked' && <span className="adm__tag adm__tag--red">Bloqueado: no puede entrar</span>}
                  {u.must_change && u.status === 'active' && <span className="adm__tag">Todavía usa la contraseña que le pusieron</span>}
                </div>
                <div className="adm__ctl">
                  <Select aria-label={`Permiso de ${u.full_name}`} value={u.role} disabled={self}
                    onChange={(e) => act(() => adminSet(u.id, { role: e.target.value as Role }), `${u.full_name} ahora es ${roleName(e.target.value as Role)}.`)}>
                    {ROLES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </Select>
                  {!self && (u.status === 'blocked'
                    ? <Button size="sm" icon={Unlock} onClick={() => act(() => adminSet(u.id, { status: 'active' }), `${u.full_name} puede entrar de nuevo.`)}>Desbloquear</Button>
                    : <Button size="sm" icon={Lock} onClick={() => act(() => adminSet(u.id, { status: 'blocked' }), `${u.full_name} quedó bloqueado.`)}>Bloquear</Button>)}
                  <Button size="sm" icon={KeyRound} onClick={() => newPassword(u)}>Contraseña</Button>
                  {!self && <Button size="sm" icon={Trash2} onClick={() => remove(u)}>Eliminar</Button>}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <div className="adm__cols">
        <NewUser onDone={load} />
        <section className="adm__card">
          <header className="adm__head"><h2>Qué puede hacer cada permiso</h2></header>
          <dl className="adm__roles">{ROLES.map((r) => <div key={r.id}><dt>{r.name}</dt><dd>{r.what}</dd></div>)}</dl>
        </section>
      </div>
    </div>
  )
}

/** Crear un usuario ya con acceso, sin esperar a que lo pida. */
function NewUser({ onDone }: { onDone(): void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [busy, setBusy] = useState(false)
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await adminCreate(name, user, pass, role)
      toast.ok(`${name.trim()} ya puede entrar. Pasale su usuario y su contraseña.`)
      setName(''); setUser(''); setPass('')
      onDone()
    } catch (err) { toast.error(say(err)) } finally { setBusy(false) }
  }
  return (
    <section className="adm__card">
      <header className="adm__head"><h2>Agregar un usuario</h2></header>
      <form className="adm__new" onSubmit={create}>
        <Field label="Nombre y apellido">{(id) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Usuario">{(id) => <Input id={id} value={user} maxLength={30} onChange={(e) => setUser(e.target.value)} autoComplete="off" />}</Field>
        <Field label="Contraseña para empezar" hint="Al entrar, el sistema le pide que la cambie.">{(id) => <Input id={id} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />}</Field>
        <Field label="Permiso">{(id) => (
          <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
        )}</Field>
        <Button variant="primary" icon={UserPlus} type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear usuario'}</Button>
      </form>
    </section>
  )
}
