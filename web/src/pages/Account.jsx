import { useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useAction } from '../ui.jsx'

export default function Account() {
  const { user } = useAuth()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [done, setDone] = useState(false)
  const { busy, error, setError, run } = useAction()
  const set = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  const submit = (e) => {
    e.preventDefault()
    setDone(false)
    if (form.newPassword !== form.confirm) return setError('A confirmação não confere com a nova senha')
    run(async () => {
      await api('/auth/password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } })
      setForm({ currentPassword: '', newPassword: '', confirm: '' })
      setDone(true)
    })
  }

  return (
    <>
      <h1>Minha conta</h1>
      <p className="muted">{user.name} · {user.email}</p>
      <form className="card stack narrow" onSubmit={submit}>
        <h2>Trocar senha</h2>
        <label>Senha atual<input type="password" name="currentPassword" required value={form.currentPassword} onChange={set} autoComplete="current-password" /></label>
        <label>Nova senha<input type="password" name="newPassword" required minLength={8} value={form.newPassword} onChange={set} autoComplete="new-password" /></label>
        <label>Confirme a nova senha<input type="password" name="confirm" required value={form.confirm} onChange={set} autoComplete="new-password" /></label>
        {error && <p className="error">{error}</p>}
        {done && <p className="success">Senha alterada.</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
      </form>
    </>
  )
}
