import { createTransport } from 'nodemailer'
import { control } from './control-config'

// E-mails do painel: código de acesso e dados do sistema novo do cliente.
export async function sendMail(to: string, subject: string, text: string) {
  const s = control.smtp
  if (!s.host || !s.from) throw new Error('E-mail do servidor (SMTP) não configurado')
  const t = createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: s.user ? { user: s.user, pass: s.pass ?? '' } : undefined, connectionTimeout: 15_000 })
  await t.sendMail({ from: s.from.includes('<') ? s.from : { name: 'ERP Vanguard', address: s.from }, to, subject, text })
}
