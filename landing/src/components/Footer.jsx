import { CONTACT_EMAIL, modules } from '../data.js'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          <a href="#topo" className="brand">
            <img src="/logo.svg" alt="" width="32" height="32" />
            <span>ERP <strong>Vanguard</strong></span>
          </a>
          <p>Gestão empresarial completa, na nuvem e no celular.</p>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </div>
        <div>
          <h4>Módulos</h4>
          <ul>
            {modules.map((m) => <li key={m.id}><a href={`#${m.id}`}>{m.title}</a></li>)}
          </ul>
        </div>
      </div>
      <div className="container footer-bottom">
        © {new Date().getFullYear()} ERP Vanguard · Prime ERP Soluções. Todos os direitos reservados.
      </div>
    </footer>
  )
}
