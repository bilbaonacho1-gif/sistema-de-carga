/**
 * Ingreso y sesiones. Contraseñas con PBKDF2-SHA256 (WebCrypto: funciona igual
 * en Node y en el navegador). La sesión es un token aleatorio guardado en `sessions`.
 */
import type { Session } from '../../shared/types'
import type { Db } from '../db/db'
import { invalid, unauthorized, type Actor, type Clock } from './context'
import { actorFor, rolePermissions } from './roles'
import { getUser } from './users'

const ITERATIONS = 120_000
const enc = new TextEncoder()
const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)))

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256)
  return toHex(bits)
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw invalid('La contraseña tiene que tener al menos 8 caracteres.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${await derive(password, salt, ITERATIONS)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iter, salt, hash] = stored.split('$')
  const candidate = await derive(password, fromHex(salt), Number(iter))
  // comparación de tiempo constante
  let diff = candidate.length ^ hash.length
  for (let i = 0; i < Math.min(candidate.length, hash.length); i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i)
  return diff === 0
}

const SESSION_DAYS = 30

export async function login(db: Db, clock: Clock, email: string, password: string): Promise<Session> {
  const row = db.get<{ id: number; password_hash: string; active: number }>(
    'SELECT id, password_hash, active FROM users WHERE email = :email', { email: email.trim() },
  )
  // mismo mensaje si el email no existe o la contraseña no coincide
  if (!row || !(await verifyPassword(password, row.password_hash))) throw invalid('El email o la contraseña no son correctos.')
  if (!row.active) throw invalid('Este usuario está desactivado. Consultá con un administrador.')

  const token = toHex(crypto.getRandomValues(new Uint8Array(32)))
  const now = clock.now()
  const expires = new Date(Date.parse(now) + SESSION_DAYS * 86_400_000).toISOString()
  db.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (:token, :userId, :now, :expires)', { token, userId: row.id, now, expires })
  return sessionFor(db, token, row.id)
}

export function logout(db: Db, token: string): void {
  db.run('DELETE FROM sessions WHERE token = :token', { token })
}

/** Usuario dueño del token, o error 401 si no existe o venció. */
export function resolveSession(db: Db, clock: Clock, token: string | undefined): Actor {
  if (!token) throw unauthorized('Ingresá para continuar.')
  const row = db.get<{ id: number; name: string; role: Actor['role']; company_id: number; active: number }>(
    `SELECT u.id, u.name, u.role, u.company_id, u.active FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = :token AND s.expires_at > :now`,
    { token, now: clock.now() },
  )
  if (!row || !row.active) throw unauthorized()
  return actorFor(db, { id: row.id, name: row.name, role: row.role, companyId: row.company_id })
}

export function sessionFor(db: Db, token: string, userId: number): Session {
  const user = getUser(db, userId)
  return { token, user, permissions: rolePermissions(db, user.role) }
}
