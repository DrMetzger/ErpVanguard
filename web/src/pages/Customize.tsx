import { ActionIcon, Badge, Button, Card, Group, Modal, NavLink, Select, SimpleGrid, Stack, Switch, Table, TagsInput, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconEdit, IconForms, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { Loading } from '../components/ui'
import { api } from '../lib/api'
import { loadMeta } from '../lib/catalog'
import { clearCustomization, type CustomField, type Customization } from '../lib/custom'
import { useAction, useApi } from '../lib/hooks'

const TYPES = [{ value: 'text', label: 'Texto' }, { value: 'number', label: 'Número' }, { value: 'date', label: 'Data' }, { value: 'bool', label: 'Sim/Não' }, { value: 'select', label: 'Lista de opções' }]
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c$1').slice(0, 40)

// Administração: campos novos nos cadastros e ajuste dos formulários (esconder, renomear, reordenar).
export default function Customize() {
  const { data, reload } = useApi<Customization[]>('/custom-fields')
  const [current, setCurrent] = useState('customers')
  const [editing, setEditing] = useState<Partial<CustomField> | null>(null)
  const { run } = useAction()
  if (!data) return <Loading />
  const res = data.find((r) => r.resource === current)!
  const refresh = () => { clearCustomization(); reload() }
  const remove = (f: CustomField) => confirm(`Excluir o campo "${f.label}"? Os valores já digitados ficam guardados e voltam se o campo for recriado com o mesmo nome interno.`)
    && run(() => api(`/custom-fields/${current}/${f.id}`, { method: 'DELETE' }).then(refresh), 'Campo excluído')

  return (
    <>
      <Title order={2} mb={4}>Personalizar cadastros</Title>
      <Text c="dimmed" mb="lg">Crie campos novos e ajuste os formulários. Vale para todos os usuários.</Text>
      <SimpleGrid cols={{ base: 1, md: 4 }} spacing="lg">
        <Card p="xs">
          {data.map((r) => (
            <NavLink key={r.resource} label={r.title} active={r.resource === current} onClick={() => setCurrent(r.resource)} variant="light" styles={{ root: { borderRadius: 8 } }}
              rightSection={r.fields.length ? <Badge size="sm" variant="light" radius="sm">{r.fields.length}</Badge> : undefined} />
          ))}
        </Card>
        <Stack className="customize-main">
          <Card>
            <Group justify="space-between" mb="sm">
              <div><Text fw={700}>Campos personalizados · {res.title}</Text><Text size="sm" c="dimmed">Aparecem no formulário e, se quiser, como coluna na lista.</Text></div>
              <Button leftSection={<IconPlus size={18} />} onClick={() => setEditing({})}>Novo campo</Button>
            </Group>
            {res.fields.length === 0 ? <Text size="sm" c="dimmed">Nenhum campo personalizado ainda.</Text> : (
              <Table>
                <Table.Thead><Table.Tr><Table.Th>Rótulo</Table.Th><Table.Th>Nome interno</Table.Th><Table.Th>Tipo</Table.Th><Table.Th>Obrigatório</Table.Th><Table.Th>Na lista</Table.Th><Table.Th w={80} /></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {res.fields.map((f) => (
                    <Table.Tr key={f.id} opacity={f.active ? 1 : 0.5}>
                      <Table.Td fw={600}>{f.label}{!f.active && <Text span size="xs" c="dimmed"> (inativo)</Text>}</Table.Td>
                      <Table.Td ff="monospace" fz="sm">{f.key}</Table.Td>
                      <Table.Td>{TYPES.find((t) => t.value === f.type)?.label}{f.type === 'select' && <Text size="xs" c="dimmed">{f.options.join(', ')}</Text>}</Table.Td>
                      <Table.Td>{f.required ? 'Sim' : 'Não'}</Table.Td>
                      <Table.Td>{f.showInList ? 'Sim' : 'Não'}</Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Tooltip label="Editar"><ActionIcon variant="subtle" onClick={() => setEditing(f)} aria-label={`Editar ${f.label}`}><IconEdit size={16} /></ActionIcon></Tooltip>
                          <Tooltip label="Excluir"><ActionIcon variant="subtle" color="red" onClick={() => remove(f)} aria-label={`Excluir ${f.label}`}><IconTrash size={16} /></ActionIcon></Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
          <LayoutEditor key={current + JSON.stringify(res.layout) + res.fields.length} res={res} onSaved={refresh} />
        </Stack>
      </SimpleGrid>
      {editing && <FieldModal resource={current} field={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
    </>
  )
}

function FieldModal({ resource, field, onClose, onSaved }: { resource: string; field: Partial<CustomField>; onClose: () => void; onSaved: () => void }) {
  const isNew = !field.id
  const [form, setForm] = useState({ label: field.label ?? '', key: field.key ?? '', type: field.type ?? 'text', options: field.options ?? [], required: field.required ?? false, showInList: field.showInList ?? false, help: field.help ?? '', active: field.active ?? true })
  const [touchedKey, setTouchedKey] = useState(false)
  const { busy, run } = useAction()
  const submit = () => run(async () => {
    const body = { label: form.label, options: form.options, required: form.required, showInList: form.showInList, help: form.help || undefined, active: form.active }
    await api(isNew ? `/custom-fields/${resource}` : `/custom-fields/${resource}/${field.id}`, { method: isNew ? 'POST' : 'PATCH', body: isNew ? { ...body, key: form.key, type: form.type } : body })
    onSaved()
  }, 'Campo salvo')
  return (
    <Modal opened onClose={onClose} title={isNew ? 'Novo campo' : `Editar campo · ${field.label}`} size="lg">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Rótulo" placeholder="Ex.: Limite de crédito" value={form.label} required data-autofocus
            onChange={(e) => { const label = e.currentTarget.value; setForm((f) => ({ ...f, label, key: isNew && !touchedKey ? slug(label) : f.key })) }} />
          <TextInput label="Nome interno" description="Usado na API de integração; não muda depois" value={form.key} disabled={!isNew} ff="monospace"
            onChange={(e) => { setTouchedKey(true); setForm({ ...form, key: e.currentTarget.value }) }} />
          <Select label="Tipo" data={TYPES} value={form.type} onChange={(v) => setForm({ ...form, type: (v ?? 'text') as CustomField['type'] })} disabled={!isNew} allowDeselect={false} />
          <TextInput label="Ajuda (opcional)" value={form.help} onChange={(e) => setForm({ ...form, help: e.currentTarget.value })} />
        </SimpleGrid>
        {form.type === 'select' && <TagsInput label="Opções" description="Digite e tecle Enter" value={form.options} onChange={(v) => setForm({ ...form, options: v })} />}
        <Group>
          <Switch label="Obrigatório" checked={form.required} onChange={(e) => setForm({ ...form, required: e.currentTarget.checked })} />
          <Switch label="Mostrar na lista" checked={form.showInList} onChange={(e) => setForm({ ...form, showInList: e.currentTarget.checked })} />
          {!isNew && <Switch label="Ativo" checked={form.active} onChange={(e) => setForm({ ...form, active: e.currentTarget.checked })} />}
        </Group>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={busy} disabled={form.label.trim().length < 2 || !form.key}>Salvar</Button></Group>
      </Stack>
    </Modal>
  )
}

interface Row { key: string; label: string; original: string; required: boolean; visible: boolean }

function LayoutEditor({ res, onSaved }: { res: Customization; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const { busy, run } = useAction()
  useEffect(() => {
    // Campos padrão (as telas de cadastro genéricas usam a mesma lista da API) + personalizados
    loadMeta().then(() => {
      const all = [
        ...res.standard.map((f) => ({ key: f.key, original: f.label, required: !!f.required })),
        ...res.fields.map((f) => ({ key: `custom.${f.key}`, original: f.label, required: f.required })),
      ]
      const pos = (k: string) => { const i = res.layout.order.indexOf(k); return i < 0 ? 1000 + all.findIndex((f) => f.key === k) : i }
      setRows(all.sort((a, b) => pos(a.key) - pos(b.key)).map((f) => ({ ...f, label: res.layout.labels[f.key] ?? '', visible: !res.layout.hidden.includes(f.key) })))
    })
  }, [res])
  const move = (i: number, d: -1 | 1) => setRows((r) => { const c = [...r]; const j = i + d; if (j < 0 || j >= c.length) return r; [c[i], c[j]] = [c[j]!, c[i]!]; return c })
  const save = () => run(async () => {
    await api(`/custom-fields/${res.resource}/layout`, { method: 'PUT', body: { hidden: rows.filter((r) => !r.visible).map((r) => r.key), order: rows.map((r) => r.key), labels: Object.fromEntries(rows.filter((r) => r.label.trim()).map((r) => [r.key, r.label.trim()])) } })
    onSaved()
  }, 'Formulário salvo')

  return (
    <Card>
      <Group justify="space-between" mb="sm">
        <div><Group gap="xs"><IconForms size={18} /><Text fw={700}>Formulário · {res.title}</Text></Group><Text size="sm" c="dimmed">Ordem, nome na tela e campos escondidos. Campos obrigatórios não podem ser escondidos.</Text></div>
        <Button onClick={save} loading={busy}>Salvar formulário</Button>
      </Group>
      <Table>
        <Table.Thead><Table.Tr><Table.Th w={80}>Ordem</Table.Th><Table.Th>Campo</Table.Th><Table.Th>Nome na tela</Table.Th><Table.Th w={100}>Visível</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {rows.map((r, i) => (
            <Table.Tr key={r.key} opacity={r.visible ? 1 : 0.5}>
              <Table.Td>
                <Group gap={2} wrap="nowrap">
                  <ActionIcon variant="subtle" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir ${r.original}`}><IconArrowUp size={14} /></ActionIcon>
                  <ActionIcon variant="subtle" size="sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Descer ${r.original}`}><IconArrowDown size={14} /></ActionIcon>
                </Group>
              </Table.Td>
              <Table.Td><Text size="sm">{r.original}</Text>{r.key.startsWith('custom.') && <Badge size="xs" variant="light" radius="sm">personalizado</Badge>}</Table.Td>
              <Table.Td><TextInput size="xs" placeholder={r.original} value={r.label} onChange={(e) => { const v = e.currentTarget.value; setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, label: v } : x))) }} aria-label={`Nome na tela de ${r.original}`} /></Table.Td>
              <Table.Td><Switch checked={r.visible} disabled={r.required} onChange={(e) => { const v = e.currentTarget.checked; setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, visible: v } : x))) }} aria-label={`Mostrar ${r.original}`} /></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  )
}
