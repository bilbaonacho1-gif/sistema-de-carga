/**
 * USUARIOS Y PROYECTOS EN EL SERVIDOR. El sistema corre entero en el navegador; lo único que vive
 * afuera son los usuarios (quién entra y con qué permiso) y los proyectos guardados de cada uno.
 * El servidor es una base de Supabase: se le habla por funciones (ver supabase/migrations), y cada
 * una revisa la ficha de la sesión antes de hacer nada. La clave de acá abajo es la pública (la que
 * va en el navegador): no da acceso a las tablas, sólo deja llamar a esas funciones.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** Guardado en el navegador que no rompe si está bloqueado (modo privado, etc.). */
const safeStorage = {
  getItem: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin memoria */ } },
  removeItem: (k: string) => { try { localStorage.removeItem(k) } catch { /* sin memoria */ } },
}

const API = 'https://yhqjvosqnyhgtpgfvcrt.supabase.co/rest/v1/rpc/'
const KEY = 'sb_publishable_CIyzhTcXxHmVOxzK9-IY2A_QuI3iEDv'

export type Role = 'viewer' | 'editor' | 'admin'
export interface User { id: string; username: string; full_name: string; role: Role; must_change: boolean }
export interface AdminUser {
  id: string; username: string; full_name: string; role: Role; status: 'pending' | 'active' | 'blocked'
  note: string | null; created_at: string; last_login: string | null; must_change: boolean; projects: number
}
export interface ProjectInfo { id: string; name: string; share_code: string | null; created_at: string; updated_at: string }

export const ROLES: { id: Role; name: string; what: string }[] = [
  { id: 'viewer', name: 'Solo ver', what: 'Entra y abre proyectos que le comparten con un código. No guarda proyectos propios.' },
  { id: 'editor', name: 'Editar', what: 'Arma depósitos y guarda sus proyectos. Los puede compartir con un código.' },
  { id: 'admin', name: 'Administrador', what: 'Todo lo anterior y, además, maneja los usuarios: da acceso, cambia permisos, bloquea y elimina.' },
]
export const roleName = (r: Role) => ROLES.find((x) => x.id === r)?.name ?? r

/** Lo que contesta el servidor cuando algo no se puede, dicho para la persona. */
const MESSAGES: Record<string, string> = {
  credenciales: 'El usuario o la contraseña no coinciden.',
  espera: 'Demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.',
  pendiente: 'Tu pedido de acceso todavía no fue aprobado. Avisale al administrador.',
  bloqueado: 'Tu usuario está bloqueado. Hablá con el administrador.',
  sesion: 'La sesión se cerró. Volvé a entrar.',
  permiso: 'Tu usuario no tiene permiso para hacer eso.',
  nombre: 'Escribí el nombre (entre 3 y 60 letras).',
  usuario: 'El usuario tiene que tener entre 3 y 30 letras o números (puede llevar punto, guion o espacio).',
  usuario_usado: 'Ese usuario ya existe. Elegí otro.',
  clave: 'La contraseña tiene que tener al menos 5 caracteres.',
  clave_actual: 'La contraseña actual no es esa.',
  clave_igual: 'La contraseña nueva tiene que ser distinta de la actual.',
  muchos_pedidos: 'Hay demasiados pedidos de acceso esperando. Avisale al administrador.',
  ultimo_admin: 'Tiene que quedar al menos un administrador activo.',
  vos_mismo: 'No te podés eliminar a vos mismo.',
  no_existe: 'Eso ya no existe (puede que lo hayan borrado).',
  codigo: 'Ese código no corresponde a ningún proyecto compartido.',
  muchos: 'Llegaste al máximo de proyectos guardados. Borrá alguno que no uses.',
  dato: 'El dato no es válido.',
}
export class CloudError extends Error {
  code: string
  constructor(code: string, message?: string) { super(message ?? MESSAGES[code] ?? 'No se pudo hacer.'); this.code = code }
}
const NO_SERVER = 'No se pudo conectar con el servidor. Revisá internet y probá de nuevo.'

/** Llama a una función del servidor. Si contesta { ok: false }, tira el error con su mensaje. */
async function rpc<T extends object>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(API + fn, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  } catch { throw new CloudError('red', NO_SERVER) }
  if (!res.ok) throw new CloudError('red', res.status >= 500 || res.status === 404 ? NO_SERVER : `El servidor contestó un error (${res.status}).`)
  const data = (await res.json()) as T & { ok?: boolean; error?: string }
  if (data?.ok === false) {
    // sesión vencida, o usuario bloqueado o eliminado mientras estaba adentro: se lo saca
    if (data.error === 'sesion' && useAuth.getState().token) useAuth.getState().drop()
    throw new CloudError(data.error ?? 'error')
  }
  return data
}

/* ------------------------------ Sesión ------------------------------ */

