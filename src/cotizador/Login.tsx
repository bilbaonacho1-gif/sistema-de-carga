/**
 * INGRESO: usuario y contraseña. Quien no tiene usuario pide acceso; el pedido le llega al
 * administrador, que decide qué permiso darle.
 */
import { ClipboardList, Eye, EyeOff, FolderOpen, KeyRound, LayoutGrid, LogIn, MailCheck, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Logo } from '../web/components/Logo'
import { Dialog, useToast } from '../web/components/overlays'
import { Button, Field, Input, Textarea } from '../web/components/ui'
import { changePassword, CloudError, requestAccess, useAuth } from './cloud'
import { RackDrawing } from './Intro'

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

  const titles = { entrar: ['Entrar', 'Con tu usuario y tu contraseña.'], pedir: ['Pedir acceso', 'Completá tus datos: el administrador te da el acceso.'], pedido: ['Pedido enviado', ''] }[mode]

  return (
    <div className="acc">
      {/* el lado de la marca: qué es el sistema, con un rack que se dibuja solo */}
      <aside className="acc__side">
        <div className="acc__side-in">
          <div className="acc__brand"><Logo size={56} /><span>Sistemas de Carga S.A.</span></div>
          <h1>Sistema de depósitos</h1>
          <p>Dibujá el depósito, mirá cuántos racks entran en 3D y llevate la lista de materiales.</p>
          <RackDrawing />
          <ul className="acc__points">
            <li><LayoutGrid size={18} aria-hidden /> Plano y 3D del depósito, con sus medidas</li>
            <li><ClipboardList size={18} aria-hidden /> Lista de materiales al instante</li>
            <li><FolderOpen size={18} aria-hidden /> Tus proyectos guardados, desde cualquier computadora</li>
          </ul>
        </div>
      </aside>

      <main className="acc__main">
        <div className="acc__box">
          <div className="acc__mobile"><Logo size={48} /><span>Sistema de depósitos</span></div>

          {state === 'checking' && <p className="acc__wait">Entrando…</p>}

          {state === 'offline' && <>
            <h2>Sin conexión</h2>
            <p className="note note--amber">No se pudo conectar con el servidor de usuarios. Revisá internet y probá de nuevo.</p>
            <Button variant="primary" size="lg" onClick={() => { useAuth.setState({ state: 'checking' }); void check() }} block>Probar de nuevo</Button>
          </>}

          {state === 'out' && <>
            <h2>{titles[0]}</h2>
            {titles[1] && <p className="acc__sub">{titles[1]}</p>}
          </>}

          {state === 'out' && mode === 'entrar' && (
            <form className="acc__form" onSubmit={enter}>
              <Field label="Usuario" hint="Tu usuario o tu nombre y apellido.">{(id) => <Input id={id} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoFocus />}</Field>
              <Field label="Contraseña">{(id) => <Secret id={id} value={pass} onChange={setPass} autoComplete="current-password" />}</Field>
              {error && <p className="acc__error" role="alert">{error}</p>}
              <Button variant="primary" size="lg" icon={LogIn} type="submit" disabled={busy} block>{busy ? 'Entrando…' : 'Entrar'}</Button>
              <p className="acc__alt">¿No tenés usuario? <button type="button" className="link-btn" onClick={() => go('pedir')}>Pedí acceso</button></p>
            </form>
          )}

          {state === 'out' && mode === 'pedir' && (
            <form className="acc__form" onSubmit={ask}>
              <Field label="Nombre y apellido">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} autoFocus />}</Field>
              <Field label="Usuario que querés usar" hint="Por ejemplo tu nombre: juan.perez">{(id) => <Input id={id} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" maxLength={30} />}</Field>
              <div className="acc__two">
                <Field label="Contraseña" hint="Al menos 5 caracteres.">{(id) => <Secret id={id} value={pass} onChange={setPass} autoComplete="new-password" />}</Field>
                <Field label="Repetila">{(id) => <Secret id={id} value={pass2} onChange={setPass2} autoComplete="new-password" />}</Field>
              </div>
              <Field label="Mensaje para el administrador" optional>{(id) => <Textarea id={id} rows={2} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Quién sos o para qué lo necesitás" />}</Field>
              {error && <p className="acc__error" role="alert">{error}</p>}
              <Button variant="primary" size="lg" icon={UserPlus} type="submit" disabled={busy} block>{busy ? 'Enviando…' : 'Pedir acceso'}</Button>
              <p className="acc__alt">¿Ya tenés usuario? <button type="button" className="link-btn" onClick={() => go('entrar')}>Entrá</button></p>
            </form>
          )}

          {state === 'out' && mode === 'pedido' && (
            <div className="acc__form">
              <div className="acc__done"><MailCheck size={30} aria-hidden /></div>
              <p className="acc__sub">El administrador lo va a ver en el sistema y te va a dar el acceso. Cuando te avise, entrá con el usuario <b>{user.trim()}</b> y la contraseña que elegiste.</p>
              <Button size="lg" onClick={() => go('entrar')} block>Volver a la entrada</Button>
            </div>
          )}
        </div>
        <p className="acc__foot">Sistemas de Carga S.A. · Uso interno</p>
      </main>
    </div>
  )
}

/** Campo de contraseña con el ojito para verla mientras se escribe. */
function Secret({ id, value, onChange, autoComplete }: { id: string; value: string; onChange(v: string): void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="acc__secret">
      <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar la contraseña' : 'Ver la contraseña'} title={show ? 'Ocultar' : 'Ver'}>
        {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
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
      <div className="acc__form">
        {first && <p className="note note--amber">Todavía estás usando la contraseña que te pusieron. Te conviene cambiarla por una que sepas solo vos.</p>}
        <Field label="Contraseña actual">{(id) => <Input id={id} type="password" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" autoFocus />}</Field>
        <Field label="Contraseña nueva" hint="Al menos 5 caracteres.">{(id) => <Input id={id} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />}</Field>
        <Field label="Repetí la nueva">{(id) => <Input id={id} type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />}</Field>
        {error && <p className="acc__error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}
