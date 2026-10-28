/**
 * Permisos por perfil guardados en la base (tabla role_permissions).
 * Arrancan con los valores de shared/permissions.ts y el administrador los puede cambiar.
 */
import { PERMISSIONS, ROLE_LABEL, ROLE_PERMISSIONS, type Permission } from '../../shared/permissions'
import type { Role } from '../../shared/types'
import type { Db } from '../db/db'
import { logActivity } from './activity'
import { invalid, requirePermission, type Actor, type Ctx } from './context'

const ROLES = Object.keys(ROLE_LABEL) as Role[]
const VALID = new Set(Object.keys(PERMISSIONS))

/** Carga los valores de fábrica si la tabla está vacía. */
export function seedRolePermissions(db: Db): void {
  if (db.get('SELECT 1 AS x FROM role_permissions LIMIT 1')) return
  for (const role of ROLES)
    for (const permission of ROLE_PERMISSIONS[role])
      db.run('INSERT INTO role_permissions (role, permission) VALUES (:role, :permission)', { role, permission })
}

export function rolePermissions(db: Db, role: Role): Permission[] {
  return db.all<{ permission: Permission }>('SELECT permission FROM role_permissions WHERE role = :role', { role }).map((r) => r.permission)
}

export function permissionMatrix(db: Db): Record<Role, Permission[]> {
  return Object.fromEntries(ROLES.map((r) => [r, rolePermissions(db, r)])) as Record<Role, Permission[]>
}

/** Arma el "actor" de un usuario con sus permisos vigentes. */
export function actorFor(db: Db, user: { id: number; name: string; role: Role; companyId: number }): Actor {
  return { ...user, permissions: rolePermissions(db, user.role) }
}

export function setRolePermissions(ctx: Ctx, role: Role, permissions: string[]): Record<Role, Permission[]> {
  requirePermission(ctx, 'usuarios.gestionar')
  if (!ROLES.includes(role)) throw invalid('Perfil desconocido.')
  const list = [...new Set(permissions)].filter((p) => VALID.has(p)) as Permission[]
  // el administrador no puede quedarse sin acceso a la administración
  if (role === 'admin' && !list.includes('usuarios.gestionar')) throw invalid('El perfil Administrador tiene que conservar "Crear usuarios y asignar perfiles".')
  ctx.db.transaction(() => {
    ctx.db.run('DELETE FROM role_permissions WHERE role = :role', { role })
    for (const permission of list) ctx.db.run('INSERT INTO role_permissions (role, permission) VALUES (:role, :permission)', { role, permission })
    logActivity(ctx, { type: 'usuario.editado', message: `${ctx.actor.name.split(' ')[0]} actualizó los permisos del perfil ${ROLE_LABEL[role]} (${list.length} permisos)` })
  })
  return permissionMatrix(ctx.db)
}

export function resetRolePermissions(ctx: Ctx): Record<Role, Permission[]> {
  requirePermission(ctx, 'usuarios.gestionar')
  ctx.db.transaction(() => {
    ctx.db.run('DELETE FROM role_permissions')
    seedRolePermissions(ctx.db)
    logActivity(ctx, { type: 'usuario.editado', message: `${ctx.actor.name.split(' ')[0]} restableció los permisos de fábrica` })
  })
  return permissionMatrix(ctx.db)
}
