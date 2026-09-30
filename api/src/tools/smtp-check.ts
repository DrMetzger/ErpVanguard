import { createTransport } from 'nodemailer'
import { DataSource } from 'typeorm'
import { SettingsService } from '../settings/settings.service'

// Diagnóstico do e-mail no deploy: usa a mesma configuração do sistema (tela ou servidor) e só confere
// conexão e login no SMTP, sem enviar nada. Nunca imprime a senha.
async function main() {
  const db = await new DataSource({ type: 'postgres', url: process.env.DATABASE_URL }).initialize()
  try {
    const settings = new SettingsService(db)
    const s = await settings.smtp()
    const mask = (v: string | null) => (v ? v.replace(/^(.).*(@.*)$/, '$1***$2') : '(vazio)')
    console.log(`Origem da configuração: ${s.source === 'tela' ? 'Administração › Configurações' : s.source === 'servidor' ? 'secrets do GitHub (SMTP_*)' : 'nenhuma'}`)
    if (!s.host) { console.log('SMTP: não configurado'); return }
    console.log(`Servidor: ${s.host}:${s.port} (${s.security}) · usuário ${mask(s.user)} · senha ${s.password ? 'preenchida' : 'VAZIA'} · remetente ${mask(s.fromEmail)}`)
    const transport = createTransport({
      host: s.host, port: s.port, secure: s.security === 'ssl', requireTLS: s.security === 'starttls', ignoreTLS: s.security === 'nenhuma',
      auth: s.user ? { user: s.user, pass: s.password ?? '' } : undefined, connectionTimeout: 15_000, greetingTimeout: 10_000,
    })
    try {
      await transport.verify()
      console.log('SMTP: OK (conectou e o login foi aceito)')
    } catch (e) {
      console.log(`SMTP: FALHOU (${String((e as Error).message).replace(s.password || '\u0000', '***')})`)
    }
  } finally {
    await db.destroy()
  }
}
void main().catch((e) => { console.log(`SMTP: erro no diagnóstico (${(e as Error).message})`) })
