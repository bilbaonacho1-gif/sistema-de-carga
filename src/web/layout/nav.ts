import {
  Boxes, Box, ClipboardList, History, LayoutDashboard, PackageCheck, ScanLine, Settings, TriangleAlert, Warehouse, type LucideIcon,
} from 'lucide-react'
import type { Permission } from '../../shared/permissions'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Alcanza con tener uno de estos permisos. */
  perm?: Permission[]
  end?: boolean
}

export interface NavGroup {
  label: string | null
  phase?: 1 | 2 | 3
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  { label: null, items: [{ to: '/', label: 'Inicio', icon: LayoutDashboard, end: true }] },
  {
    label: 'Pedidos', phase: 1,
    items: [
      { to: '/pedidos', label: 'Pedidos', icon: ClipboardList, perm: ['pedidos.ver_propios', 'pedidos.ver_todos', 'pedidos.ver_asignados'] },
      { to: '/preparacion', label: 'Preparación', icon: PackageCheck, perm: ['pedidos.preparar'] },
    ],
  },
  {
    label: 'Almacén', phase: 2,
    items: [
      { to: '/almacen', label: 'Almacén', icon: Warehouse, perm: ['almacen.ver'] },
      { to: '/inventario', label: 'Inventario', icon: Boxes, perm: ['inventario.ver'] },
      { to: '/faltantes', label: 'Faltantes', icon: TriangleAlert, perm: ['inventario.reponer'] },
    ],
  },
  {
    label: 'Control', phase: 3,
    items: [
      { to: '/conteo', label: 'Conteo', icon: ScanLine, perm: ['conteo.gestionar'] },
      { to: '/historial', label: 'Historial', icon: History, perm: ['historial.ver_todo', 'historial.ver_propio'] },
    ],
  },
  {
    label: 'Herramientas',
    items: [
      { to: '/disenador', label: 'Cotizador 3D', icon: Box, perm: ['disenador.usar'] },
      { to: '/admin', label: 'Administración', icon: Settings, perm: ['usuarios.gestionar', 'productos.editar'] },
    ],
  },
]

/** Orden de preferencia para la barra inferior del celular (se toman los 4 primeros permitidos). */
export const MOBILE_PRIORITY = ['/', '/pedidos', '/almacen', '/inventario', '/preparacion', '/disenador', '/historial', '/conteo']
