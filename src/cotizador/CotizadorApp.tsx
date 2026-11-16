/**
 * Pantalla del Sistema de depósitos: primero el ingreso con usuario y contraseña; adentro, el
 * encabezado con las solapas (Depósito, Mis piezas, Proyectos y, para el administrador,
 * Administración), el proyecto abierto y el menú del usuario.
 */
import { Compass, FolderOpen, KeyRound, LifeBuoy, LogOut, RotateCcw, Save, Shapes, ShieldCheck, UserRound, Warehouse } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Logo } from '../web/components/Logo'
import { Button, Field, Input } from '../web/components/ui'
import { usePlan } from '../web/plan/planStore'
import { Dialog, useToast } from '../web/components/overlays'
import { AdminSection } from './Admin'
import { Assistant } from './Assistant'
import { canEdit, CloudError, codeFrom, roleName, useAuth } from './cloud'
import { LoginScreen, PasswordDialog } from './Login'
import { ProjectsSection } from './Projects'
import { clearWork, hasWork, openByCode, requestSave, saveAsNew, saveNow, useAutosave, useProject } from './projects'
import { DepotFlow } from './DepotFlow'
import { Intro, useIntro } from './Intro'
import { PiecesSection } from './PiecesSection'
import { Tour, tourSeen } from './Tour'

const STATUS = { saved: 'guardado', dirty: 'sin guardar', saving: 'guardando…', error: 'no se guardó' }

/** La puerta: sin sesión se ve el ingreso; con sesión, el sistema. */
export function CotizadorApp() {
  const state = useAuth((x) => x.state)
  useEffect(() => { void useAuth.getState().check() }, [])
  return state === 'in' ? <Inside /> : <LoginScreen />
}

function Inside() {
  const toast = useToast()
  const user = useAuth((x) => x.user)!
  const pending = useAuth((x) => x.pending)
  const admin = user.role === 'admin'
  const section = usePlan((x) => x.section)
  const setSection = usePlan((x) => x.setSection)
  const project = useProject()
  const [intro, closeIntro] = useIntro()
  // recorrido guiado: la primera vez, apenas se cierra la intro; después, con el botón "Recorrido"
  const [tour, setTour] = useState(false)
  const [helper, setHelper] = useState(false)
  const [menu, setMenu] = useState(false)
  // cambiar la contraseña: a pedido, o como aviso mientras siga usando la que le pusieron
  const [password, setPassword] = useState<'no' | 'first' | 'asked'>(() => {
    let later = false
    try { later = sessionStorage.getItem('sdc-clave-despues') === '1' } catch { /* sin memoria */ }
    return user.must_change && !later ? 'first' : 'no'
  })
  const closePassword = () => { try { sessionStorage.setItem('sdc-clave-despues', '1') } catch { /* sin memoria */ } setPassword('no') }
  const startApp = () => { closeIntro(); if (!tourSeen()) setTimeout(() => setTour(true), 350) }

  useAutosave()
  // cada tanto se revisa la sesión (si lo bloquearon, sale) y, para el administrador, si llegaron pedidos de acceso
  const seen = useRef(pending)
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void useAuth.getState().check() }, 45_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (admin && pending > seen.current) toast.ok(pending === 1 ? 'Una persona pide entrar al sistema. Mirá en Administración.' : `${pending} personas piden entrar al sistema. Mirá en Administración.`)
    seen.current = pending
  }, [pending, admin, toast])
  // si no es administrador, no queda parado en esa solapa
  useEffect(() => { if (section === 'admin' && !admin) setSection('deposito') }, [section, admin, setSection])
  // un link de proyecto compartido (…?proyecto=CÓDIGO): se abre al entrar
  useEffect(() => {
    const code = codeFrom(new URLSearchParams(window.location.search).get('proyecto') ?? '')
    if (code.length !== 8) return
    window.history.replaceState(null, '', window.location.pathname)
    const p = useProject.getState()
    if (!p.current && !p.shared && hasWork() && !window.confirm('Te compartieron un proyecto. Para abrirlo se reemplaza lo que tenés armado ahora, que no está guardado. ¿Abrirlo?')) return
    void (async () => {
      try { await saveNow(); const r = await openByCode(code); toast.ok(r.mine ? `Abriste tu proyecto "${r.name}".` : `Abriste "${r.name}", de ${r.owner}.`) }
      catch (e) { toast.error(e instanceof CloudError ? e.message : 'No se pudo abrir el proyecto.') }
    })()
  }, [toast])

  const reset = () => {
    if (!window.confirm(project.current ? `¿Empezar de nuevo? Se cierra "${project.current.name}" (queda guardado) y la pantalla queda en blanco.` : '¿Empezar de nuevo? Se borran el plano y el rack.')) return
    void (async () => { await saveNow(); clearWork() })()
  }
  const logout = () => {
    const p = useProject.getState()
    if (!p.current && hasWork() && !window.confirm('Lo que tenés armado no está guardado en ningún proyecto y se va a perder al salir. ¿Salir igual?')) return
    void (async () => { await saveNow(); clearWork(); await useAuth.getState().logout() })()
  }
  const tab = (id: typeof section, label: string, Icon: typeof Warehouse, badge = 0) => (
    <button type="button" className={section === id ? 'is-on' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
      <Icon size={15} aria-hidden /> {label}{badge > 0 && <span className="cz-badge" aria-label={`${badge} pedidos de acceso`}>{badge}</span>}
    </button>
  )
  return (
    <div className="cz">
      <header className="cz-top">
        <Logo size={44} />
        <div className="cz-top__title">
          <span className="cz-top__eyebrow">Sistemas de Carga S.A.</span>
          <h1>Sistema<span className="cz-long"> de depósitos</span></h1>
        </div>
        <nav className="cz-tabs" aria-label="Secciones">
          {tab('deposito', 'Depósito', Warehouse)}
          {tab('piezas', 'Mis piezas', Shapes)}
          {tab('proyectos', 'Proyectos', FolderOpen)}
          {admin && tab('admin', 'Administración', ShieldCheck, pending)}
        </nav>
        {/* el proyecto abierto y si está guardado */}
        {(project.current || project.shared) && (
          <button type="button" className={`cz-proj cz-proj--${project.current ? project.status : 'shared'}`} onClick={() => setSection('proyectos')} title="Ver mis proyectos">
            <strong>{project.current?.name ?? project.shared?.name}</strong>
            <span>{project.current ? STATUS[project.status] : `copia de ${project.shared?.owner}`}</span>
          </button>
        )}
        <div className="cz-top__actions">
          <SaveControl />
          <Button variant={helper ? 'secondary' : 'ghost'} icon={LifeBuoy} onClick={() => setHelper((v) => !v)} aria-pressed={helper}><span className="cz-long">Ayudante</span></Button>
          <Button variant="ghost" icon={Compass} onClick={() => { setSection('deposito'); setTour(true) }}><span className="cz-long">Recorrido</span></Button>
          <Button variant="ghost" icon={RotateCcw} onClick={reset}><span className="cz-long">Empezar de nuevo</span></Button>
          <div className="cz-user">
            <Button variant="ghost" icon={UserRound} onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-haspopup="menu"><span className="cz-long">{user.full_name.split(' ')[0]}</span></Button>
            {menu && <>
              <div className="cz-user__veil" onClick={() => setMenu(false)} />
              <div className="cz-user__menu" role="menu">
                <div className="cz-user__who"><strong>{user.full_name}</strong><span>usuario {user.username} · {roleName(user.role)}</span></div>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); setPassword('asked') }}><KeyRound size={15} aria-hidden /> Cambiar la contraseña</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); logout() }}><LogOut size={15} aria-hidden /> Salir</button>
              </div>
            </>}
          </div>
        </div>
      </header>
      <main className="cz-main">
        {section === 'piezas' ? <PiecesSection /> : section === 'proyectos' ? <ProjectsSection /> : section === 'admin' && admin ? <AdminSection /> : <DepotFlow />}
        {section === 'deposito' && !canEdit(user) && <p className="cz-viewer">Tu usuario es de solo ver: podés mirar y probar, pero no guardar proyectos.</p>}
      </main>
      <Assistant open={helper} onClose={() => setHelper(false)} />
      {intro && <Intro onStart={startApp} />}
      {tour && <Tour onClose={() => setTour(false)} />}
      {password !== 'no' && <PasswordDialog first={password === 'first'} onClose={closePassword} />}
    </div>
  )
}

