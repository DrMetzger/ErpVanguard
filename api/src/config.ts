function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Variável de ambiente ${name} não definida`)
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@erpvanguard.com.br',
  adminPassword: process.env.ADMIN_PASSWORD,
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  // Usados em ordem quando o modelo principal está lotado ou indisponível.
  geminiFallbackModels: (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.7-flash,gemini-3.5-flash,gemini-flash-lite-latest')
    .split(',').map((m) => m.trim()).filter(Boolean),
  // SMTP do servidor: usado quando não há configuração salva na tela (SMTP_FROM aceita "Nome <email>").
  smtp: {
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT) || null,
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS || null,
    from: process.env.SMTP_FROM || null,
  },
  // Origens do app Android (Capacitor). O site usa o mesmo domínio e não precisa de CORS.
  corsOrigins: (process.env.CORS_ORIGINS ?? 'https://localhost,capacitor://localhost').split(',').map((o) => o.trim()),
}
