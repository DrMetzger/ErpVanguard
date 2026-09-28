import { notifications } from '@mantine/notifications'
import { ActionIcon, Badge, Button, Card, Group, Modal, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconEdit, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../lib/api'
import { useUser } from '../lib/auth'
import { clearOptions, useOptions, useResource } from '../lib/catalog'
import { cnpj, date, qty, toNumber } from '../lib/format'
import { useAction, useApi } from '../lib/hooks'
import type { CatalogRow, FieldDef, ResourceMeta } from '../lib/types'
import { applyLayout, useCustomization, type Customization } from '../lib/custom'
import { customBody, customDisplay, CustomFieldsInputs } from './CustomFields'
import { BrNumber } from './inputs'
import { SheetMenu } from './SheetMenu'
import { CitySelect, DocumentInput, IeInput, PhoneInput, ReceitaPanel, ZipInput } from './BrFields'
import { applyMask } from '../lib/mask'
import { Empty, Loading } from './ui'

function display(f: FieldDef, row: CatalogRow): ReactNode {
  const v = row[f.key]
  if (v === null || v === undefined || v === '') return <Text c="dimmed" span>—</Text>
  switch (f.type) {
    case 'bool': return <Badge variant="dot" color={v ? 'teal' : 'gray'} miw={62}>{v ? 'Sim' : 'Não'}</Badge>
    case 'ref': return String(row[`${f.key}Label`] ?? '—')
    case 'enum': return f.options?.find((o) => o.value === v)?.label ?? String(v)
    case 'date': return date(String(v))
    case 'decimal': return qty(Number(v))
    case 'document': return <Text span ff="monospace" fz="sm">{cnpj(String(v))}</Text>
    case 'phone': return <Text span style={{ whiteSpace: 'nowrap' }}>{applyMask('telefone', String(v))}</Text>
    case 'zip': return applyMask('cep', String(v))
    case 'json': return '…'
    default: return String(v)
  }
}

const LOOKUP = ['customers', 'companies', 'suppliers']

// Tela de cadastro montada a partir da descrição vinda da API.
export function CatalogPage({ name, rowActions }: { name: string; rowActions?: (row: CatalogRow, reload: () => void) => ReactNode }) {
  const meta = useResource(name)
  const user = useUser()
  const [query, setQuery] = useState('')
  const [q] = useDebouncedValue(query.trim(), 250)
  const { data, loading, reload } = useApi<CatalogRow[]>(`/catalog/${name}${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  const [editing, setEditing] = useState<CatalogRow | Record<string, never> | null>(null)
  const { run } = useAction()
  const custom = useCustomization(meta?.customizable ? name : null)

  if (!meta) return <Loading />
  const canWrite = user.role === 'admin' || meta.write.some((p) => user.permissions.includes(p))
  const fields = applyLayout(meta.fields, custom?.layout)
  const columns = fields.filter((f) => f.list)
  const customColumns = custom?.fields.filter((f) => f.showInList) ?? []
  const remove = (row: CatalogRow) => confirm(`Excluir este(a) ${meta.singular}?`) && run(() => api(`/catalog/${name}/${row.id}`, { method: 'DELETE' }).then(() => { clearOptions(); reload() }), 'Excluído')

  return (
    <>
      <Group justify="space-between" align="flex-end" mb="md" gap="sm">
        <div>
          <Text fw={700} size="lg">{meta.title}</Text>
          <Text size="sm" c="dimmed">{meta.description}</Text>
        </div>
        <Group gap="xs">
          <SheetMenu name={name} title={meta.title} canWrite={canWrite} onImported={() => { clearOptions(); reload() }} />
          {canWrite && <Button leftSection={<IconPlus size={18} />} onClick={() => setEditing({})}>Novo(a) {meta.singular}</Button>}
        </Group>
      </Group>
      <TextInput placeholder="Buscar…" leftSection={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} maw={380} mb="md" aria-label={`Buscar ${meta.title}`} />
      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={Math.max(560, (columns.length + customColumns.length) * 150)}>
            <Table>
              <Table.Thead>
                <Table.Tr>{columns.map((f) => <Table.Th key={f.key} ta={f.type === 'decimal' || f.type === 'int' ? 'right' : undefined}>{f.label}</Table.Th>)}{customColumns.map((f) => <Table.Th key={f.key}>{custom!.layout.labels[`custom.${f.key}`] || f.label}</Table.Th>)}<Table.Th w={100} /></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.map((row) => (
                  <Table.Tr key={row.id} opacity={row.active === false ? 0.5 : 1}>
                    {columns.map((f) => <Table.Td key={f.key} ta={f.type === 'decimal' || f.type === 'int' ? 'right' : undefined} style={f.type === 'bool' ? { whiteSpace: 'nowrap' } : undefined}>{display(f, row)}</Table.Td>)}
                    {customColumns.map((f) => <Table.Td key={f.key}>{customDisplay(f, (row.custom as Record<string, unknown> | undefined)?.[f.key])}</Table.Td>)}
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        {rowActions?.(row, reload)}
                        {canWrite && <>
                          <Tooltip label="Editar"><ActionIcon variant="subtle" onClick={() => setEditing(row)} aria-label="Editar"><IconEdit size={17} /></ActionIcon></Tooltip>
                          <Tooltip label="Excluir"><ActionIcon variant="subtle" color="red" onClick={() => remove(row)} aria-label="Excluir"><IconTrash size={17} /></ActionIcon></Tooltip>
                        </>}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data?.length === 0 && <Empty>{q ? 'Nada encontrado.' : `Nenhum(a) ${meta.singular} cadastrado(a).`}</Empty>}
      </Card>
      {editing && <CatalogForm meta={{ ...meta, fields }} custom={custom} row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); clearOptions(); reload() }} />}
    </>
  )
}

function RefSelect({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: string | null) => void }) {
  const options = useOptions(field.ref)
  return (
    <Select label={field.label} description={field.help} required={field.required} searchable clearable={!field.required} data={options}
      value={(value as string) ?? null} onChange={onChange} nothingFoundMessage="Nada encontrado" comboboxProps={{ shadow: 'lg' }} />
  )
}

function Field({ field, value, onChange, onLookup, form, patch, busy }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void; onLookup?: () => void; form: Record<string, unknown>; patch: (v: Record<string, unknown>) => void; busy?: boolean }) {
  const common = { label: field.label, description: field.help, required: field.required }
  const uf = String(form.uf ?? '')
  switch (field.type) {
    case 'document': return <DocumentInput field={field} value={value} onChange={onChange} onLookup={onLookup} busy={busy} />
    case 'phone': return <PhoneInput field={field} value={value} onChange={onChange} />
    case 'zip': return <ZipInput field={field} value={value} onChange={onChange} patch={patch} />
    case 'city': return <CitySelect field={field} value={value} uf={uf} patch={patch} />
    case 'ie': return <IeInput field={field} value={value} uf={uf} onChange={onChange} />
    case 'bool': return <Switch label={field.label} checked={!!value} onChange={(e) => onChange(e.currentTarget.checked)} mt="lg" />
    case 'ref': return <RefSelect field={field} value={value} onChange={onChange} />
    case 'enum':
    case 'uf':
      return <Select {...common} data={field.options ?? []} value={(value as string) ?? null} onChange={onChange} clearable={!field.required} searchable={field.type === 'uf'} />
    case 'int':
    case 'decimal':
      return <BrNumber {...common} decimalScale={field.type === 'int' ? 0 : 4} value={(value as number) ?? ''} onChange={onChange} />
    case 'date': return <TextInput {...common} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.currentTarget.value)} />
    default:
      return <TextInput {...common} maxLength={field.max} value={(value as string) ?? ''} onChange={(e) => onChange(e.currentTarget.value)}
        styles={field.upper ? { input: { textTransform: 'uppercase' } } : undefined} />
  }
}

function CatalogForm({ meta, custom, row, onClose, onSaved }: { meta: ResourceMeta; custom: Customization | null; row: Partial<CatalogRow>; onClose: () => void; onSaved: () => void }) {
  const isNew = !row.id
  const [form, setForm] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(meta.fields.map((f) => [f.key, row[f.key] ?? (f.type === 'json' ? null : isNew ? f.default ?? (f.type === 'bool' ? false : '') : f.type === 'bool' ? false : '')])),
  )
  const [extra, setExtra] = useState<Record<string, unknown>>(() => ({ ...((row.custom as Record<string, unknown>) ?? {}) }))
  const { busy, run } = useAction()
  const lookupAction = useAction()
  const patch = (v: Record<string, unknown>) => setForm((s) => ({ ...s, ...v }))
  // Preenche com os dados da Receita Federal (só campos que existem neste cadastro)
  const lookup = (doc: string) => lookupAction.run(async () => {
    const d = await api<Record<string, unknown>>(`/cnpj/${doc.replace(/\D/g, '')}`)
    // Troca tudo o que a Receita informa (inclusive o que veio vazio): não sobra dado da empresa anterior.
    setForm((s) => ({ ...s, ...Object.fromEntries(meta.fields.filter((f) => f.key in d && f.type !== 'document' && !(f.type === 'uf' && !d[f.key]))
      .map((f) => [f.key, d[f.key] ?? (f.type === 'json' ? null : '')])) }))
    if (d.situation && d.situation !== 'ATIVA') throw new Error(`Atenção: situação na Receita é ${d.situation}`)
    if (meta.fields.some((f) => f.type === 'ie') && !d.ie) notifications.show({ color: 'yellow', message: 'A Receita não informou a inscrição estadual deste CNPJ: preencha à mão (ou marque Isento).' })
  }, 'Dados da Receita preenchidos')
  // Trocar a UF limpa a cidade (a lista de municípios muda).
  const change = (f: FieldDef, v: unknown) => setForm((s) => (f.type === 'uf' && v !== s[f.key] && meta.fields.some((x) => x.type === 'city') ? { ...s, [f.key]: v, city: '', cityCode: '' } : { ...s, [f.key]: v }))
  const receitaField = meta.fields.find((f) => f.type === 'json' && f.key === 'receita')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body: Record<string, unknown> = {}
    for (const f of meta.fields) {
      let v = form[f.key]
      if (f.type === 'int' || f.type === 'decimal') v = toNumber(v as number | string)
      if (v === '' || v === undefined) v = null
      if (isNew && v === null) continue
      body[f.key] = v
    }
    if (custom?.fields.length) body.custom = customBody(custom.fields, extra)
    run(() => api(isNew ? `/catalog/${meta.name}` : `/catalog/${meta.name}/${row.id}`, { method: isNew ? 'POST' : 'PATCH', body }).then(onSaved), 'Salvo')
  }

  return (
    <Modal opened onClose={onClose} title={`${isNew ? 'Novo(a)' : 'Editar'} ${meta.singular}`} size="xl">
      <Stack component="form" onSubmit={submit}>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {meta.fields.filter((f) => !f.hidden).map((f) => (
            <div key={f.key} style={{ gridColumn: f.span && f.span > 1 ? `span ${f.span}` : undefined }} className="catalog-field">
              <Field field={f} value={form[f.key]} form={form} patch={patch} busy={lookupAction.busy} onChange={(v) => change(f, v)} onLookup={f.type === 'document' && LOOKUP.includes(meta.name) ? () => lookup(String(form[f.key] ?? '')) : undefined} />
            </div>
          ))}
        </SimpleGrid>
        {receitaField && <ReceitaPanel data={form.receita} />}
        <CustomFieldsInputs fields={custom?.fields ?? []} values={extra} onChange={setExtra} labels={custom?.layout.labels} />
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Salvar</Button></Group>
      </Stack>
    </Modal>
  )
}
