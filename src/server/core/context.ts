/**
 * Contexto de cada operación: base de datos, reloj y quién la hace.
 * Todas las reglas de negocio reciben este contexto; nada lee variables globales.
 */
import type { Permission } from '../../shared/permissions'
import type { Role } from '../../shared/types'
import type { Db } from '../db/db'

export interface Actor {
  id: number
  name: string
  role: Role
  companyId: number
  /** Permisos vigentes del perfil (los configura el administrador). */
  permissions: Permission[]
}

export interface Clock {
  now(): string
}

export const systemClock: Clock = { now: () => new Date().toISOString() }

export interface Ctx {
  db: Db
  clock: Clock
  actor: Actor
}

/* ------------------------------ Errores ------------------------------ */

export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export const invalid = (message: string) => new AppError(400, 'invalid', message)
export const unauthorized = (message = 'Tu sesión venció. Ingresá de nuevo.') => new AppError(401, 'unauthorized', message)
export const forbidden = (message = 'Tu perfil no tiene permiso para esta acción.') => new AppError(403, 'forbidden', message)
export const notFound = (what: string) => new AppError(404, 'not_found', `${what} no existe.`)
export const conflict = (message: string) => new AppError(409, 'conflict', message)

export function requirePermission(ctx: Ctx, permission: Permission): void {
  if (!ctx.actor.permissions.includes(permission)) throw forbidden()
}

export function hasPermission(ctx: Ctx, permission: Permission): boolean {
  return ctx.actor.permissions.includes(permission)
}

/** Primer nombre, para los mensajes del historial ("Juan agregó 20 unidades"). */
export const firstName = (name: string) => name.split(' ')[0]

/** Convierte 0/1 de SQLite en booleano. */
export const bool = (v: unknown) => v === 1 || v === true