interface AuthState {
  token: string | null
  user: User | null
  /** checking: viendo si la sesión guardada sirve · out: sin sesión · in: adentro · offline: no se llegó al servidor */
  state: 'checking' | 'out' | 'in' | 'offline'
  /** Pedidos de acceso esperando (sólo lo ve el administrador). */
  pending: number
  check(): Promise<void>
  login(user: string, pass: string): Promise<void>
  logout(): Promise<void>
  /** Saca la sesión de este navegador sin avisar al servidor (cuando ya no sirve). */
  drop(): void
}

export const useAuth = create<AuthState>()(persist((set, get) => ({
  token: null, user: null, state: 'checking', pending: 0,
  check: async () => {
    const token = get().token
    if (!token) { set({ state: 'out', user: null, pending: 0 }); return }
    try {
      const r = await rpc<{ user: User; pending: number }>('sdc_me', { p_token: token })
      set({ user: r.user, pending: r.pending, state: 'in' })
    } catch (e) {
      if (e instanceof CloudError && e.code === 'red') set({ state: get().user ? 'in' : 'offline' })
      // con 'sesion', rpc ya la sacó
    }
  },
  login: async (user, pass) => {
    const r = await rpc<{ token: string; user: User }>('sdc_login', { p_user: user, p_pass: pass })
    set({ token: r.token, user: r.user, state: 'in', pending: 0 })
    void get().check()
  },
  logout: async () => {
    const token = get().token
    get().drop()
    if (token) try { await rpc('sdc_logout', { p_token: token }) } catch { /* ya está afuera igual */ }
  },
  drop: () => set({ token: null, user: null, state: 'out', pending: 0 }),
}), { name: 'sdc-sesion', storage: createJSONStorage(() => safeStorage), partialize: (s) => ({ token: s.token }) }))

const token = () => useAuth.getState().token ?? ''
export const canEdit = (u: User | null) => u?.role === 'editor' || u?.role === 'admin'

export const requestAccess = (name: string, user: string, pass: string, note: string) =>
  rpc('sdc_request_access', { p_name: name, p_user: user, p_pass: pass, p_note: note || null })

export async function changePassword(oldPass: string, newPass: string) {
  await rpc('sdc_change_password', { p_token: token(), p_old: oldPass, p_new: newPass })
  const u = useAuth.getState().user
  if (u) useAuth.setState({ user: { ...u, must_change: false } })
}

/* ------------------------------ Administración ------------------------------ */

export const adminUsers = async () => (await rpc<{ users: AdminUser[] }>('sdc_admin_users', { p_token: token() })).users
export const adminSet = (id: string, patch: { role?: Role; status?: 'active' | 'blocked' }) =>
  rpc('sdc_admin_set', { p_token: token(), p_id: id, p_role: patch.role ?? null, p_status: patch.status ?? null })
export const adminDelete = (id: string) => rpc('sdc_admin_delete', { p_token: token(), p_id: id })
export const adminPassword = (id: string, pass: string) => rpc('sdc_admin_password', { p_token: token(), p_id: id, p_new: pass })
export const adminCreate = (name: string, user: string, pass: string, role: Role) =>
  rpc('sdc_admin_create', { p_token: token(), p_name: name, p_user: user, p_pass: pass, p_role: role })

/* ------------------------------ Proyectos ------------------------------ */

export const listProjects = async () => (await rpc<{ projects: ProjectInfo[] }>('sdc_projects', { p_token: token() })).projects
export const getProject = async (id: string) =>
  (await rpc<{ project: { id: string; name: string; data: unknown; share_code: string | null; updated_at: string } }>('sdc_project_get', { p_token: token(), p_id: id })).project
export const saveProject = (id: string | null, name: string, data: unknown) =>
  rpc<{ id: string; updated_at: string }>('sdc_project_save', { p_token: token(), p_id: id, p_name: name, p_data: data })
export const renameProject = (id: string, name: string) => rpc('sdc_project_rename', { p_token: token(), p_id: id, p_name: name })
export const deleteProject = (id: string) => rpc('sdc_project_delete', { p_token: token(), p_id: id })
export const shareProject = async (id: string, on: boolean) =>
  (await rpc<{ share_code: string | null }>('sdc_project_share', { p_token: token(), p_id: id, p_on: on })).share_code
export const openShared = async (code: string) =>
  (await rpc<{ project: { name: string; data: unknown; updated_at: string; owner: string; mine: boolean; id: string | null } }>('sdc_project_shared', { p_token: token(), p_code: code })).project

/** Del texto pegado (un código suelto o un link entero) saca el código. */
export function codeFrom(text: string): string {
  const fromLink = /[?&]proyecto=([A-Za-z0-9]+)/.exec(text)?.[1]
  return (fromLink ?? text).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}
export const shareLink = (code: string) => `${window.location.origin}${window.location.pathname}?proyecto=${code}`
