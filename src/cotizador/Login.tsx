/**
 * INGRESO: usuario y contraseña. Quien no tiene usuario pide acceso; el pedido le llega al
 * administrador, que decide qué permiso darle.
 */
import { KeyRound, LogIn, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Logo } from '../web/components/Logo'
import { Dialog, useToast } from '../web/components/overlays'
import { Button, Field, Input, Textarea } from '../web/components/ui'
import { changePassword, CloudError, requestAccess, useAuth } from './cloud'

const say = (e: unknown) => (e instanceof CloudError ? e.message : 'Algo salió mal. Probá de nuevo.')

export function LoginScreen() {
  const { state, login, check } = useAuth()
  const [mode, setMode] = useState<'entrar' | 'pedir' | 'pedido'>('entrar')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [name, setName] = useState('')
  const [pass2, setPass2] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const enter = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user.trim() || !pass) { setError('Escribí tu usuario y tu contraseña.'); return }
    setBusy(true); setError(null)
    try { await login(user, pass) } catch (err) { setError(say(err)) } finally { setBusy(false) }
  }
  const ask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pass !== pass2) { setError('Las dos contraseñas no son iguales.'); return }
    setBusy(true); setError(null)
    try { await requestAccess(name, user, pass, note); setMode('pedido') } catch (err) { setError(say(err)) } finally { setBusy(false) }
  }
  const go = (m: 'entrar' | 'pedir') => { setMode(m); setError(null); setPass(''); setPass2('') }

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__brand">
          <Logo size={52} />
          <div><span className="cz-top__eyebrow">Sistemas de Carga S.A.</span><h1>Sistema de depósitos</h1></div>
        </div>

        {state === 'checking' && <p className="muted">Entrando…</p>}

        {state === 'offline' && <>
          <p className="note note--amber">No se pudo conectar con el servidor de usuarios. Revisá internet y probá de nuevo.</p>
          <Button variant="primary" onClick={() => { useAuth.setState({ state: 'checking' }); void check() }} block>Probar de nuevo</Button>
        </>}

        {state === 'out' && mode === 'entrar' && (
          <form className="login__form" onSubmit={enter}>
            <Field label="Usuario" hint="Tu usuario o tu nombre y apellido.">{(id) => <Input id={id} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoFocus />}</Field>
            <Field label="Contraseña">{(id) => <Input id={id} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />}</Field>
            {error && <p className="login__error" role="alert">{error}</p>}
            <Button variant="primary" icon={LogIn} type="submit" disabled={busy} block>{busy ? 'Entrando…' : 'Entrar'}</Button>
            <button type="button" className="link-btn login__alt" onClick={() => go('pedir')}>No tengo usuario: pedir acceso</button>
          </form>
        )}

        {state === 'out' && mode === 'pedir' && (
          <form className="login__form" onSubmit={ask}>
            <p className="muted small">Completá tus datos. El pedido le llega al administrador, que te da el acceso. Cuando te avise, entrás con este usuario y esta contraseña.</p>
            <Field label="Nombre y apellido">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} autoFocus />}</Field>
            <Field label="Usuario que querés usar" hint="Por ejemplo tu nombre: juan.perez">{(id) => <Input id={id} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" maxLength={30} />}</Field>
            <Field label="Contraseña" hint="Al menos 5 caracteres.">{(id) => <Input id={id} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />}</Field>
            <Field label="Repetí la contraseña">{(id) => <Input id={id} type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />}</Field>
            <Field label="Mensaje para el administrador" optional>{(id) => <Textarea id={id} rows={2} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Quién sos o para qué lo necesitás" />}</Field>
            {error && <p className="login__error" role="alert">{error}</p>}
            <Button variant="primary" icon={UserPlus} type="submit" disabled={busy} block>{busy ? 'Enviando…' : 'Pedir acceso'}</Button>
            <button type="button" className="link-btn login__alt" onClick={() => go('entrar')}>Ya tengo usuario: entrar</button>
          </form>
        )}

        {state === 'out' && mode === 'pedido' && (
          <div className="login__form">
            <p className="note note--blue"><b>Pedido enviado.</b> El administrador lo va a ver en el sistema y te va a dar el acceso. Cuando te avise, entrá con el usuario <b>{user.trim()}</b> y la contraseña que elegiste.</p>
            <Button onClick={() => go('entrar')} block>Volver a la entrada</Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Cambiar la contraseña propia. Con `first`, es el aviso de que todavía usa la que le pusieron. */
export function PasswordDialog({ first, onClose }: { first?: boolean; onClose(): void }) {
  const toast = useToast()
  const [old, setOld] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (next !== again) { setError('Las dos contraseñas nuevas no son iguales.'); return }
    setBusy(true); setError(null)
    try { await changePassword(old, next); toast.ok('Contraseña cambiada.'); onClose() } catch (e) { setError(say(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} title="Cambiar la contraseña" width={440}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{first ? 'Más tarde' : 'Cancelar'}</Button>
        <Button variant="primary" icon={KeyRound} onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Cambiar'}</Button>
      </>}>
      <div className="login__form">
        {first && <p className="note note--amber">Todavía estás usando la contraseña que te pusieron. Te conviene cambiarla por una que sepas solo vos.</p>}
        <Field label="Contraseña actual">{(id) => <Input id={id} type="password" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" autoFocus />}</Field>
        <Field label="Contraseña nueva" hint="Al menos 5 caracteres.">{(id) => <Input id={id} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />}</Field>
        <Field label="Repetí la nueva">{(id) => <Input id={id} type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />}</Field>
        {error && <p className="login__error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}
