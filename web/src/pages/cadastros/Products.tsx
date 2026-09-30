import { SheetMenu } from '../../components/SheetMenu'
import { useUser } from '../../lib/auth'
import { ActionIcon, Alert, Autocomplete, Avatar, Badge, Button, Card, Group, Modal, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconEdit, IconEye, IconPhoto, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { BrNumber, Money } from '../../components/inputs'
import { Empty, ErrorText, Loading, PageHeader } from '../../components/ui'
import { api } from '../../lib/api'
import { money, qty, toNumber } from '../../lib/format'
import { useOptions } from '../../lib/catalog'
import { useAction, useApi } from '../../lib/hooks'
import type { Product } from '../../lib/types'
import { CustomFieldsInputs, customBody, customDisplay } from '../../components/CustomFields'
import { layoutHelpers, useCustomization, type Customization } from '../../lib/custom'
import { ProductPhotos, uploadPending, type PendingPhoto } from '../../components/ProductPhotos'
import { ProductVideos } from '../../components/ProductVideos'

const ORIGINS = [
  { value: '0', label: '0 · Nacional' }, { value: '1', label: '1 · Estrangeira (importação direta)' }, { value: '2', label: '2 · Estrangeira (mercado interno)' },
  { value: '3', label: '3 · Nacional, importado > 40%' }, { value: '4', label: '4 · Nacional (processos básicos)' }, { value: '5', label: '5 · Nacional, importado ≤ 40%' },
  { value: '6', label: '6 · Estrangeira direta, sem similar' }, { value: '7', label: '7 · Estrangeira interna, sem similar' }, { value: '8', label: '8 · Nacional, importado > 70%' },
]

export default function Products() {
  const user = useUser()
  // Incluir/alterar/excluir: perfil Cadastros (Administração › Usuários); os outros só consultam
  const canWrite = user.role === 'admin' || user.permissions.includes('cadastro')
  const [query, setQuery] = useState('')
  const [q] = useDebouncedValue(query.trim(), 250)
  const { data, error, loading, reload } = useApi<Product[]>(`/products${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  const [editing, setEditing] = useState<Partial<Product> | null>(null)
  const { run } = useAction()
  const custom = useCustomization('products')
  const cols = custom?.fields.filter((f) => f.showInList) ?? []

  const remove = (p: Product) => {
    if (confirm(`Excluir o produto "${p.name}"?`)) run(() => api(`/products/${p.id}`, { method: 'DELETE' }).then(reload), 'Produto excluído')
  }

  return (
    <>
      <PageHeader title={<Text fw={700} size="lg">Produtos</Text>} description="Cadastro de produtos: código, tipo, grupo, unidade, NCM e preços." actions={<Group gap="xs"><SheetMenu name="products" title="Produtos" canWrite={canWrite} onImported={reload} />{canWrite && <Button leftSection={<IconPlus size={18} />} onClick={() => setEditing({})}>Novo produto</Button>}</Group>} />
      <TextInput placeholder="Buscar por nome ou código" leftSection={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} maw={420} mb="md" />
      <ErrorText error={error} />
      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={820}>
            <Table>
              <Table.Thead>
                <Table.Tr><Table.Th w={56} /><Table.Th>Código</Table.Th><Table.Th>Produto</Table.Th><Table.Th>Grupo</Table.Th><Table.Th>Un.</Table.Th><Table.Th ta="right">Custo</Table.Th><Table.Th ta="right">Venda</Table.Th><Table.Th ta="right">Estoque</Table.Th>{cols.map((f) => <Table.Th key={f.key}>{custom!.layout.labels[`custom.${f.key}`] || f.label}</Table.Th>)}<Table.Th w={90} /></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.map((p) => (
                  <Table.Tr key={p.id} opacity={p.active ? 1 : 0.5}>
                    <Table.Td><Avatar src={p.thumb} radius="md" size={40} alt="" style={{ cursor: 'pointer' }} onClick={() => setEditing(p)}><IconPhoto size={18} stroke={1.5} /></Avatar></Table.Td>
                    <Table.Td fw={600}>{p.sku}</Table.Td>
                    <Table.Td>{p.name}{p.typeLabel && <Text size="xs" c="dimmed">{p.typeLabel}</Text>}</Table.Td>
                    <Table.Td>{p.groupLabel ?? <Text c="dimmed" span>—</Text>}</Table.Td>
                    <Table.Td>{p.unit}</Table.Td>
                    <Table.Td ta="right">{money(p.costPrice)}</Table.Td>
                    <Table.Td ta="right">{money(p.salePrice)}</Table.Td>
                    <Table.Td ta="right">{p.stock <= p.minStock ? <Badge color="yellow" variant="light">{qty(p.stock)}</Badge> : qty(p.stock)}</Table.Td>
                    {cols.map((f) => <Table.Td key={f.key}>{customDisplay(f, p.custom?.[f.key])}</Table.Td>)}
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label={canWrite ? 'Editar' : 'Ver'}><ActionIcon variant="subtle" onClick={() => setEditing(p)} aria-label={canWrite ? 'Editar' : 'Ver'}>{canWrite ? <IconEdit size={17} /> : <IconEye size={17} />}</ActionIcon></Tooltip>
                        {canWrite && <Tooltip label="Excluir"><ActionIcon variant="subtle" color="red" onClick={() => remove(p)} aria-label="Excluir"><IconTrash size={17} /></ActionIcon></Tooltip>}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data?.length === 0 && <Empty>{q ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda. Clique em "Novo produto".'}</Empty>}
      </Card>
      {editing && <ProductForm readOnly={!canWrite} custom={custom} product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function ProductForm({ product, custom, onClose, onSaved, readOnly = false }: { product: Partial<Product>; custom: Customization | null; onClose: () => void; onSaved: () => void; readOnly?: boolean }) {
  const L = layoutHelpers(custom?.layout)
  const [extra, setExtra] = useState<Record<string, unknown>>(() => ({ ...(product.custom ?? {}) }))
  const [pending, setPending] = useState<PendingPhoto[]>([])
  const [photosChanged, setPhotosChanged] = useState(false)
  const isNew = !product.id
  const user = useUser()
  const branch = user.branches?.find((b) => b.id === user.branchId)
  const [form, setForm] = useState({
    sku: product.sku ?? '', name: product.name ?? '', barcode: product.barcode ?? '', ncm: product.ncm ?? '', unit: product.unit ?? 'UN',
    costPrice: product.costPrice ?? ('' as number | string), salePrice: product.salePrice ?? ('' as number | string),
    stock: product.stock ?? ('' as number | string), minStock: product.minStock ?? ('' as number | string), active: product.active ?? true,
    typeId: product.typeId ?? (null as string | null), groupId: product.groupId ?? (null as string | null), origin: String(product.origin ?? 0),
    classTribId: product.classTribId ?? (null as string | null),
  })
  const types = useOptions('product-types')
  const groups = useOptions('product-groups')
  const units = useApi<{ code: string; description: string; active: boolean }[]>('/catalog/units').data ?? []
  const ncms = useOptions('ncm')
  const classTribs = useOptions('class-trib')
  const { busy, run } = useAction()
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = (v: string) => (v.trim() ? v.trim() : isNew ? undefined : null)
    const body = {
      sku: form.sku.trim(), name: form.name.trim(), unit: form.unit.trim(), barcode: text(form.barcode), ncm: text(form.ncm),
      costPrice: toNumber(form.costPrice) ?? 0, salePrice: toNumber(form.salePrice) ?? 0, stock: toNumber(form.stock) ?? 0, minStock: toNumber(form.minStock) ?? 0,
      typeId: form.typeId ?? (isNew ? undefined : null), groupId: form.groupId ?? (isNew ? undefined : null), origin: Number(form.origin),
      classTribId: form.classTribId ?? (isNew ? undefined : null),
      ...(isNew ? {} : { active: form.active }),
      ...(custom?.fields.length ? { custom: customBody(custom.fields, extra) } : {}),
    }
    run(async () => {
      const saved = await api<Product>(isNew ? '/products' : `/products/${product.id}`, { method: isNew ? 'POST' : 'PATCH', body })
      if (isNew && pending.length) await uploadPending(saved.id, pending)
      onSaved()
    }, 'Produto salvo')
  }

  return (
    <Modal opened onClose={photosChanged ? onSaved : onClose} title={isNew ? 'Novo produto' : readOnly ? 'Produto' : 'Editar produto'} size="xl" closeOnEscape={false}>
      <Stack component="form" onSubmit={submit}>
        {readOnly && <Alert color="blue" variant="light">Só consulta: seu usuário não tem o perfil Cadastros. O administrador libera em Administração › Usuários.</Alert>}
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--mantine-spacing-md)' }}>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label={L.label('sku', 'Código (SKU)')} style={{ order: L.order('sku') }} required data-autofocus value={form.sku} onChange={(e) => set('sku', e.currentTarget.value)} />
          <TextInput label={L.label('name', 'Descrição')} required value={form.name} onChange={(e) => set('name', e.currentTarget.value)} style={{ gridColumn: 'span 2', order: L.order('name') }} />
          {L.show('barcode') && <TextInput label={L.label('barcode', 'Código de barras')} style={{ order: L.order('barcode') }} inputMode="numeric" value={form.barcode} onChange={(e) => set('barcode', e.currentTarget.value)} />}
          {L.show('ncm') && <Autocomplete label={L.label('ncm', 'NCM')} style={{ order: L.order('ncm') }} placeholder="8 dígitos" maxLength={8} inputMode="numeric" value={form.ncm} onChange={(v) => set('ncm', v.replace(/\D/g, '').slice(0, 8))}
            data={ncms.map((n) => ({ value: n.label.slice(0, 8), label: n.label }))} />}
          <Select label={L.label('unit', 'Unidade')} style={{ order: L.order('unit') }} required searchable data={units.filter((u) => u.active || u.code === form.unit).map((u) => ({ value: u.code, label: `${u.code} · ${u.description}` }))} value={form.unit} onChange={(v) => set('unit', v ?? 'UN')} />
          {L.show('typeId') && <Select label={L.label('typeId', 'Tipo (SPED)')} style={{ order: L.order('typeId') }} data={types} value={form.typeId} onChange={(v) => set('typeId', v)} clearable searchable />}
          {L.show('groupId') && <Select label={L.label('groupId', 'Grupo')} style={{ order: L.order('groupId') }} data={groups} value={form.groupId} onChange={(v) => set('groupId', v)} clearable searchable />}
          {L.show('origin') && <Select label={L.label('origin', 'Origem da mercadoria')} style={{ order: L.order('origin') }} data={ORIGINS} value={form.origin} onChange={(v) => set('origin', v ?? '0')} allowDeselect={false} />}
          {L.show('classTribId') && <Select label={L.label('classTribId', 'cClassTrib (IBS/CBS)')} style={{ order: L.order('classTribId') }} data={classTribs} value={form.classTribId} onChange={(v) => set('classTribId', v)} clearable searchable
            placeholder="O da TES" description="Só se este produto for diferente da TES (ex.: 200003 alimentos do Anexo I)" />}
          {L.show('costPrice') && <Money label={L.label('costPrice', 'Preço de custo')} style={{ order: L.order('costPrice') }} value={form.costPrice} onChange={(v) => set('costPrice', v)} />}
          {L.show('salePrice') && <Money label={L.label('salePrice', 'Preço de venda')} style={{ order: L.order('salePrice') }} value={form.salePrice} onChange={(v) => set('salePrice', v)} />}
          <BrNumber label={branch ? `Estoque atual (filial ${branch.code})` : 'Estoque atual'} description={branch && !isNew ? 'Mudar o saldo gera um ajuste de estoque nesta filial' : undefined} decimalScale={4} allowNegative value={form.stock} onChange={(v) => set('stock', v)} />
          {L.show('minStock') && <BrNumber label={L.label('minStock', 'Estoque mínimo')} style={{ order: L.order('minStock') }} decimalScale={4} value={form.minStock} onChange={(v) => set('minStock', v)} />}
        </SimpleGrid>
        {!isNew && (user.branches?.length ?? 0) > 1 && <BranchStock productId={product.id!} unit={form.unit} />}
        <ProductPhotos productId={product.id} pending={pending} onPending={setPending} onChanged={() => setPhotosChanged(true)} />
        <ProductVideos productId={product.id} />
        <CustomFieldsInputs fields={custom?.fields ?? []} values={extra} onChange={setExtra} labels={custom?.layout.labels} />
        {!isNew && <Switch label="Produto ativo" checked={form.active} onChange={(e) => set('active', e.currentTarget.checked)} />}
        </fieldset>
        <Group justify="flex-end"><Button variant="default" onClick={photosChanged ? onSaved : onClose}>{photosChanged || readOnly ? 'Fechar' : 'Cancelar'}</Button>{!readOnly && <Button type="submit" loading={busy}>Salvar</Button>}</Group>
      </Stack>
    </Modal>
  )
}

// Saldo do produto em cada filial liberada para o usuário.
function BranchStock({ productId, unit }: { productId: string; unit: string }) {
  const { data } = useApi<{ companyId: string; label: string; quantity: number; avgCost: number }[]>(`/stock/branches?productId=${productId}`)
  if (!data) return null
  return (
    <Card withBorder p="xs">
      <Text size="sm" fw={600} mb={4}>Saldo por filial</Text>
      <Table>
        <Table.Tbody>
          {data.map((b) => (
            <Table.Tr key={b.companyId}><Table.Td>{b.label}</Table.Td><Table.Td ta="right">{b.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {unit}</Table.Td><Table.Td ta="right" c="dimmed">custo {money(b.avgCost)}</Table.Td></Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  )
}
