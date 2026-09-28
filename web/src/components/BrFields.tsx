import { Anchor, Badge, Button, Group, Loader, Paper, Select, SimpleGrid, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { IconBuildingBank } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { validCnpj, validCpf } from '../lib/br'
import { date, money } from '../lib/format'
import { applyMask } from '../lib/mask'
import type { FieldDef } from '../lib/types'

type Patch = (values: Record<string, unknown>) => void
const common = (f: FieldDef) => ({ label: f.label, description: f.help, required: f.required })
const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

// CPF/CNPJ com máscara, conferência dos dígitos e botão Consultar (Receita só tem consulta pública de CNPJ).
export function DocumentInput({ field, value, onChange, onLookup, busy }: { field: FieldDef; value: unknown; onChange: (v: string) => void; onLookup?: () => void; busy?: boolean }) {
  const d = onlyDigits(value)
  const error = d.length === 11 ? (validCpf(d) ? null : 'CPF inválido') : d.length === 14 ? (validCnpj(d) ? null : 'CNPJ inválido') : null
  const isCnpj = d.length === 14 && !error
  const button = onLookup && (
    <Tooltip label={d.length === 11 ? 'A Receita não tem consulta pública de CPF: preencha os dados à mão' : 'Traz os dados da Receita Federal'} withArrow>
      <span><Button size="compact-xs" variant={isCnpj ? 'filled' : 'light'} onClick={onLookup} disabled={!isCnpj} loading={busy} leftSection={<IconBuildingBank size={12} />} aria-label="Consultar na Receita">Consultar</Button></span>
    </Tooltip>
  )
  return (
    <TextInput {...common(field)} inputMode="numeric" value={applyMask('cpf_cnpj', String(value ?? ''))} error={error} maxLength={18}
      onChange={(e) => onChange(onlyDigits(e.currentTarget.value).slice(0, 14))} rightSectionWidth={onLookup ? 108 : undefined} rightSection={button} />
  )
}

export function PhoneInput({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: string) => void }) {
  const d = onlyDigits(value)
  return <TextInput {...common(field)} inputMode="tel" placeholder="(00) 00000-0000" value={applyMask('telefone', d)} maxLength={15}
    error={d && d.length < 10 ? 'Informe DDD + número' : null} onChange={(e) => onChange(onlyDigits(e.currentTarget.value).slice(0, 11))} />
}

