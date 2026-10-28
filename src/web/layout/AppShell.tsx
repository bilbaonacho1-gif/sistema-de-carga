/**
 * Marco de la aplicación.
 *  - Computadora: barra lateral con las fases (1 Pedidos · 2 Almacén · 3 Control).
 *  - Tablet: barra lateral angosta, sólo íconos.
 *  - Celular: barra superior + navegación inferior con "Más".
 */
import { Bell, LogOut, Menu, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { ROLE_LABEL } from '../../shared/permissions'
import { API_MODE } from '../api/client'
import { useNotifications } from '../api/queries'
import { useAuth } from '../auth/AuthContext'
import { Logo } from '../components/Logo'
import { NotificationsPanel } from '../components/NotificationsPanel'
import { ConfirmDialog, Sheet } from '../components/overlays'
import { Avatar, IconButton, LinkButton } from '../components/ui'
import { useIsMobile } from '../lib/useMediaQuery'
import { MOBILE_PRIORITY, NAV, type NavItem } from './nav'

export function AppShell({ children }: { children: ReactNode }) {
  const { session, can, logout } = useAuth()
  const user = session!.user
  const isMobile = useIsMobile()
  const location = useLocation()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const notifications = useNotifications()
  const unread = notifications.data?.unread ?? 0

  useEffect(() => { setMoreOpen(false); setNotifOpen(false) }, [location.pathname])

  const allowed = (i: NavItem) => !i.perm || i.perm.some((p) => can(p))
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length)
  const flat = groups.flatMap((g) => g.items)
  const mobileItems = MOBILE_PRIORITY.map((to) => flat.find((i) => i.to === to)).filter((i): i is NavItem => !!i).slice(0, 4)

  const [resetOpen, setResetOpen] = useState(false)
  const resetDemo = () => setResetOpen(true)
  const doReset = async () => {
    if (__API_MODE__ !== 'local') return
    const { resetBrowserData } = await import('../../server/browser')
    await resetBrowserData()
    await logout()
    window.location.reload()
  }

  const userCard = (
    <div className="user-card">
      <Avatar name={user.name} />
      <div className="user-card__text">
        <strong>{user.name}</strong>
        <span>{ROLE_LABEL[user.role]}</span>
      </div>
    </div>
  )

  return (
    <div className="shell">
      {!isMobile && (
        <aside className="sidebar" aria-label="Navegación principal">
          <NavLink to="/" className="sidebar__brand" aria-label="Inicio">
            <Logo size={44} />
            <span className="sidebar__brand-text">
              <strong>Gestión</strong>
              <small>Pedidos · Almacén · Control</small>
            </span>
          </NavLink>
          <nav className="sidebar__nav">
            {groups.map((g, gi) => (
              <div key={gi} className={`nav-group${g.phase ? ` phase-${g.phase}` : ''}`}>
                {g.label && (
                  <span className="nav-group__label">
                    {g.phase && <b>{g.phase}</b>}
                    {g.label}
                  </span>
                )}
                {g.items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end} className="nav-link" title={i.label}>
                    <i.icon size={19} aria-hidden />
                    <span>{i.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar__foot">
            {userCard}
            {API_MODE === 'local' && (
              <button type="button" className="nav-link nav-link--small" onClick={resetDemo} title="Restablecer demo">
                <RotateCcw size={17} aria-hidden /><span>Restablecer demo</span>
              </button>
            )}
            <button type="button" className="nav-link nav-link--small" onClick={() => logout()} title="Cerrar sesión">
              <LogOut size={17} aria-hidden /><span>Cerrar sesión</span>
            </button>
          </div>
        </aside>
      )}

      <div className="shell__main">
        <header className="topbar">
          {isMobile && (
            <NavLink to="/" className="topbar__brand" aria-label="Inicio">
              <Logo size={34} />
              <span>Gestión</span>
            </NavLink>
          )}
          <div className="topbar__spacer" />
          {can('pedidos.crear') && !location.pathname.startsWith('/pedidos/nuevo') && (
            isMobile
              ? <IconButton icon={Plus} label="Nuevo pedido" onClick={() => navigate('/pedidos/nuevo')} className="icon-btn--accent" />
              : <LinkButton to="/pedidos/nuevo" variant="primary" icon={Plus} size="sm">Nuevo pedido</LinkButton>
          )}
          <IconButton icon={Bell} label={unread ? `Notificaciones (${unread} sin leer)` : 'Notificaciones'} badge={unread} onClick={() => setNotifOpen(true)} />
        </header>
        <main className="content" id="main">{children}</main>
      </div>

      {isMobile && (
        <nav className="bottom-nav" aria-label="Navegación principal">
          {mobileItems.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className="bottom-nav__item">
              <i.icon size={22} aria-hidden />
              <span>{i.label}</span>
            </NavLink>
          ))}
          <button type="button" className={`bottom-nav__item${moreOpen ? ' active' : ''}`} onClick={() => setMoreOpen(true)}>
            <Menu size={22} aria-hidden />
            <span>Más</span>
          </button>
        </nav>
      )}

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Más opciones">
        {userCard}
        <div className="more-grid">
          {groups.map((g) => g.items.filter((i) => !mobileItems.includes(i)).map((i) => (
            <NavLink key={i.to} to={i.to} className={`more-link${g.phase ? ` phase-${g.phase}` : ''}`}>
              <i.icon size={22} aria-hidden />
              <span>{i.label}</span>
              {g.phase && <small>Fase {g.phase} · {g.label}</small>}
            </NavLink>
          )))}
        </div>
        <div className="more-actions">
          {API_MODE === 'local' && <button type="button" className="nav-link" onClick={resetDemo}><RotateCcw size={18} /><span>Restablecer demo</span></button>}
          <button type="button" className="nav-link" onClick={() => logout()}><LogOut size={18} /><span>Cerrar sesión</span></button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={doReset}
        title="¿Restablecer la demo?"
        confirmLabel="Restablecer demo"
        tone="danger"
      >
        Se borran los pedidos, movimientos y cambios hechos en este navegador y se vuelve a cargar la demostración inicial.
      </ConfirmDialog>

      <Sheet open={notifOpen} onClose={() => setNotifOpen(false)} title="Notificaciones" eyebrow={unread ? `${unread} sin leer` : 'Al día'}>
        <NotificationsPanel onNavigate={() => setNotifOpen(false)} />
      </Sheet>
    </div>
  )
}
