import { integrations } from '../data.js'

export default function Integrations() {
  return (
    <section id="integracoes" className="section section-alt">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">Integrações nativas</span>
          <h2>Venda e atenda onde seu cliente está</h2>
          <p>Já vem ativado por padrão. Sem plugin, sem hub de terceiros e sem mensalidade extra.</p>
        </div>

        <div className="integrations-grid">
          {integrations.map((i) => (
            <article key={i.id} className="integration-card">
              <div
                className="integration-badge"
                style={{ background: i.color, color: i.textColor || '#fff' }}
              >
                {i.name.charAt(0)}
              </div>
              <h3>{i.name}</h3>
              <p>{i.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
