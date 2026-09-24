import Icon from './Icon.jsx'

const items = [
  'Consultar estoque e preços em tempo real',
  'Tirar pedidos de venda em campo',
  'Aprovar compras e pagamentos',
  'Acompanhar vendas dos marketplaces',
  'Ver os painéis de BI de qualquer lugar',
]

export default function MobileApp() {
  return (
    <section id="app" className="section">
      <div className="container app-inner">
        <div className="phone" aria-hidden="true">
          <div className="phone-screen">
            <div className="phone-header">
              <img src="/logo.svg" alt="" width="22" height="22" /> Vanguard
            </div>
            <div className="phone-punch">
              <small>Faturamento hoje</small>
              <b>R$ 18,4 mil</b>
              <span className="phone-btn">Ver painel</span>
            </div>
            <div className="phone-row"><span>Margem média</span><b>32%</b></div>
            <div className="phone-row"><span>Pedidos ML</span><b>37</b></div>
            <div className="phone-row"><span>A aprovar</span><b>5</b></div>
          </div>
        </div>

        <div>
          <span className="eyebrow">App Android</span>
          <h2>O ERP no bolso da sua equipe</h2>
          <p className="lead">
            Gestores, vendedores e colaboradores usam o mesmo sistema, de qualquer lugar.
          </p>
          <ul className="check-list">
            {items.map((t) => (
              <li key={t}><Icon name="check" size={18} /> {t}</li>
            ))}
          </ul>
          <span className="soon"><Icon name="phone" size={16} /> Em breve no Google Play</span>
        </div>
      </div>
    </section>
  )
}
