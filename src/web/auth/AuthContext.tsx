import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Permission } from '../../shared/permissions'
import type { Session } from '../../shared/types'
import { api, session as tokenStore } from '../api/client'

interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated'
  session: Session | null
  login(s: Session): void
  logout(): Promise<void>
  can(p: Permission): boolean
}

const AuthCtx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [state, setState] = useState<{ status: AuthState['status']; session: Session | null }>({
    status: tokenStore.token ? 'loading' : 'anonymous',
    session: null,
  })

  const clear = useCallback(() => {
    tokenStore.set(null)
    qc.clear()
    setState({ status: 'anonymous', session: null })
  }, [qc])

  useEffect(() => {
    tokenStore.onUnauthorized(clear)
    if (!tokenStore.token) return
    api.get<Session>('/me')
      .then((s) => setState({ status: 'authenticated', session: s }))
      .catch(clear)
  }, [clear])

  const value = useMemo<AuthState>(() => ({
    ...state,
    login(s) {
      tokenStore.set(s.token)
      qc.clear()
      setState({ status: 'authenticated', session: s })
    },
    async logout() {
      await api.post('/auth/logout').catch(() => {})
      clear()
    },
    can: (p) => state.session?.permissions.includes(p) ?? false,
  }), [state, qc, clear])

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth fuera de AuthProvider')
  return ctx
}

/** Usuario logueado (sólo dentro de pantallas con sesión). */
export function useMe() {
  const { session } = useAuth()
  return session!.user
}
