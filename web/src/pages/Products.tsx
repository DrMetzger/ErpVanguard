import { ActionIcon, Badge, Button, Card, Group, Modal, SimpleGrid, Stack, Switch, Table, TextInput, Tooltip } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconEdit, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { BrNumber, Money } from '../components/inputs'
import { Empty, ErrorText, Loading, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { money, qty, toNumber } from '../lib/format'
import { useAction, useApi } from '../lib/hooks'
import type { Product } from '../lib/types'

export default function Products() {
  const [query, setQuery] = useState('')
  const [q] = useDebouncedValue(query.trim(), 250)
  const { data, error, loading, reload } = useApi<Product[]>(`/products${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  const [editing, setEditing] = useState<Partial<Product> | null>(null)
  const { run } = useAction()

  const remove = (p: Product) => {
    if (confirm(`Excluir o produto "${p.name}"?`)) run(() => api(`/products/${p.id}`, { method: 'DELETE' }).then(reload), 'Produto excluído')
  }

  return (
    <>
      <PageHeader title="Estoque" description="Cadastro de produtos e saldos." actions={<Button leftSection={<IconPlus size={18} />} onClick={() => setEditing({})}>Novo produto</Button>} />
      <TextInput placeholder="Buscar por nome ou código" leftSection={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} maw={420} mb="md" />
      <ErrorText error={error} />
      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={760}>
            <Table>
              <Table.Thead>
                <Table.Tr><Table.Th>Código</Table.Th><Table.Th>Produto</Table.Th><Table.Th>Un.</Table.Th><Table.Th ta="right">Custo</Table.Th><Table.Th ta="right">Venda</Table.Th><Table.Th ta="right">Estoque</Table.Th><Table.Th w={90} /></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.map((p) => (
                  <Table.Tr key={p.id} opacity={p.active ? 1 : 0.5}>
                    <Table.Td fw={600}>{p.sku}</Table.Td>
                    <Table.Td>{p.name}</Table.Td>
                    <Table.Td>{p.unit}</Table.Td>
                    <Table.Td ta="right">{money(p.costPrice)}</Table.Td>
                    <Table.Td ta="right">{money(p.salePrice)}</Table.Td>
                    <Table.Td ta="right">{p.stock <= p.minStock ? <Badge color="yellow" variant="light">{qty(p.stock)}</Badge> : qty(p.stock)}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Editar"><ActionIcon variant="subtle" onClick={() => setEditing(p)} aria-label="Editar"><IconEdit size={17} /></ActionIcon></Tooltip>
                        <Tooltip label="Excluir"><ActionIcon variant="subtle" color="red" onClick={() => remove(p)} aria-label="Excluir"><IconTrash size={17} /></ActionIcon></Tooltip>
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
      {editing && <ProductForm product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function ProductForm({ product, onClose, onSaved }: { product: Partial<Product>; onClose: () => void; onSaved: () => void }) {
  const isNew = !product.id
  const [form, setForm] = useState({
    sku: product.sku ?? '', name: product.name ?? '', barcode: product.barcode ?? '', ncm: product.ncm ?? '', unit: product.unit ?? 'UN',
    costPrice: product.costPrice ?? ('' as number | string), salePrice: product.salePrice ?? ('' as number | string),
    stock: product.stock ?? ('' as number | string), minStock: product.minStock ?? ('' as number | string), active: product.active ?? true,
  })
  const { busy, run } = useAction()
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = (v: string) => (v.trim() ? v.trim() : isNew ? undefined : null)
    const body = {
      sku: form.sku.trim(), name: form.name.trim(), unit: form.unit.trim(), barcode: text(form.barcode), ncm: text(form.ncm),
      costPrice: toNumber(form.costPrice) ?? 0, salePrice: toNumber(form.salePrice) ?? 0, stock: toNumber(form.stock) ?? 0, minStock: toNumber(form.minStock) ?? 0,
      ...(isNew ? {} : { active: form.active }),
    }
    run(() => api(isNew ? '/products' : `/products/${product.id}`, { method: isNew ? 'POST' : 'PATCH', body }).then(onSaved), 'Produto salvo')
  }

  return (
    <Modal opened onClose={onClose} title={isNew ? 'Novo produto' : 'Editar produto'} size="lg">
      <Stack component="form" onSubmit={submit}>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label="Código (SKU)" required data-autofocus value={form.sku} onChange={(e) => set('sku', e.currentTarget.value)} />
          <TextInput label="Descrição" required value={form.name} onChange={(e) => set('name', e.currentTarget.value)} style={{ gridColumn: 'span 2' }} />
          <TextInput label="Código de barras" inputMode="numeric" value={form.barcode} onChange={(e) => set('barcode', e.currentTarget.value)} />
          <TextInput label="NCM" placeholder="8 dígitos" maxLength={8} inputMode="numeric" value={form.ncm} onChange={(e) => set('ncm', e.currentTarget.value)} />
          <TextInput label="Unidade" required maxLength={6} value={form.unit} onChange={(e) => set('unit', e.currentTarget.value)} />
          <Money label="Preço de custo" value={form.costPrice} onChange={(v) => set('costPrice', v)} />
          <Money label="Preço de venda" value={form.salePrice} onChange={(v) => set('salePrice', v)} />
          <div />
          <BrNumber label="Estoque atual" decimalScale={4} allowNegative value={form.stock} onChange={(v) => set('stock', v)} />
          <BrNumber label="Estoque mínimo" decimalScale={4} value={form.minStock} onChange={(v) => set('minStock', v)} />
        </SimpleGrid>
        {!isNew && <Switch label="Produto ativo" checked={form.active} onChange={(e) => set('active', e.currentTarget.checked)} />}
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Salvar</Button></Group>
      </Stack>
    </Modal>
  )
}
