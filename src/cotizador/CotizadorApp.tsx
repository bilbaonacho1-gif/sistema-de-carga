/**
 * Pantalla del Sistema de depósitos: primero el ingreso con usuario y contraseña; adentro, el
 * encabezado con las solapas (Depósito, Mis piezas, Proyectos y, para el administrador,
 * Administración), el proyecto abierto y el menú del usuario.
 */
import { Compass, FolderOpen, KeyRound, LifeBuoy, LogOut, RotateCcw, Shapes, ShieldCheck, UserRound, Warehouse } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Logo } from '../web/components/Logo'
import { Button } from '../web/components/ui'
import { usePlan } from '../web/plan/planStore'
import { useToast } from '../web/components/overlays'
import { AdminSection } from './Admin'
import { Assistant } from './Assistant'
import { canEdit, CloudError, codeFrom, roleName, useAuth } from './cloud'
import { LoginScreen, PasswordDialog } from './Login'
import { ProjectsSection } from './Projects'
import { clearWork, hasWork, openByCode, saveNow, useAutosave, useProject } from './projects'
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
