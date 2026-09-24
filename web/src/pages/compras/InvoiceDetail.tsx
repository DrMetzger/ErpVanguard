import { Alert, Anchor, Badge, Button, Card, Group, List, Modal, Select, SimpleGrid, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconArrowLeft, IconCircleCheck, IconSparkles, IconTrash } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loading, PageHeader, ProductSelect, Status } from '../../components/ui'
import { api } from '../../lib/api'
import { cnpj, date, money, price, qty } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'
import type { Invoice, InvoiceItem, Product } from '../../lib/types'

const SOURCE: Record<string, [string, string, string]> = {
  amarracao: ['Já conhecido', 'teal', 'Código do fornecedor usado em nota anterior'],
  ean: ['Código de barras', 'teal', 'EAN da nota igual ao do produto'],
  pedido: ['Pelo pedido', 'brand', 'Descrição parecida com o item do pedido'],
  ia: ['IA', 'violet', 'Sugerido pelo Gemini'],
  manual: ['Manual', 'gray', 'Escolhido por você'],
}

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: nf, error, setData } = useApi<Invoice>(`/invoices/${id}`)
  const [creating, setCreating] = useState<InvoiceItem | null>(null)
  const { busy, run } = useAction()

  if (error) return <Text c="red">{error}</Text>
  if (!nf) return <Loading />

  const pending = nf.status === 'pendente'
  const unmatched = nf.items.filter((i) => !i.productId).length
  const update = (body: { purchaseOrderId?: string | null; items?: { id: string; productId?: string | null; orderItemId?: string | null }[] }) =>
    run(async () => setData(await api<Invoice>(`/invoices/${id}`, { method: 'PUT', body: { items: [], ...body } })))
  const ai = () => run(async () => setData(await api<Invoice>(`/invoices/${id}/ai-match`, { method: 'POST' })), 'Sugestões da IA aplicadas')
  const post = () => confirm('Lançar a nota? O estoque e o custo médio dos produtos serão atualizados.') && run(async () => setData(await api<Invoice>(`/invoices/${id}/post`, { method: 'POST' })), 'Nota lançada')
  const remove = () => confirm('Excluir esta nota importada?') && run(async () => { await api(`/invoices/${id}`, { method: 'DELETE' }); navigate('/compras/notas') }, 'Nota excluída')

  return (
    <>
      <PageHeader
        back={<Anchor component={Link} to="/compras/notas" size="sm" c="dimmed"><Group gap={4}><IconArrowLeft size={14} /> Notas</Group></Anchor>}
        title={<Group gap="sm">NF {nf.number}{nf.series && `/${nf.series}`} <Status value={nf.status} /></Group>}
        description={<Text span ff="monospace" size="xs">{nf.accessKey}</Text>}
        actions={pending && <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={remove} loading={busy}>Excluir</Button>}
      />

      <Card mb="md">
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          <div><Text size="xs" c="dimmed" tt="uppercase" fw={700}>Fornecedor</Text><Text fw={600}>{nf.supplierName}</Text><Text size="xs" c="dimmed" ff="monospace">{cnpj(nf.supplierCnpj)}</Text></div>
          <div><Text size="xs" c="dimmed" tt="uppercase" fw={700}>Emissão</Text><Text>{date(nf.issueDate)}</Text></div>
          <div><Text size="xs" c="dimmed" tt="uppercase" fw={700}>Total da nota</Text><Text fw={800} fz="xl">{money(nf.total)}</Text></div>
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Pedido de compra</Text>
            {pending ? (
              <Select placeholder="Sem pedido" clearable value={nf.purchaseOrderId} onChange={(v) => update({ purchaseOrderId: v })} data={nf.orders.map((o) => ({ value: o.id, label: `${o.code} · ${money(o.total)}` }))} aria-label="Pedido de compra" />
            ) : <Text>{nf.orderCode ?? '—'}</Text>}
          </div>
        </SimpleGrid>
      </Card>

      {nf.warnings.length > 0 && pending && (
        <Alert color="yellow" icon={<IconAlertTriangle />} title="Confira antes de lançar" mb="md">
          <List size="sm">{nf.warnings.map((w) => <List.Item key={w}>{w}</List.Item>)}</List>
        </Alert>
      )}

      <Card p={0} mb="md">
        <Table.ScrollContainer minWidth={nf.purchaseOrderId ? 1100 : 860}>
          <Table className="invoice-table" verticalSpacing="md">
            <Table.Thead><Table.Tr><Table.Th w={40}>#</Table.Th><Table.Th>Item na nota</Table.Th><Table.Th ta="right">Qtd.</Table.Th><Table.Th ta="right">Unit.</Table.Th><Table.Th miw={300}>Produto no sistema</Table.Th>{nf.purchaseOrderId && <Table.Th miw={240}>Item do pedido</Table.Th>}</Table.Tr></Table.Thead>
            <Table.Tbody>
              {nf.items.map((i) => {
                const src = i.matchSource ? SOURCE[i.matchSource] : null
                return (
                  <Table.Tr key={i.id} bg={i.productId ? undefined : 'var(--mantine-color-yellow-light)'}>
                    <Table.Td>{i.itemNumber}</Table.Td>
                    <Table.Td><Text size="sm" fw={600}>{i.description}</Text><Text size="xs" c="dimmed">cód. {i.supplierCode}{i.ean && ` · EAN ${i.ean}`}{i.ncm && ` · NCM ${i.ncm}`}</Text></Table.Td>
                    <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>{qty(i.quantity)} {i.unit}</Table.Td>
                    <Table.Td ta="right">{price(i.unitPrice)}</Table.Td>
                    <Table.Td>
                      {pending ? (
                        <Stack gap={4}>
                          <ProductSelect value={i.productId ? { id: i.productId, sku: i.productSku, name: i.productName } : null} onChange={(p) => update({ items: [{ id: i.id, productId: p?.id ?? null }] })} placeholder="Escolher produto…" aria-label={`Produto do item ${i.itemNumber}`} />
                          {!i.productId && <Anchor component="button" type="button" size="xs" onClick={() => setCreating(i)}>+ cadastrar produto a partir da nota</Anchor>}
                        </Stack>
                      ) : <Text size="sm">{i.productSku} · {i.productName}</Text>}
                      {src && (
                        <Group gap={6} mt={4} wrap="nowrap">
                          <Tooltip label={src[2]}><Badge size="sm" variant="light" color={src[1]} leftSection={i.matchSource === 'ia' ? <IconSparkles size={11} /> : undefined} style={{ textTransform: 'none' }}>{src[0]}</Badge></Tooltip>
                          {i.matchNote && <Text size="xs" c="dimmed" lineClamp={1}>{i.matchNote}</Text>}
                        </Group>
                      )}
                    </Table.Td>
                    {nf.purchaseOrderId && (
                      <Table.Td>
                        {pending ? (
                          <Select placeholder="—" clearable value={i.orderItemId} onChange={(v) => update({ items: [{ id: i.id, orderItemId: v }] })}
                            data={nf.orderItems.map((oi) => ({ value: oi.id, label: `${oi.description} (saldo ${qty(oi.quantity - oi.receivedQuantity)})` }))} aria-label={`Item do pedido ${i.itemNumber}`} />
                        ) : <Text size="sm">{nf.orderItems.find((oi) => oi.id === i.orderItemId)?.description ?? '—'}</Text>}
                      </Table.Td>
                    )}
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      {pending ? (
        <Group>
          {unmatched > 0 && (nf.aiEnabled
            ? <Button variant="gradient" gradient={{ from: 'violet', to: 'cyan', deg: 90 }} leftSection={<IconSparkles size={18} />} onClick={ai} loading={busy}>Amarrar {unmatched} item(ns) com IA</Button>
            : <Text size="sm" c="dimmed">IA desativada: configure a chave do Gemini para sugestões automáticas.</Text>)}
          <Button ml="auto" size="md" onClick={post} loading={busy} disabled={unmatched > 0}>{unmatched ? `Faltam ${unmatched} produto(s)` : 'Lançar nota (entrada no estoque)'}</Button>
        </Group>
      ) : (
        <Alert color="teal" icon={<IconCircleCheck />}>Nota lançada em {date(nf.postedAt)}. Estoque e custo médio atualizados.</Alert>
      )}

      {creating && <NewProductFromItem item={creating} onClose={() => setCreating(null)} onCreated={(p) => { setCreating(null); update({ items: [{ id: creating.id, productId: p.id }] }) }} />}
    </>
  )
}

function NewProductFromItem({ item, onClose, onCreated }: { item: InvoiceItem; onClose: () => void; onCreated: (p: Product) => void }) {
  const [form, setForm] = useState({ sku: item.supplierCode.slice(0, 40), name: item.description.slice(0, 200), unit: item.unit.slice(0, 6), ncm: item.ncm ?? '', barcode: item.ean ?? '' })
  const { busy, run } = useAction()
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.currentTarget.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body: Record<string, string> = { sku: form.sku, name: form.name, unit: form.unit }
    if (/^\d{8}$/.test(form.ncm)) body.ncm = form.ncm
    if (form.barcode) body.barcode = form.barcode
    run(async () => onCreated(await api<Product>('/products', { method: 'POST', body })), 'Produto cadastrado')
  }
  return (
    <Modal opened onClose={onClose} title="Cadastrar produto a partir da nota" size="lg">
      <Stack component="form" onSubmit={submit}>
        <Text size="sm" c="dimmed">Dados trazidos da nota. O estoque e o custo entram quando a nota for lançada.</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Código (SKU)" required data-autofocus value={form.sku} onChange={set('sku')} />
          <TextInput label="Unidade" required maxLength={6} value={form.unit} onChange={set('unit')} />
          <TextInput label="Descrição" required value={form.name} onChange={set('name')} style={{ gridColumn: '1 / -1' }} />
          <TextInput label="NCM" maxLength={8} value={form.ncm} onChange={set('ncm')} />
          <TextInput label="Código de barras" value={form.barcode} onChange={set('barcode')} />
        </SimpleGrid>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Cadastrar e usar</Button></Group>
      </Stack>
    </Modal>
  )
}