/**
 * Guardar: el botón del encabezado, Ctrl+S y el botón del Resumen hacen lo mismo. Con un proyecto
 * abierto lo guarda ya; si lo que hay en pantalla todavía no es un proyecto, pregunta el nombre.
 */
function SaveControl() {
  const toast = useToast()
  const user = useAuth((x) => x.user)
  const { current, status, saveTick } = useProject()
  const drawn = usePlan((x) => x.plan.outline.points.length >= 3)
  const [asking, setAsking] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const seen = useRef(saveTick)
  const allowed = canEdit(user)
  useEffect(() => {
    if (saveTick === seen.current) return
    seen.current = saveTick
    if (!allowed) { toast.error('Tu usuario es de solo ver: no puede guardar proyectos.'); return }
    if (useProject.getState().current) void saveNow().then((ok) => (ok ? toast.ok('Guardado.') : toast.error(useProject.getState().error ?? 'No se pudo guardar.')))
    else if (!hasWork()) toast.error('Todavía no hay nada para guardar: primero creá el depósito.')
    else setAsking(true)
  }, [saveTick, allowed, toast])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); requestSave() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!allowed) return null
  // hay algo sin guardar: cambios del proyecto abierto, o un depósito que todavía no es un proyecto
  const pending = current ? status !== 'saved' : drawn
  const create = async () => {
    setBusy(true)
    try { await saveAsNew(name); toast.ok(`Proyecto "${name.trim()}" guardado. Desde ahora los cambios se guardan solos.`); setName(''); setAsking(false) }
    catch (e) { toast.error(e instanceof CloudError ? e.message : 'No se pudo guardar.') } finally { setBusy(false) }
  }
  return (
    <>
      <Button variant={pending ? 'secondary' : 'ghost'} icon={Save} onClick={requestSave} title="Guardar (Ctrl+S)" className={pending ? 'cz-save is-pending' : 'cz-save'}>
        <span className="cz-long">Guardar</span>
      </Button>
      {asking && (
        <Dialog open onClose={() => setAsking(false)} title="Guardar como proyecto" width={440}
          footer={<>
            <Button variant="ghost" onClick={() => setAsking(false)}>Cancelar</Button>
            <Button variant="primary" icon={Save} onClick={create} disabled={busy || !name.trim()}>{busy ? 'Guardando…' : 'Guardar'}</Button>
          </>}>
          <form className="acc__form" style={{ marginTop: 0 }} onSubmit={(e) => { e.preventDefault(); if (name.trim() && !busy) void create() }}>
            <p className="muted small" style={{ margin: 0 }}>Ponele un nombre. Queda en tu cuenta, en la solapa Proyectos, y desde ahí los cambios se guardan solos.</p>
            <Field label="Nombre del proyecto">{(id) => <Input id={id} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ej. Depósito Pérez" autoFocus />}</Field>
          </form>
        </Dialog>
      )}
    </>
  )
}
