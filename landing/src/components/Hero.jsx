import Icon from './Icon.jsx'
import { modules } from '../data.js'

export default function Hero() {
  return (
    <section id="topo" className="hero">
      <div className="container hero-inner">
        <div className="hero-copy">
          <span className="eyebrow">ERP 100% na nuvem · Web e Android</span>
          <h1>
            Sua empresa inteira em <span className="gradient-text">um só sistema</span>
          </h1>
          <p className="lead">
            Compras, estoque, faturamento, financeiro e BI avançado em um só lugar. Tudo integrado
            de fábrica ao WhatsApp, ao Mercado Livre, à Shopee e ao Magalu.
          </p>
          <div className="hero-actions">
            <a href="#contato" className="btn btn-primary">
              Quero conhecer <Icon name="arrow" size={18} />
            </a>
            <a href="#modulos" className="btn btn-ghost">Ver módulos</a>
          </div>
          <ul className="hero-stats">
            <li><strong>{modules.length}</strong> módulos integrados</li>
            <li><strong>4</strong> integrações nativas</li>
            <li><strong>1</strong> app Android</li>
          </ul>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="mock-window">
            <div className="mock-bar"><span /><span /><span /></div>
            <div className="mock-body">
              <div className="mock-sidebar">
                {modules.slice(0, 6).map((m) => (
                  <div key={m.id} className="mock-nav-item">
                    <Icon name={m.icon} size={14} /> {m.title}
                  </div>
                ))}
              </div>
              <div className="mock-content">
                <div className="mock-cards">
                  <div className="mock-card"><small>Faturamento do mês</small><b>R$ 482.930</b></div>
                  <div className="mock-card"><small>Pedidos marketplaces</small><b>1.284</b></div>
                </div>
                <div className="mock-chart">
                  {[40, 65, 52, 80, 70, 95, 88].map((h, i) => (
                    <span key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
