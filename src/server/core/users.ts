/** Usuarios, perfiles y empresas. */
import { ROLE_LABEL } from '../../shared/permissions'
import type { Company, Role, User } from '../../shared/types'
import type { Db } from '../db/db'
import { logActivity } from './activity'
import { hashPassword } from './auth'
import { bool, conflict, invalid, notFound, requirePermission, type Ctx } from './context'

interface UserRow {
  id: number; company_id: number; company_name: string; name: string; email: string
  role: Role; sector: string; active: number; created_at: string
}

const USER_SELECT = `SELECT u.id, u.company_id, c.name AS company_name, u.name, u.email, u.role, u.sector, u.active, u.created_at
                       FROM users u JOIN companies c ON c.id = u.company_id`

const toUser = (r: UserRow): User => ({
  id: r.id, companyId: r.company_id, companyName: r.company_name, name: r.name, email: r.email,
  role: r.role, sector: r.sector, active: bool(r.active), createdAt: r.created_at,
})

export function getUser(db: Db, id: number): User {
  const r = db.get<UserRow>(`${USER_SELECT} WHERE u.id = :id`, { id })
  if (!r) throw notFound('El usuario')
  return toUser(r)
}

/** Lista para administración (completa) o para elegir personas (sólo nombre y perfil). */
export function listUsers(ctx: Ctx, opts: { role?: Role } = {}): User[] {
  const rows = ctx.db.all<UserRow>(
    `${USER_SELECT} ${opts.role ? 'WHERE u.role = :role' : ''} ORDER BY u.active DESC, u.name`,
    { role: opts.role },
  )
  const users = rows.map(toUser)
  if (ctx.actor.role === 'cliente') return users.filter((u) => u.companyId === ctx.actor.companyId)
  return users
}

export interface UserInput {
  name: string
  email: string
  role: Role
  companyId: number
  sector?: string
  password?: string
  active?: boolean
}

export async function createUser(ctx: Ctx, input: UserInput): Promise<User> {
  requirePermission(ctx, 'usuarios.gestionar')
  if (!input.name.trim()) throw invalid('Ingresá el nombre.')
  if (!/^\S+@\S+\.\S+$/.test(input.email)) throw invalid('Ingresá un email válido.')
  if (!input.password) throw invalid('Ingresá una contraseña inicial.')
  if (ctx.db.get('SELECT id FROM users WHERE email = :email', { email: input.email })) throw conflict('Ya hay un usuario con ese email.')
  getCompany(ctx.db, input.companyId)
  const hash = await hashPassword(input.password)
  return ctx.db.transaction(() => {
    const { lastInsertRowid: id } = ctx.db.run(
      `INSERT INTO users (company_id, name, email, password_hash, role, sector, active, created_at)
       VALUES (:companyId, :name, :email, :hash, :role, :sector, :active, :now)`,
      { ...input, name: input.name.trim(), email: input.email.trim(), hash, sector: input.sector ?? '', active: input.active ?? true, now: ctx.clock.now() },
    )
    logActivity(ctx, { type: 'usuario.creado', message: `${ctx.actor.name} creó el usuario ${input.name} (${ROLE_LABEL[input.role]})` })
    return getUser(ctx.db, id)
  })
}

export async function updateUser(ctx: Ctx, id: number, input: Partial<UserInput>): Promise<User> {
  requirePermission(ctx, 'usuarios.gestionar')
  const current = getUser(ctx.db, id)
  if (id === ctx.actor.id && (input.role && input.role !== current.role || input.active === false))
    throw invalid('No podés cambiar tu propio perfil ni desactivarte.')
  if (input.email && input.email !== current.email && ctx.db.get('SELECT id FROM users WHERE email = :email AND id <> :id', { email: input.email, id }))
    throw conflict('Ya hay un usuario con ese email.')
  const hash = input.password ? await hashPassword(input.password) : null
  return ctx.db.transaction(() => {
    ctx.db.run(
      `UPDATE users SET name = :name, email = :email, role = :role, company_id = :companyId, sector = :sector, active = :active
        ${hash ? ', password_hash = :hash' : ''} WHERE id = :id`,
      {
        id, hash,
        name: input.name?.trim() ?? current.name,
        email: input.email?.trim() ?? current.email,
        role: input.role ?? current.role,
        companyId: input.companyId ?? current.companyId,
        sector: input.sector ?? current.sector,
        active: input.active ?? current.active,
      },
    )
    if (input.active === false) ctx.db.run('DELETE FROM sessions WHERE user_id = :id', { id })
    logActivity(ctx, { type: 'usuario.editado', message: `${ctx.actor.name} actualizó el usuario ${input.name ?? current.name}` })
    return getUser(ctx.db, id)
  })
}

/* ------------------------------ Empresas ------------------------------ */

interface CompanyRow { id: number; name: string; kind: Company['kind']; sectors: string }
const toCompany = (r: CompanyRow): Company => ({ id: r.id, name: r.name, kind: r.kind, sectors: JSON.parse(r.sectors) })

export function getCompany(db: Db, id: number): Company {
  const r = db.get<CompanyRow>('SELECT id, name, kind, sectors FROM companies WHERE id = :id', { id })
  if (!r) throw notFound('La empresa')
  return toCompany(r)
}

export function listCompanies(ctx: Ctx): Company[] {
  const rows = ctx.db.all<CompanyRow>('SELECT id, name, kind, sectors FROM companies ORDER BY kind DESC, name')
  const all = rows.map(toCompany)
  return ctx.actor.role === 'cliente' ? all.filter((c) => c.id === ctx.actor.companyId) : all
}

export function createCompany(ctx: Ctx, input: { name: string; kind: Company['kind']; sectors: string[] }): Company {
  requirePermission(ctx, 'usuarios.gestionar')
  if (!input.name.trim()) throw invalid('Ingresá el nombre de la empresa.')
  if (ctx.db.get('SELECT id FROM companies WHERE name = :name', { name: input.name.trim() })) throw conflict('Ya existe una empresa con ese nombre.')
  const { lastInsertRowid } = ctx.db.run(
    'INSERT INTO companies (name, kind, sectors, created_at) VALUES (:name, :kind, :sectors, :now)',
    { name: input.name.trim(), kind: input.kind, sectors: JSON.stringify(input.sectors.filter(Boolean)), now: ctx.clock.now() },
  )
  return getCompany(ctx.db, lastInsertRowid)
}
