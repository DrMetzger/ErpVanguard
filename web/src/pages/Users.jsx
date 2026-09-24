import { useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import Icon from '../components/Icon.jsx'
import { Modal, useAction, useApi } from '../ui.jsx'

const PERMS = [
  ['solicitante', 'Solicitante', 'abre solicitações de compra'],
  ['comprador', 'Comprador', 'cotações, pedidos, fornecedores e notas'],
  ['aprovador', 'Aprovador', 'aprova pedidos na sua alçada'],
]

export default function Users() {
  const { user: me } = useAuth()
  const { data: users, error, reload } = useApi('/users')
  const [editing, setEditing] = useState(null)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Usuários</h1>
          <p className="muted">Quem acessa o sistema e o que cada um pode fazer.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={18} /> Novo usuário</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfis</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td data-label="Nome">{u.name}{u.id === me.id && <small className="muted"> (você)</small>}</td>
                <td data-label="E-mail">{u.email}</td>
                <td data-label="Perfis">
                  {u.role === 'admin' ? <span className="badge badge-info">Administrador</span> : u.permissions.map((p) => <span key={p} className="badge badge-muted chip">{p}</span>)}
                </td>
                <td data-label="Situação">{u.active ? 'Ativo' : 'Inativo'}</td>
                <td className="actions"><button className="icon-btn" onClick={() => setEditing(u)} aria-label="Editar"><Icon name="edit" size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserForm user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function UserForm({ user, onClose, onSaved }) {
  const isNew = !user.id
  const [form, setForm] = useState({
    name: user.name ?? '', email: user.email ?? '', password: '', role: user.role ?? 'user',
    permissions: user.permissions ?? ['solicitante'], active: user.active ?? true,
  })
  const { busy, error, run } = useAction()
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const toggle = (p) => set('permissions', form.permissions.includes(p) ? form.permissions.filter((x) => x !== p) : [...form.permissions, p])

  const submit = (e) => {
    e.preventDefault()
    run(async () => {
      const body = { name: form.name, role: form.role, permissions: form.permissions }
      if (isNew) await api('/users', { method: 'POST', body: { ...body, email: form.email, password: form.password } })
      else await api(`/users/${user.id}`, { method: 'PATCH', body: { ...body, active: form.active, ...(form.password ? { password: form.password } : {}) } })
      onSaved()
    })
  }

  return (
    <Modal title={isNew ? 'Novo usuário' : 'Editar usuário'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <label className="span-2">Nome<input required value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
          <label>E-mail<input type="email" required disabled={!isNew} value={form.email} onChange={(e) => set('email', e.target.value)} /></label>
          <label className="span-2">{isNew ? 'Senha inicial' : 'Nova senha (deixe vazio para manter)'}
            <input type="password" required={isNew} minLength={8} value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
          </label>
          <label>Tipo
            <select value={form.role} onChange={(e) => set('role', e.target.value)}>
              <option value="user">Usuário</option><option value="admin">Administrador</option>
            </select>
          </label>
        </div>
        {form.role === 'user' && (
          <fieldset className="checks">
            <legend>Perfis</legend>
            {PERMS.map(([key, label, hint]) => (
              <label key={key} className="check">
                <input type="checkbox" checked={form.permissions.includes(key)} onChange={() => toggle(key)} />
                <span><strong>{label}</strong> <small className="muted">{hint}</small></span>
              </label>
            ))}
          </fieldset>
        )}
        {form.role === 'admin' && <p className="muted small">Administrador tem todos os perfis e configura grupos, alçadas e usuários.</p>}
        {!isNew && (
          <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Usuário ativo</label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  )
}
