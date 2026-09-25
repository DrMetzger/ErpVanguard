import { Badge, Box, Center, Group, Loader, Select, Stack, Text, ThemeIcon, Title, type SelectProps } from '@mantine/core'
import { IconInbox } from '@tabler/icons-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { cnpj } from '../lib/format'
import { useApi } from '../lib/hooks'
import type { Product } from '../lib/types'

const STATUS: Record<string, [string, string]> = {
  aberta: ['Aberta', 'brand'], em_cotacao: ['Em cotação', 'yellow'], atendida: ['Atendida', 'teal'], cancelada: ['Cancelada', 'gray'],
  pendente: ['Pendente', 'brand'], cotacao: ['Em cotação', 'yellow'], pedido: ['Pedido gerado', 'teal'], cancelado: ['Cancelado', 'gray'],
  finalizada: ['Finalizada', 'teal'], aguardando_aprovacao: ['Aguardando aprovação', 'yellow'], aprovado: ['Aprovado', 'teal'],
  reprovado: ['Reprovado', 'red'], orcamento: ['Orçamento', 'brand'], faturado: ['Faturado', 'teal'], emitida: ['Emitida', 'teal'],
  aberto: ['Em aberto', 'brand'], parcial: ['Pago parcial', 'cyan'], pago: ['Pago', 'teal'], vencido: ['Vencido', 'red'], recebido_parcial: ['Recebido parcial', 'cyan'], recebido: ['Recebido', 'teal'], lancada: ['Lançada', 'teal'], pre_nota: ['Pré-nota', 'yellow'], em_negociacao: ['Em negociação', 'brand'], a_faturar: ['A faturar', 'yellow'], ganho: ['Ganho', 'teal'], perdido: ['Perdido', 'red'], classificada: ['Classificada', 'teal'],
}

export function Status({ value }: { value: string }) {
  const [label, color] = STATUS[value] ?? [value, 'gray']
  return <Badge color={color} variant="light" radius="sm" style={{ textTransform: 'none' }}>{label}</Badge>
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-end" mb="lg" gap="md">
      <Box>
        {back}
        <Title order={2}>{title}</Title>
        {description && <Text c="dimmed" size="sm" mt={4}>{description}</Text>}
      </Box>
      {actions && <Group gap="sm" className="no-print">{actions}</Group>}
    </Group>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <Stack align="center" gap="xs" py={48}>
      <ThemeIcon variant="light" size={48} radius="xl" color="gray"><IconInbox size={26} /></ThemeIcon>
      <Text c="dimmed" size="sm" ta="center" maw={420}>{children}</Text>
    </Stack>
  )
}

export function Loading() {
  return <Center py={80}><Loader type="dots" /></Center>
}

export function ErrorText({ error }: { error?: string }) {
  return error ? <Text c="red" size="sm" style={{ whiteSpace: 'pre-line' }}>{error}</Text> : null
}

// Busca de produto no cadastro (carrega conforme digita).
export function ProductSelect({ value, onChange, ...props }: { value: { id: string; sku: string | null; name: string | null } | null; onChange: (p: Product | null) => void } & Omit<SelectProps, 'value' | 'onChange' | 'data'>) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Product[]>([])

  useEffect(() => {
    const timer = setTimeout(() => {
      api<Product[]>(`/products?q=${encodeURIComponent(search)}`).then(setResults).catch(() => setResults([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [search])

  const options = results.slice(0, 40).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))
  if (value && !options.some((o) => o.value === value.id)) options.unshift({ value: value.id, label: `${value.sku} · ${value.name}` })

  return (
    <Select
      searchable
      clearable
      placeholder="Buscar produto…"
      nothingFoundMessage="Nenhum produto encontrado"
      filter={({ options }) => options}
      data={options}
      value={value?.id ?? null}
      onSearchChange={setSearch}
      onChange={(id) => onChange(id ? results.find((p) => p.id === id) ?? null : null)}
      comboboxProps={{ shadow: 'lg' }}
      {...props}
    />
  )
}

interface Branding { name: string; tradeName: string | null; document: string; ie: string | null; phone: string | null; email: string | null; street: string | null; number: string | null; district: string | null; city: string | null; uf: string; logo: string | null }

// Cabeçalho dos documentos impressos: logo e dados da matriz (Cadastros › Empresas).
export function ReportHeader({ title }: { title: string }) {
  const { data: b } = useApi<Branding | null>('/companies/branding')
  if (!b) return null
  const address = [b.street && `${b.street}${b.number ? `, ${b.number}` : ''}`, b.district, b.city && `${b.city}/${b.uf}`].filter(Boolean).join(' · ')
  return (
    <Group className="print-only report-header" justify="space-between" align="center" wrap="nowrap" mb="md" pb="sm">
      <Group gap="md" wrap="nowrap">
        {b.logo && <img src={b.logo} alt="" style={{ maxHeight: 64, maxWidth: 200, objectFit: 'contain' }} />}
        <div>
          <Text fw={800}>{b.name}</Text>
          <Text size="xs">CNPJ {cnpj(b.document)}{b.ie && ` · IE ${b.ie}`}</Text>
          {address && <Text size="xs">{address}</Text>}
          {(b.phone || b.email) && <Text size="xs">{[b.phone, b.email].filter(Boolean).join(' · ')}</Text>}
        </div>
      </Group>
      <Text fw={800} size="lg" ta="right">{title}</Text>
    </Group>
  )
}
