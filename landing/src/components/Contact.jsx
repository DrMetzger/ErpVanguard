import { useState } from 'react'
import { WHATSAPP_NUMBER, modules } from '../data.js'

export default function Contact() {
  const [form, setForm] = useState({ nome: '', empresa: '', telefone: '', modulo: '' })

  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  // Enquanto o backend não existe, o lead segue direto para o WhatsApp comercial.
  const submit = (e) => {
    e.preventDefault()
    const text =
      `Olá! Quero conhecer o ERP Vanguard.\n` +
      `Nome: ${form.nome}\nEmpresa: ${form.empresa}\nTelefone: ${form.telefone}` +
      (form.modulo ? `\nInteresse: ${form.modulo}` : '')
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }

  return (
    <section id="contato" className="section section-alt">
      <div className="container contact-inner">
        <div>
          <span className="eyebrow">Contato</span>
          <h2>Agende uma demonstração gratuita</h2>
          <p className="lead">
            Conte um pouco sobre sua empresa e nosso time responde pelo WhatsApp.
          </p>
        </div>

        <form className="contact-form" onSubmit={submit}>
          <label>
            Nome
            <input name="nome" required value={form.nome} onChange={update} autoComplete="name" />
          </label>
          <label>
            Empresa
            <input name="empresa" required value={form.empresa} onChange={update} autoComplete="organization" />
          </label>
          <label>
            WhatsApp
            <input name="telefone" type="tel" required value={form.telefone} onChange={update} autoComplete="tel" placeholder="(00) 00000-0000" />
          </label>
          <label>
            Módulo de maior interesse
            <select name="modulo" value={form.modulo} onChange={update}>
              <option value="">Todos / não sei ainda</option>
              {modules.map((m) => <option key={m.id}>{m.title}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-primary">Falar com um especialista</button>
        </form>
      </div>
    </section>
  )
}
