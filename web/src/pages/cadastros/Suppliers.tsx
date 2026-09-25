import { ActionIcon, Button, Card, Group, Modal, SimpleGrid, Stack, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconEdit, IconPlus, IconSearch } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { Empty, Loading } from '../../components/ui'
import { api } from '../../lib/api'
import { cnpj } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'
import type { Supplier } from '../../lib/types'
import { CustomFieldsInputs, customBody, customDisplay } from '../../components/CustomFields'
import { layoutHelpers, useCustomization, type Customization } from '../../lib/custom'

export default function Suppliers() {
  const [query, setQuery] = useState('')
  const [q] = useDebouncedValue(query.trim(), 250)
  const { data, loading, reload } = useApi<Supplier[]>(`/suppliers${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null)
  const custom = useCustomization('suppliers')
  const cols = custom?.fields.filter((f) => f.showInList) ?? []

  return (
    <>
      <Group justify="space-between" mb="md">
        <TextInput placeholder="Buscar por nome ou CNPJ" leftSection={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} style={{ flex: 1, maxWidth: 420 }} />
        <Button leftSection={<IconPlus size={18} />} onClick={() => setEditing({})}>Novo fornecedor</Button>
      </Group>
      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={760}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Fornecedor</Table.Th><Table.Th>CNPJ/CPF</Table.Th><Table.Th>Cidade</Table.Th><Table.Th>Contato</Table.Th>{cols.map((f) => <Table.Th key={f.key}>{custom!.layout.labels[`custom.${f.key}`] || f.label}</Table.Th>)}<Table.Th w={60} /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {data?.map((s) => (
                  <Table.Tr key={s.id} opacity={s.active ? 1 : 0.5}>
                    <Table.Td><Text size="sm" fw={600}>{s.name}</Text>{s.tradeName && s.tradeName !== s.name && <Text size="xs" c="dimmed">{s.tradeName}</Text>}</Table.Td>
                    <Table.Td ff="monospace" fz="sm">{cnpj(s.cnpj)}</Table.Td>
                    <Table.Td>{[s.city, s.uf].filter(Boolean).join(' / ') || '—'}</Table.Td>
                    <Table.Td>{s.email || s.phone || '—'}</Table.Td>
                    {cols.map((f) => <Table.Td key={f.key}>{customDisplay(f, s.custom?.[f.key])}</Table.Td>)}
                    <Table.Td><Tooltip label="Editar"><ActionIcon variant="subtle" onClick={() => setEditing(s)} aria-label="Editar"><IconEdit size={17} /></ActionIcon></Tooltip></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data?.length === 0 && <Empty>Nenhum fornecedor. Eles também são cadastrados sozinhos ao importar um XML.</Empty>}
      </Card>
      {editing && <SupplierForm custom={custom} supplier={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function SupplierForm({ supplier, custom, onClose, onSaved }: { supplier: Partial<Supplier>; custom: Customization | null; onClose: () => void; onSaved: () => void }) {
  const L = layoutHelpers(custom?.layout)
  const [extra, setExtra] = useState<Record<string, unknown>>(() => ({ ...(supplier.custom ?? {}) }))
  const isNew = !supplier.id
  const [form, setForm] = useState({
    cnpj: supplier.cnpj ? cnpj(supplier.cnpj) : '', name: supplier.name ?? '', tradeName: supplier.tradeName ?? '', email: supplier.email ?? '',
    phone: supplier.phone ?? '', city: supplier.city ?? '', uf: supplier.uf ?? '', active: supplier.active ?? true,
  })
  const { busy, run } = useAction()
  const lookup = () => run(async () => {
    const d = await api<Record<string, string | null>>(`/cnpj/${form.cnpj.replace(/\D/g, '')}`)
    setForm((f) => ({ ...f, name: d.name ?? f.name, tradeName: d.tradeName ?? f.tradeName, email: d.email ?? f.email, phone: d.phone ?? f.phone, city: d.city ?? f.city, uf: d.uf ?? f.uf }))
  }, 'Dados da Receita preenchidos')
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.currentTarget.value })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body: Record<string, unknown> = { cnpj: form.cnpj, name: form.name }
    for (const k of ['tradeName', 'phone', 'city', 'uf'] as const) body[k] = form[k].trim() || (isNew ? undefined : '')
    if (form.email.trim()) body.email = form.email.trim()
    if (!isNew) body.active = form.active
    if (custom?.fields.length) body.custom = customBody(custom.fields, extra)
    run(() => api(isNew ? '/suppliers' : `/suppliers/${supplier.id}`, { method: isNew ? 'POST' : 'PATCH', body }).then(onSaved), 'Fornecedor salvo')
  }

  return (
    <Modal opened onClose={onClose} title={isNew ? 'Novo fornecedor' : 'Editar fornecedor'} size="lg">
      <Stack component="form" onSubmit={submit}>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label={L.label('cnpj', 'CNPJ/CPF')} style={{ order: L.order('cnpj') }} required inputMode="numeric" data-autofocus value={form.cnpj} onChange={set('cnpj')}
            rightSectionWidth={92} rightSection={<Button size="compact-xs" variant="light" onClick={lookup} disabled={form.cnpj.replace(/\D/g, '').length !== 14} aria-label="Buscar na Receita">Receita</Button>} />
          {L.show('phone') && <TextInput label={L.label('phone', 'Telefone')} style={{ order: L.order('phone') }} value={form.phone} onChange={set('phone')} />}
          <TextInput label={L.label('name', 'Razão social')} style={{ order: L.order('name') }} required value={form.name} onChange={set('name')} />
          {L.show('tradeName') && <TextInput label={L.label('tradeName', 'Nome fantasia')} style={{ order: L.order('tradeName') }} value={form.tradeName} onChange={set('tradeName')} />}
          {L.show('email') && <TextInput label={L.label('email', 'E-mail')} style={{ order: L.order('email') }} type="email" value={form.email} onChange={set('email')} />}
          <Group grow><TextInput label="Cidade" value={form.city} onChange={set('city')} /><TextInput label="UF" maxLength={2} value={form.uf} onChange={set('uf')} maw={80} /></Group>
        </SimpleGrid>
        <CustomFieldsInputs fields={custom?.fields ?? []} values={extra} onChange={setExtra} labels={custom?.layout.labels} />
        {!isNew && <Switch label="Fornecedor ativo" checked={form.active} onChange={(e) => setForm({ ...form, active: e.currentTarget.checked })} />}
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Salvar</Button></Group>
      </Stack>
    </Modal>
  )
}
