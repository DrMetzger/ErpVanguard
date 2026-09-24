import { ActionIcon, Button, Group, Modal, Stack, Table, Text, Tooltip } from '@mantine/core'
import { IconCurrencyReal, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { CatalogPage } from '../../components/CatalogPage'
import { Money } from '../../components/inputs'
import { Empty, Loading, ProductSelect } from '../../components/ui'
import { api } from '../../lib/api'
import { money, toNumber } from '../../lib/format'
import { useAction } from '../../lib/hooks'
import type { CatalogRow, Product } from '../../lib/types'

interface Item { productId: string; sku: string; name: string; unit: string; costPrice: number; price: number | string }

export default function PriceTables() {
  const [open, setOpen] = useState<CatalogRow | null>(null)
  return (
    <>
      <CatalogPage name="price-tables" rowActions={(row) => (
        <Tooltip label="Preços dos produtos"><ActionIcon variant="light" onClick={() => setOpen(row)} aria-label="Preços"><IconCurrencyReal size={17} /></ActionIcon></Tooltip>
      )} />
      {open && <PriceItems table={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function PriceItems({ table, onClose }: { table: CatalogRow; onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [adding, setAdding] = useState<Product | null>(null)
  const { busy, run } = useAction()

  useEffect(() => {
    api<Item[]>(`/catalog/price-tables/${table.id}/items`).then(setItems).catch(() => setItems([]))
  }, [table.id])

  const add = (p: Product | null) => {
    if (!p || !items) return
    if (!items.some((i) => i.productId === p.id)) setItems([...items, { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, costPrice: p.costPrice, price: p.salePrice || '' }])
    setAdding(null)
  }
  const save = () => run(async () => {
    const body = { items: items!.map((i) => ({ productId: i.productId, price: toNumber(i.price) ?? 0 })) }
    setItems(await api<Item[]>(`/catalog/price-tables/${table.id}/items`, { method: 'PUT', body }))
  }, 'Preços salvos')

  return (
    <Modal opened onClose={onClose} title={`Preços · ${table.code} ${table.name}`} size="xl">
      {!items ? <Loading /> : (
        <Stack>
          <ProductSelect value={adding} onChange={add} placeholder="Adicionar produto à tabela…" aria-label="Adicionar produto" />
          <Table.ScrollContainer minWidth={560}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Produto</Table.Th><Table.Th ta="right">Custo</Table.Th><Table.Th w={180}>Preço</Table.Th><Table.Th ta="right">Margem</Table.Th><Table.Th w={50} /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {items.map((i, idx) => {
                  const p = toNumber(i.price)
                  const margin = p && i.costPrice ? ((p - i.costPrice) / p) * 100 : null
                  return (
                    <Table.Tr key={i.productId}>
                      <Table.Td><Text size="sm" fw={600}>{i.sku}</Text><Text size="xs" c="dimmed">{i.name}</Text></Table.Td>
                      <Table.Td ta="right">{money(i.costPrice)}</Table.Td>
                      <Table.Td><Money size="sm" value={i.price} onChange={(v) => setItems(items.map((x, j) => (j === idx ? { ...x, price: v } : x)))} aria-label={`Preço ${i.sku}`} /></Table.Td>
                      <Table.Td ta="right" c={margin !== null && margin < 0 ? 'red' : undefined}>{margin === null ? '—' : `${margin.toFixed(1)}%`}</Table.Td>
                      <Table.Td><ActionIcon variant="subtle" color="red" onClick={() => setItems(items.filter((_, j) => j !== idx))} aria-label="Remover"><IconTrash size={16} /></ActionIcon></Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {!items.length && <Empty>Adicione produtos pela busca acima.</Empty>}
          <Group justify="flex-end"><Button variant="default" onClick={onClose}>Fechar</Button><Button leftSection={<IconPlus size={16} />} onClick={save} loading={busy}>Salvar preços</Button></Group>
        </Stack>
      )}
    </Modal>
  )
}
