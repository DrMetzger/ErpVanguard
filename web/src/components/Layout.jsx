import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { modules } from '../modules.js'
import Icon from './Icon.jsx'

export default function Layout() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <img src="/logo.svg" alt="" width="30" height="30" />
          <span>ERP <strong>Vanguard</strong></span>
        </div>
        <nav>
          <NavLink to="/" end onClick={close}><Icon name="home" size={18} /> Início</NavLink>
          {modules.map((m) => (
            <NavLink key={m.path} to={m.path} onClick={close}>
              <Icon name={m.icon} size={18} /> {m.title}
            </NavLink>
          ))}
          {user.role === 'admin' && (
            <>
              <span className="nav-section">Administração</span>
              <NavLink to="/usuarios" onClick={close}><Icon name="users" size={18} /> Usuários</NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-user">
          <NavLink to="/minha-conta" onClick={close} className="user-link" title="Minha conta">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </NavLink>
          <button className="icon-btn" onClick={logout} title="Sair" aria-label="Sair">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>
      {open && <div className="backdrop" onClick={close} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Icon name="menu" />
          </button>
          <img src="/logo.svg" alt="" width="26" height="26" className="topbar-logo" />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
