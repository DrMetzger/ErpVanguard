import { ActionIcon, Alert, Anchor, Badge, Button, Card, Divider, Group, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconArrowLeft, IconCheck, IconFileInvoice, IconPlus, IconTrash, IconX } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BrNumber, Money } from '../../components/inputs'
import { Loading, PageHeader, ProductSelect, Status } from '../../components/ui'
import { api } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { useOptions } from '../../lib/catalog'
import { can, cnpj, date, money, price, qty } from '../../lib/format'
import { useAction } from '../../lib/hooks'
import type { Product } from '../../lib/types'
import type { SalesInvoice, SalesOrder, SalesOrderItem } from './types'

interface Line { key: number; productId: string; sku: string; name: string; unit: string; stock: number; quantity: number; unitPrice: number; discountPct: number; cfop?: string | null }
let seq = 0
const lineTotal = (l: Line) => Math.round(l.quantity * l.unitPrice * (1 - l.discountPct / 100) * 100) / 100
const fromItem = (i: SalesOrderItem): Line => ({ key: ++seq, productId: i.productId, sku: i.sku, name: i.name, unit: i.unit, stock: i.stock, quantity: i.quantity, unitPrice: i.unitPrice, discountPct: i.discountPct, cfop: i.cfop })

export default function SalesOrderForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useUser()
  const customers = useOptions('customers')
  const terms = useOptions('payment-terms')
  const tables = useOptions('price-tables')
  const companies = useOptions('companies')
  const operations = useOptions('operation-types')
  const [order, setOrder] = useState<SalesOrder | null>(null)
  const [loaded, setLoaded] = useState(!id)
  const [form, setForm] = useState({ customerId: null as string | null, paymentTermId: null as string | null, priceTableId: null as string | null, companyId: null as string | null, operationTypeId: null as string | null, validUntil: '', freight: 0, discount: 0, notes: '' })
  const [lines, setLines] = useState<Line[]>([])
  const [adding, setAdding] = useState<Product | null>(null)
  const { busy, run } = useAction()

  const apply = (o: SalesOrder) => {
    setOrder(o)
    setForm({ customerId: o.customerId, paymentTermId: o.paymentTermId, priceTableId: o.priceTableId, companyId: o.companyId, operationTypeId: o.operationTypeId, validUntil: o.validUntil ?? '', freight: o.freight, discount: o.discount, notes: o.notes ?? '' })
    setLines(o.items.map(fromItem))
  }
  useEffect(() => {
    if (!id) return
    api<SalesOrder>(`/sales-orders/${id}`).then(apply).finally(() => setLoaded(true))
  }, [id])
  // Condição padrão para orçamento novo: à vista, se existir
  useEffect(() => {
    if (!id && !form.paymentTermId && terms.length) setForm((f) => ({ ...f, paymentTermId: terms.find((t) => /à vista/i.test(t.label))?.value ?? terms[0]!.value }))
  }, [terms, id, form.paymentTermId])

  if (!loaded) return <Loading />
  const locked = !!order && (order.status === 'faturado' || order.status === 'cancelado')
  const itemsTotal = lines.reduce((s, l) => s + lineTotal(l), 0)
  const total = itemsTotal + (form.freight || 0) - (form.discount || 0)
  const dirty = !order || JSON.stringify(lines.map(({ key: _k, cfop: _c, ...l }) => l)) !== JSON.stringify(order.items.map((i) => { const { key: _k, cfop: _c, ...l } = fromItem(i); return l }))
    || form.customerId !== order.customerId || form.paymentTermId !== order.paymentTermId || form.priceTableId !== order.priceTableId
    || form.companyId !== order.companyId || form.operationTypeId !== order.operationTypeId || (form.validUntil || null) !== order.validUntil
    || form.freight !== order.freight || form.discount !== order.discount || (form.notes || null) !== order.notes

  const addProduct = async (p: Product | null) => {
    if (!p) return
    setAdding(null)
    const info = await api<{ price: number; stock: number; unit: string }>(`/sales/price?productId=${p.id}${form.priceTableId ? `&priceTableId=${form.priceTableId}` : ''}`)
    setLines((ls) => [...ls, { key: ++seq, productId: p.id, sku: p.sku, name: p.name, unit: info.unit, stock: info.stock, quantity: 1, unitPrice: info.price, discountPct: 0 }])
  }
  const change = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const body = () => ({
    customerId: form.customerId, paymentTermId: form.paymentTermId, priceTableId: form.priceTableId || undefined, companyId: form.companyId || undefined,
    operationTypeId: form.operationTypeId || undefined, validUntil: form.validUntil || undefined, freight: form.freight || 0, discount: form.discount || 0,
    notes: form.notes || undefined, items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct })),
  })
  const save = () => run(async () => {
    const saved = await api<SalesOrder>(order ? `/sales-orders/${order.id}` : '/sales-orders', { method: order ? 'PUT' : 'POST', body: body() })
    apply(saved)
    if (!order) navigate(`/faturamento/pedidos/${saved.id}`, { replace: true })
    return saved
  }, 'Orçamento salvo')
  const action = (path: 'approve' | 'cancel', msg: string) => run(async () => apply(await api<SalesOrder>(`/sales-orders/${order!.id}/${path}`, { method: 'POST' })), msg)
  const invoice = () => confirm(`Faturar ${order!.code} no valor de ${money(order!.total)}? O estoque baixa e as contas a receber são geradas.`) && run(async () => {
    const nf = await api<SalesInvoice>(`/sales-orders/${order!.id}/invoice`, { method: 'POST' })
    navigate(`/faturamento/notas/${nf.id}`)
  }, 'Pedido faturado')

  const canInvoice = can(user, 'faturamento')
  return (
    <>
      <PageHeader
        back={<Anchor component={Link} to="/faturamento/pedidos" size="sm" c="dimmed"><Group gap={4}><IconArrowLeft size={14} /> Orçamentos e pedidos</Group></Anchor>}
        title={order ? <Group gap="sm">{order.code} <Status value={order.status} /></Group> : 'Novo orçamento'}
        description={order ? `Criado em ${date(order.createdAt)} por ${order.sellerName} · ${order.companyLabel}` : 'Escolha o cliente, a condição de pagamento e os produtos.'}
        actions={order && <>
          {order.invoice && <Button component={Link} to={`/faturamento/notas/${order.invoice.id}`} variant="light" leftSection={<IconFileInvoice size={16} />}>{order.invoice.label}</Button>}
          {order.status === 'orcamento' && !dirty && <Button leftSection={<IconCheck size={16} />} onClick={() => action('approve', 'Orçamento aprovado: virou pedido')} loading={busy}>Aprovar pedido</Button>}
          {order.status === 'aprovado' && !dirty && canInvoice && <Button leftSection={<IconFileInvoice size={16} />} onClick={invoice} loading={busy}>Faturar</Button>}
          {!locked && <Button variant="subtle" color="red" leftSection={<IconX size={16} />} onClick={() => confirm('Cancelar este pedido?') && action('cancel', 'Pedido cancelado')} loading={busy}>Cancelar</Button>}
        </>}
      />

      {order && order.warnings.length > 0 && !locked && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} mb="md" title="Atenção">
          <Stack gap={2}>{order.warnings.map((w) => <Text key={w} size="sm">{w}</Text>)}</Stack>
        </Alert>
      )}

      <Card mb="md">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <Select label="Cliente" data={customers} value={form.customerId} onChange={(v) => setForm({ ...form, customerId: v })} searchable required disabled={locked} nothingFoundMessage="Cadastre em Cadastros › Clientes" />
          <Select label="Condição de pagamento" data={terms} value={form.paymentTermId} onChange={(v) => setForm({ ...form, paymentTermId: v })} required disabled={locked} allowDeselect={false} />
          <Select label="Tabela de preço" placeholder="Preço de venda do produto" data={tables} value={form.priceTableId} onChange={(v) => setForm({ ...form, priceTableId: v })} clearable disabled={locked} />
          <TextInput type="date" label="Validade do orçamento" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.currentTarget.value })} disabled={locked} />
          <Select label="Empresa/filial" placeholder="Matriz" data={companies} value={form.companyId} onChange={(v) => setForm({ ...form, companyId: v })} clearable disabled={locked} />
          <Select label="Tipo de operação" placeholder="S01 · Venda de mercadoria" data={operations.filter((o) => o.label.startsWith('S'))} value={form.operationTypeId} onChange={(v) => setForm({ ...form, operationTypeId: v })} clearable disabled={locked} />
          {order && <div><Text size="sm" fw={500}>Cliente</Text><Text size="sm" c="dimmed" ff="monospace">{cnpj(order.customerDocument)}{order.customerUf && ` · ${order.customerUf}`}</Text></div>}
        </SimpleGrid>
      </Card>

      <Card p={0} mb="md">
        <Table.ScrollContainer minWidth={900}>
          <Table>
            <Table.Thead>
              <Table.Tr><Table.Th>Produto</Table.Th><Table.Th w={110}>Qtd.</Table.Th><Table.Th w={150}>Preço unit.</Table.Th><Table.Th w={100}>Desc. %</Table.Th><Table.Th ta="right" w={130}>Total</Table.Th><Table.Th w={80}>CFOP</Table.Th><Table.Th w={48} /></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((l) => (
                <Table.Tr key={l.key}>
                  <Table.Td>
                    <Text size="sm" fw={600}>{l.sku} <Text span fw={400}>· {l.name}</Text></Text>
                    <Text size="xs" c={l.stock < l.quantity ? 'orange' : 'dimmed'}>Estoque: {qty(l.stock)} {l.unit}</Text>
                  </Table.Td>
                  <Table.Td>{locked ? qty(l.quantity) : <BrNumber value={l.quantity} onChange={(v) => change(l.key, { quantity: Number(v) || 0 })} decimalScale={4} aria-label={`Quantidade ${l.sku}`} size="xs" />}</Table.Td>
                  <Table.Td>{locked ? price(l.unitPrice) : <Money value={l.unitPrice} onChange={(v) => change(l.key, { unitPrice: Number(v) || 0 })} aria-label={`Preço ${l.sku}`} size="xs" />}</Table.Td>
                  <Table.Td>{locked ? `${qty(l.discountPct)}%` : <BrNumber value={l.discountPct} onChange={(v) => change(l.key, { discountPct: Math.min(100, Number(v) || 0) })} decimalScale={2} suffix="%" aria-label={`Desconto ${l.sku}`} size="xs" />}</Table.Td>
                  <Table.Td ta="right" fw={600}>{money(lineTotal(l))}</Table.Td>
                  <Table.Td>{l.cfop ? <Badge variant="light" radius="sm">{l.cfop}</Badge> : <Text size="xs" c="dimmed">{order && !dirty ? 'sem regra' : 'ao salvar'}</Text>}</Table.Td>
                  <Table.Td>{!locked && <Tooltip label="Remover"><ActionIcon variant="subtle" color="red" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label={`Remover ${l.sku}`}><IconTrash size={16} /></ActionIcon></Tooltip>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!locked && (
          <Group p="md" gap="sm">
            <ProductSelect value={adding} onChange={addProduct} placeholder="Adicionar produto (código ou nome)…" w={420} leftSection={<IconPlus size={16} />} aria-label="Adicionar produto" />
            {lines.length === 0 && <Text size="sm" c="dimmed">Nenhum item ainda.</Text>}
          </Group>
        )}
      </Card>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card>
          <Textarea label="Observações (saem no pedido e na nota)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })} autosize minRows={3} disabled={locked} />
        </Card>
        <Card>
          <Stack gap={6}>
            <Group justify="space-between"><Text c="dimmed">Itens</Text><Text>{money(itemsTotal)}</Text></Group>
            <Group justify="space-between"><Text c="dimmed">Frete</Text>{locked ? <Text>{money(form.freight)}</Text> : <Money value={form.freight} onChange={(v) => setForm({ ...form, freight: Number(v) || 0 })} decimalScale={2} w={150} size="xs" aria-label="Frete" />}</Group>
            <Group justify="space-between"><Text c="dimmed">Desconto no pedido</Text>{locked ? <Text>{money(form.discount)}</Text> : <Money value={form.discount} onChange={(v) => setForm({ ...form, discount: Number(v) || 0 })} decimalScale={2} w={150} size="xs" aria-label="Desconto no pedido" />}</Group>
            <Divider my={4} />
            <Group justify="space-between"><Text fw={700}>Total</Text><Text fw={800} fz={24}>{money(total)}</Text></Group>
            {!locked && (
              <Group justify="flex-end" mt="sm">
                <Button onClick={save} loading={busy} disabled={!dirty || !form.customerId || !form.paymentTermId || !lines.length}>{order ? 'Salvar alterações' : 'Salvar orçamento'}</Button>
              </Group>
            )}
            {order?.status === 'aprovado' && dirty && <Text size="xs" c="orange" ta="right">Salvar volta o pedido para orçamento (precisa aprovar de novo).</Text>}
          </Stack>
        </Card>
      </SimpleGrid>
    </>
  )
}
