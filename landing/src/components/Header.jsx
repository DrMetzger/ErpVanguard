import { useState } from 'react'
import Icon from './Icon.jsx'

const links = [
  { href: '#modulos', label: 'Módulos' },
  { href: '#integracoes', label: 'Integrações' },
  { href: '#app', label: 'App Android' },
  { href: '#contato', label: 'Contato' },
]

export default function Header() {
  const [open, setOpen] = useState(false)

  return (
    <header className="header">
      <div className="container header-inner">
        <a href="#topo" className="brand" aria-label="ERP Vanguard, início">
          <img src="/logo.svg" alt="" width="36" height="36" />
          <span>ERP <strong>Vanguard</strong></span>
        </a>

        <nav className={`nav ${open ? 'nav-open' : ''}`} aria-label="Principal">
          {links.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          <a href="#contato" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>
            Agendar demonstração
          </a>
        </nav>

        <button
          className="menu-toggle"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? 'close' : 'menu'} />
        </button>
      </div>
    </header>
  )
}
