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
}