// CEP: ao completar os 8 dígitos busca o endereço e o código IBGE do município.
export function ZipInput({ field, value, onChange, patch }: { field: FieldDef; value: unknown; onChange: (v: string) => void; patch: Patch }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const d = onlyDigits(value)
  const search = async (zip: string) => {
    setLoading(true); setError(null)
    try {
      const r = await api<Record<string, string | null>>(`/cep/${zip}`)
      patch(Object.fromEntries(Object.entries({ street: r.street, district: r.district, city: r.city, cityCode: r.cityCode, uf: r.uf, complement: r.complement }).filter(([, v]) => v)))
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }
  return <TextInput {...common(field)} inputMode="numeric" placeholder="00000-000" value={applyMask('cep', d)} maxLength={9} error={error}
    rightSection={loading ? <Loader size={14} /> : undefined}
    onChange={(e) => { const z = onlyDigits(e.currentTarget.value).slice(0, 8); onChange(z); setError(null); if (z.length === 8 && z !== d) search(z) }} />
}

const cities = new Map<string, Promise<{ code: string; name: string }[]>>()
const loadCities = (uf: string) => { if (!cities.has(uf)) cities.set(uf, api<{ code: string; name: string }[]>(`/municipalities?uf=${uf}`).catch((e) => { cities.delete(uf); throw e })); return cities.get(uf)! }

// Cidade: lista dos municípios da UF escolhida (IBGE); guarda nome oficial e código.
export function CitySelect({ field, value, uf, patch }: { field: FieldDef; value: unknown; uf: string; patch: Patch }) {
  const [list, setList] = useState<{ code: string; name: string }[]>([])
  useEffect(() => { setList([]); if (uf) loadCities(uf).then(setList).catch(() => setList([])) }, [uf])
  const name = String(value ?? '')
  const data = list.map((c) => ({ value: c.name, label: c.name }))
  if (name && !list.some((c) => c.name === name)) data.unshift({ value: name, label: `${name} (fora da lista do IBGE)` })
  return <Select {...common(field)} searchable clearable data={data} value={name || null} disabled={!uf} limit={60}
    placeholder={uf ? `Digite para buscar em ${uf}` : 'Escolha a UF primeiro'} nothingFoundMessage="Município não encontrado nesta UF"
    onChange={(v) => patch({ city: v ?? '', cityCode: list.find((c) => c.name === v)?.code ?? '' })} />
}

// Inscrição estadual: números ou ISENTO, conferida pela regra da UF ao sair do campo.
export function IeInput({ field, value, uf, onChange }: { field: FieldDef; value: unknown; uf: string; onChange: (v: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  const last = useRef('')
  const v = String(value ?? '')
  const check = async () => {
    const key = `${uf}|${v}`
    if (!v || !uf || key === last.current) { if (!v) setError(null); return }
    last.current = key
    try { setError((await api<{ valid: boolean }>(`/validate/ie?uf=${uf}&ie=${encodeURIComponent(v)}`)).valid ? null : `Inscrição estadual inválida para ${uf}`) } catch { /* confere ao salvar */ }
  }
  useEffect(() => { last.current = ''; if (v) check() }, [uf]) // eslint-disable-line react-hooks/exhaustive-deps
  const isento = v.toUpperCase() === 'ISENTO'
  return <TextInput {...common(field)} value={v} maxLength={20} error={error} placeholder={uf ? `Inscrição em ${uf}` : 'Escolha a UF'}
    styles={{ input: { textTransform: 'uppercase' } }} onChange={(e) => { onChange(e.currentTarget.value); setError(null) }} onBlur={check}
    rightSectionWidth={70} rightSection={<Button size="compact-xs" variant={isento ? 'filled' : 'light'} onClick={() => { onChange(isento ? '' : 'ISENTO'); setError(null) }}>Isento</Button>} />
}

interface Receita {
  situacao?: string | null; dataSituacao?: string | null; abertura?: string | null; naturezaJuridica?: string | null; porte?: string | null; capitalSocial?: number | null
  cnaePrincipal?: { code: string; description: string } | null; cnaesSecundarios?: { code: string; description: string }[]; simples?: boolean | null; mei?: boolean | null
  socios?: { nome: string; qualificacao: string | null }[]; fonte?: string; consultadoEm?: string
}

// Tudo o que a Receita trouxe: situação, CNAEs, natureza, porte, capital, Simples/MEI e sócios.
export function ReceitaPanel({ data }: { data: unknown }) {
  const [all, setAll] = useState(false)
  if (!data || typeof data !== 'object') return null
  const r = data as Receita
  const sec = r.cnaesSecundarios ?? []
  const item = (label: string, v: React.ReactNode) => <div><Text size="xs" c="dimmed">{label}</Text><Text size="sm">{v || '—'}</Text></div>
  return (
    <Paper withBorder p="sm" radius="md">
      <Group justify="space-between" mb="xs">
        <Group gap="xs"><IconBuildingBank size={18} /><Text fw={600} size="sm">Dados da Receita Federal</Text>
          {r.situacao && <Badge color={r.situacao === 'ATIVA' ? 'teal' : 'red'} variant="light">{r.situacao}</Badge>}</Group>
        {r.consultadoEm && <Text size="xs" c="dimmed">Consultado em {new Date(r.consultadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}{r.fonte ? ` · ${r.fonte}` : ''}</Text>}
      </Group>
      <Stack gap="xs">
        {item('CNAE principal', r.cnaePrincipal ? `${r.cnaePrincipal.code} · ${r.cnaePrincipal.description}` : null)}
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
          {item('Abertura', r.abertura ? date(r.abertura) : null)}
          {item('Natureza jurídica', r.naturezaJuridica)}
          {item('Porte', r.porte)}
          {item('Capital social', r.capitalSocial != null ? money(r.capitalSocial) : null)}
          {item('Simples Nacional', r.simples == null ? null : r.simples ? 'Optante' : 'Não optante')}
          {item('MEI', r.mei == null ? null : r.mei ? 'Sim' : 'Não')}
          {item('Situação desde', r.dataSituacao ? date(r.dataSituacao) : null)}
        </SimpleGrid>
        {sec.length > 0 && <div>
          <Text size="xs" c="dimmed">CNAEs secundários ({sec.length})</Text>
          {(all ? sec : sec.slice(0, 3)).map((c) => <Text key={c.code} size="sm">{c.code} · {c.description}</Text>)}
          {sec.length > 3 && <Anchor size="xs" component="button" type="button" onClick={() => setAll(!all)}>{all ? 'Mostrar menos' : `Ver todos (${sec.length})`}</Anchor>}
        </div>}
        {(r.socios?.length ?? 0) > 0 && item('Sócios', r.socios!.map((s) => `${s.nome}${s.qualificacao ? ` (${s.qualificacao})` : ''}`).join(' · '))}
      </Stack>
    </Paper>
  )
}
