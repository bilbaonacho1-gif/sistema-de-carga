import { ArrowRight, ClipboardList, ScanLine, Warehouse } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Role } from '../../shared/types'
import { useDemoUsers, useLogin } from '../api/queries'
import { useAuth } from '../auth/AuthContext'
import { Logo } from '../components/Logo'
import { UprightStrip } from '../components/UprightStrip'
import { Avatar, Button, ErrorNote, Field, Input } from '../components/ui'

const ROLE_HINT: Record<Role, string> = {
  admin: 'Ve todo, gestiona usuarios y productos',
  encargado: 'Aprueba, ubica stock, hace conteos',
  operario: 'Prepara los pedidos asignados',
  cliente: 'Pide materiales y sigue sus pedidos',
}

export function LoginPage() {
  const { login } = useAuth()
  const demo = useDemoUsers()
  const mutation = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submit = (e?: FormEvent, creds = { email, password }) => {
    e?.preventDefault()
    mutation.mutate(creds, { onSuccess: login })
  }

  return (
    <div className="login">
      <section className="login__brand">
        <UprightStrip className="login__strip" />
        <div className="login__brand-inner">
          <div className="login__logo"><Logo size={120} /></div>
          <h1>Pedidos, almacén e inventario en un solo lugar.</h1>
          <ol className="login__phases">
            <li className="phase-1"><ClipboardList size={20} aria-hidden /><div><b>1 · Pedidos</b><span>Solicitá materiales y seguí cada estado hasta la entrega.</span></div></li>
            <li className="phase-2"><Warehouse size={20} aria-hidden /><div><b>2 · Almacén</b><span>Cada producto en su rack, nivel y posición.</span></div></li>
            <li className="phase-3"><ScanLine size={20} aria-hidden /><div><b>3 · Control</b><span>Conteos, diferencias e historial de todo lo que pasa.</span></div></li>
          </ol>
        </div>
      </section>

      <section className="login__panel">
        <form className="login__form" onSubmit={submit}>
          <div className="login__mobile-logo"><Logo size={72} /></div>
          <h2>Ingresar</h2>
          <p className="muted">Sistemas de Carga S.A. · Gestión</p>
          <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
          <Field label="Contraseña">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
          <ErrorNote error={mutation.error} />
          <Button type="submit" variant="primary" size="lg" block loading={mutation.isPending} icon={ArrowRight}>Ingresar</Button>
        </form>

        {!!demo.data?.users.length && (
          <div className="demo-accounts">
            <h3>Cuentas de demostración</h3>
            <p className="muted">Entrá con un perfil para ver qué puede hacer cada uno. Contraseña: <code>{demo.data.password}</code></p>
            <ul>
              {demo.data.users.map((u) => (
                <li key={u.email}>
                  <button
                    type="button"
                    className="demo-account"
                    disabled={mutation.isPending}
                    onClick={() => { setEmail(u.email); setPassword(demo.data!.password!); submit(undefined, { email: u.email, password: demo.data!.password! }) }}
                  >
                    <Avatar name={u.name} size={36} />
                    <span className="demo-account__text">
                      <strong>{u.name}</strong>
                      <span>{u.roleLabel} · {u.sector}</span>
                      <small>{ROLE_HINT[u.role]}</small>
                    </span>
                    <ArrowRight size={18} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
