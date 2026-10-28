import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import type { Permission } from '../shared/permissions'
import { useAuth } from './auth/AuthContext'
import { Logo } from './components/Logo'
import { EmptyState, LinkButton, Spinner } from './components/ui'
import { AppShell } from './layout/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { CountPage, CountsPage } from './pages/counts/CountsPage'
import { HistoryPage } from './pages/history/HistoryPage'
import { InventoryPage } from './pages/inventory/InventoryPage'
import { ProductPage } from './pages/inventory/ProductPage'
import { ShortagesPage } from './pages/inventory/ShortagesPage'
import { NewOrderPage } from './pages/orders/NewOrderPage'
import { OrderPage } from './pages/orders/OrderPage'
import { OrdersPage } from './pages/orders/OrdersPage'
import { PickingPage, PreparationPage } from './pages/orders/PreparationPage'
import { AdminPage } from './pages/admin/AdminPage'
import { Lock, MapPinOff } from 'lucide-react'

// lo que usa three.js se carga recién al entrar
const WarehousePage = lazy(() => import('./pages/warehouse/WarehousePage'))
const DesignerPage = lazy(() => import('./pages/designer/DesignerPage'))

function Guard({ perm, children }: { perm: Permission[]; children: ReactNode }) {
  const { can } = useAuth()
  if (perm.some((p) => can(p))) return <>{children}</>
  return (
    <EmptyState icon={Lock} title="Tu perfil no tiene acceso a esta sección" action={<LinkButton to="/">Ir al inicio</LinkButton>}>
      Si lo necesitás, pedile a un administrador que revise tu perfil.
    </EmptyState>
  )
}

export function Splash({ text }: { text: string }) {
  return (
    <div className="splash">
      <Logo size={96} />
      <Spinner label={text} />
    </div>
  )
}

export function App() {
  const { status } = useAuth()
  const location = useLocation()
  useEffect(() => { document.getElementById('main')?.scrollTo?.(0, 0); window.scrollTo(0, 0) }, [location.pathname])

  if (status === 'loading') return <Splash text="Abriendo tu sesión…" />
  if (status === 'anonymous') return <LoginPage />

  return (
    <AppShell>
      <Suspense fallback={<Spinner label="Cargando el visor 3D…" />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/pedidos" element={<Guard perm={['pedidos.ver_propios', 'pedidos.ver_todos', 'pedidos.ver_asignados']}><OrdersPage /></Guard>} />
          <Route path="/pedidos/nuevo" element={<Guard perm={['pedidos.crear', 'inventario.reponer']}><NewOrderPage /></Guard>} />
          <Route path="/pedidos/:id" element={<OrderPage />} />
          <Route path="/preparacion" element={<Guard perm={['pedidos.preparar']}><PreparationPage /></Guard>} />
          <Route path="/preparacion/:id" element={<Guard perm={['pedidos.preparar']}><PickingPage /></Guard>} />
          <Route path="/almacen" element={<Guard perm={['almacen.ver']}><WarehousePage /></Guard>} />
          <Route path="/inventario" element={<Guard perm={['inventario.ver']}><InventoryPage /></Guard>} />
          <Route path="/inventario/:id" element={<Guard perm={['inventario.ver']}><ProductPage /></Guard>} />
          <Route path="/faltantes" element={<Guard perm={['inventario.reponer']}><ShortagesPage /></Guard>} />
          <Route path="/conteo" element={<Guard perm={['conteo.gestionar']}><CountsPage /></Guard>} />
          <Route path="/conteo/:id" element={<Guard perm={['conteo.gestionar']}><CountPage /></Guard>} />
          <Route path="/historial" element={<Guard perm={['historial.ver_todo', 'historial.ver_propio']}><HistoryPage /></Guard>} />
          <Route path="/disenador" element={<Guard perm={['disenador.usar']}><DesignerPage /></Guard>} />
          <Route path="/admin" element={<Guard perm={['usuarios.gestionar', 'productos.editar']}><AdminPage /></Guard>} />
          <Route path="*" element={<EmptyState icon={MapPinOff} title="Esta página no existe" action={<LinkButton to="/">Ir al inicio</LinkButton>} />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}
