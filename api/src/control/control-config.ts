// Configuração do painel da Prime ERP (admin.erpvanguard.com.br). Separada da do ERP de propósito.
// O painel NÃO tem acesso ao Docker nem ao servidor: só grava pedidos numa fila. Quem executa é o
// agente fixo da VPS (infra/agent.sh), que aceita apenas uma lista fechada de ações.
function required(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Variável de ambiente ${name} não definida`)
  return v
}

export const control = {
  port: Number(process.env.CONTROL_PORT ?? 3100),
  databaseUrl: required('CONTROL_DATABASE_URL'), // banco só do painel (vanguard_control, usuário sem privilégios)
  secret: required('CONTROL_SECRET'), // assina o login e criptografa a senha provisória dos clientes
  agentToken: required('AGENT_TOKEN'), // senha do agente da VPS (só ele busca a fila)
  ownerEmail: (process.env.CONTROL_OWNER_EMAIL ?? '').toLowerCase().trim(), // primeiro administrador do painel
  baseDomain: process.env.BASE_DOMAIN ?? 'erpvanguard.com.br',
  publicIp: process.env.PUBLIC_IP ?? '187.127.44.242',
  smtp: { host: process.env.SMTP_HOST || null, port: Number(process.env.SMTP_PORT) || 587, user: process.env.SMTP_USER || null, pass: process.env.SMTP_PASS || null, from: process.env.SMTP_FROM || process.env.SMTP_USER || null },
}
