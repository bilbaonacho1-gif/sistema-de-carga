/**
 * Cliente de la API. Habla con el servidor por HTTP (modo "http") o con el servidor
 * que corre dentro del navegador (modo "local"); el resto de la app no nota la diferencia.
 */
import type { LocalFetch } from '../../server/browser'

export const API_MODE = __API_MODE__

let local: Promise<LocalFetch> | null = null

/** En modo local arranca el servidor embebido (SQLite en WebAssembly) la primera vez. */
export function startLocalServer(): Promise<LocalFetch> {
  // se compara con la constante de compilación: en el modo servidor este código (y la base
  // en WebAssembly) queda afuera del paquete
  if (__API_MODE__ !== 'local') throw new Error('La app está compilada para el servidor Node.')
  local ??= import('../../server/browser').then((m) => m.createBrowserServer())
  return local
}

async function send(path: string, init: RequestInit): Promise<Response> {
  if (__API_MODE__ === 'http') return fetch(path, init)
  const f = await startLocalServer()
  return f(new Request(new URL(path, 'http://local'), init))
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly field?: string) {
    super(message)
  }
}

const TOKEN_KEY = 'sdc-token'
const store = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } },
  set: (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY) } catch { /* sin almacenamiento */ } },
}

let token: string | null = store.get()
let onUnauthorized: () => void = () => {}

export const session = {
  get token() { return token },
  set(t: string | null) { token = t; store.set(t) },
  onUnauthorized(fn: () => void) { onUnauthorized = fn },
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await send(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'network', 'No hay conexión con el servidor. Revisá la red y volvé a intentar.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // respuesta que no es de nuestra API: esta compilación busca el servidor Node y no está
    if (!data?.error && (res.status === 404 || res.status === 405))
      throw new ApiError(res.status, 'no_api', 'No se encuentra el servidor de la app. Esta versión necesita el servidor Node (npm run server); para publicar en Vercel o Netlify se usa "npm run build".')
    if (res.status === 401 && path !== '/auth/login') onUnauthorized()
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Error ${res.status}`, data?.error?.field)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

/** Arma "?a=1&b=2" ignorando vacíos. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(v === true ? '1' : String(v))}`).join('&')}` : ''
}
