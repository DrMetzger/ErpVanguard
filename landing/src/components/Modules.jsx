import Icon from './Icon.jsx'
import { modules } from '../data.js'

export default function Modules() {
  return (
    <section id="modulos" className="section">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">Módulos</span>
          <h2>Tudo que sua operação precisa, conversando entre si</h2>
          <p>Cada módulo alimenta os outros automaticamente. Chega de redigitar dados e de planilhas paralelas.</p>
        </div>

        <div className="modules-grid">
          {modules.map((m) => (
            <article key={m.id} id={m.id} className={`module-card${m.featured ? ' module-featured' : ''}`}>
              <div className="module-icon"><Icon name={m.icon} /></div>
              <h3>{m.title}</h3>
              <p>{m.description}</p>
              <ul>
                {m.features.map((f) => (
                  <li key={f}><Icon name="check" size={16} /> {f}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
