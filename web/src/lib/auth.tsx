import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, getToken, setToken } from './api'
import { clearOfflineData } from './offline'
import type { User } from './types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(Boolean(getToken()))

  useEffect(() => {
    if (!getToken()) return
    api<User>('/auth/me')
      .then(setUser)
      // Só sai se o servidor recusar o acesso; sem internet continua com o usuário guardado.
      .catch((e) => { if (e instanceof ApiError && e.status === 401) setToken(null) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onLogout = () => setUser(null)
    window.addEventListener('vanguard:logout', onLogout)
    return () => window.removeEventListener('vanguard:logout', onLogout)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { token, user } = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { email, password } })
    setToken(token)
    setUser(user)
  }, [])

  const refresh = useCallback(async () => {
    setUser(await api<User>('/auth/me'))
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    void clearOfflineData()
    setUser(null)
  }, [])

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}

// Para telas internas, onde o usuário sempre existe.
export function useUser() {
  const { user } = useAuth()
  if (!user) throw new Error('Usuário não autenticado')
  return user
}
