import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import Icon from '../components/Icon.jsx'
import { modules } from '../modules.js'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default function Dashboard() {
  const { user } = useAuth()
  const [products, setProducts] = useState(null)

  useEffect(() => {
    api('/products').then(setProducts).catch(() => setProducts([]))
  }, [])

  const low = products?.filter((p) => p.active && p.stock <= p.minStock).length ?? '—'
  const value = products ? money.format(products.reduce((sum, p) => sum + p.stock * p.costPrice, 0)) : '—'

  return (
    <>
      <h1>Olá, {user.name.split(' ')[0]}</h1>
      <p className="muted">Visão geral da sua operação.</p>

      <div className="stats">
        <div className="card stat"><small>Produtos cadastrados</small><b>{products?.length ?? '—'}</b></div>
        <div className="card stat"><small>Abaixo do estoque mínimo</small><b>{low}</b></div>
        <div className="card stat"><small>Valor do estoque (custo)</small><b>{value}</b></div>
      </div>

      <h2>Módulos</h2>
      <div className="module-grid">
        {modules.map((m) => (
          <Link key={m.path} to={m.path} className="card module-link">
            <span className="module-icon"><Icon name={m.icon} /></span>
            <strong>{m.title}</strong>
            <small className="muted">{m.soon ? 'Em construção' : 'Disponível'}</small>
          </Link>
        ))}
      </div>
    </>
  )
}
