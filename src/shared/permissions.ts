/**
 * Permisos por perfil. El servidor los verifica en cada operación;
 * la interfaz los usa para mostrar u ocultar opciones.
 */
import type { Role } from './types'

export const PERMISSIONS = {
  'pedidos.crear': 'Solicitar materiales',
  'pedidos.ver_propios': 'Ver sus pedidos',
  'pedidos.ver_asignados': 'Ver pedidos asignados',
  'pedidos.ver_todos': 'Ver todos los pedidos',
  'pedidos.revisar': 'Revisar y aprobar pedidos',
  'pedidos.preparar': 'Preparar pedidos',
  'pedidos.entregar': 'Registrar entregas y recepciones',
  'pedidos.finalizar': 'Finalizar pedidos',
  'pedidos.cancelar': 'Cancelar pedidos',
  'pedidos.comentar': 'Agregar comentarios',
  'inventario.ver': 'Ver inventario',
  'inventario.mover': 'Ingresar y mover productos',
  'inventario.reponer': 'Solicitar reposición de stock',
  'almacen.ver': 'Ver el mapa del almacén',
  'almacen.editar': 'Administrar racks y ubicaciones',
  'conteo.gestionar': 'Hacer conteos de inventario',
  'historial.ver_todo': 'Ver todo el historial',
  'historial.ver_propio': 'Ver el historial de sus pedidos',
  'productos.editar': 'Crear y modificar productos',
  'usuarios.gestionar': 'Crear usuarios y asignar perfiles',
  'estadisticas.ver': 'Ver estadísticas de la empresa',
  'disenador.usar': 'Usar el cotizador 3D de racks',
} as const

export type Permission = keyof typeof PERMISSIONS

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  encargado: 'Encargado de almacén',
  operario: 'Operario',
  cliente: 'Cliente / empresa',
}

const ALL = Object.keys(PERMISSIONS) as Permission[]

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ALL,
  encargado: [
    'pedidos.crear', 'pedidos.ver_propios', 'pedidos.ver_asignados', 'pedidos.ver_todos', 'pedidos.revisar',
    'pedidos.preparar', 'pedidos.entregar', 'pedidos.finalizar', 'pedidos.cancelar', 'pedidos.comentar',
    'inventario.ver', 'inventario.mover', 'inventario.reponer', 'almacen.ver', 'almacen.editar',
    'conteo.gestionar', 'historial.ver_todo', 'estadisticas.ver', 'disenador.usar',
  ],
  operario: [
    'pedidos.ver_asignados', 'pedidos.preparar', 'pedidos.comentar', 'almacen.ver', 'inventario.ver',
  ],
  cliente: [
    'pedidos.crear', 'pedidos.ver_propios', 'pedidos.comentar', 'pedidos.finalizar', 'historial.ver_propio', 'disenador.usar',
  ],
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}
