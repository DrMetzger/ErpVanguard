import { ActionIcon, Alert, Anchor, Badge, Button, Card, Group, Loader, Modal, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconAlertTriangle, IconArrowBackUp, IconArrowLeft, IconFileInvoice, IconMail, IconPlus, IconThumbDown, IconTrash, IconTrophy, IconX } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BrNumber, Money } from '../../components/inputs'
import { Loading, PageHeader, ProductSelect, Status } from '../../components/ui'
import { api } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { branchLabel } from '../../lib/types'
import { useOptions } from '../../lib/catalog'
import { useCostCenters } from '../../lib/costCenters'
import { can, cnpj, date, money, price, qty } from '../../lib/format'
import { useAction } from '../../lib/hooks'
import type { Product } from '../../lib/types'
import { KIND, type DocKind } from './SalesDocs'
import { EmailHistory, SendEmailModal } from './SendEmail'
import { ItemTaxBadge, REGIMES, TaxTotalsBlock } from './TaxSummary'
import type { ItemTaxes, Readiness, SalesDoc, SalesInvoice, SalesOrderItem, TaxTotals } from './types'

interface Line { key: number; productId: string; sku: string; name: string; unit: string; stock: number; quantity: number; unitPrice: number; discountPct: number; cfop?: string | null; taxes?: ItemTaxes | null }
interface Preview { totals: TaxTotals; warnings: string[]; regime?: string; items: { cfop: string | null; taxes: ItemTaxes; unitPrice: number }[] }
let seq = 0
const lineTotal = (l: Line) => Math.round(l.quantity * l.unitPrice * (1 - l.discountPct / 100) * 100) / 100
const fromItem = (i: SalesOrderItem): Line => ({ key: ++seq, productId: i.productId, sku: i.sku, name: i.name, unit: i.unit, stock: i.stock, quantity: i.quantity, unitPrice: i.unitPrice, discountPct: i.discountPct, cfop: i.cfop, taxes: i.taxes })

// Orçamento ou pedido de venda: itens, preços, CFOP e impostos calculados na hora.
export default function SalesDocForm({ kind }: { kind: DocKind }) {
  const k = KIND[kind]
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useUser()
  const customers = useOptions('customers')
  const terms = useOptions('payment-terms')
  const tables = useOptions('price-tables')
  // Só as filiais liberadas para o usuário; o documento novo começa na filial atual (topo da tela).
  const allCompanies = useOptions('companies')
  const companies = user.branches?.length ? user.branches.map((b) => ({ value: b.id, label: branchLabel(b) })) : allCompanies
  const operations = useOptions('operation-types')
  const costCenters = useCostCenters()
  const [costCenterId, setCostCenterId] = useState<string | null>(null)
  const [doc, setDoc] = useState<SalesDoc | null>(null)
  const [loaded, setLoaded] = useState(!id)
  const [form, setForm] = useState({ customerId: null as string | null, paymentTermId: null as string | null, priceTableId: null as string | null, companyId: (user.branchId ?? null) as string | null, operationTypeId: null as string | null, validUntil: '', freight: 0, discount: 0, notes: '' })
  const [lines, setLines] = useState<Line[]>([])
  const [adding, setAdding] = useState<Product | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [losing, setLosing] = useState(false)
  const [reason, setReason] = useState('')
  const [mailing, setMailing] = useState(false)
  const { busy, run } = useAction()
  const [readiness, setReadiness] = useState<Readiness | null>(null)

  const apply = (o: SalesDoc) => {
    setDoc(o)
    setForm({ customerId: o.customerId, paymentTermId: o.paymentTermId, priceTableId: o.priceTableId, companyId: o.companyId, operationTypeId: o.operationTypeId, validUntil: o.validUntil ?? '', freight: o.freight, discount: o.discount, notes: o.notes ?? '' })
    setLines(o.items.map(fromItem))
    setCostCenterId((o as SalesDoc & { costCenterId?: string | null }).costCenterId ?? null)
    setPreview(o.taxes ? { totals: o.taxes, warnings: [], items: o.items.map((i) => ({ cfop: i.cfop ?? null, taxes: i.taxes!, unitPrice: i.unitPrice })) } : null)
  }
  useEffect(() => {
    if (!id) return
    setLoaded(false)
    api<SalesDoc>(`${k.api}/${id}`).then(apply).finally(() => setLoaded(true))
  }, [id, k.api])
  useEffect(() => {
    if (!id && !form.paymentTermId && terms.length) setForm((f) => ({ ...f, paymentTermId: terms.find((t) => /à vista/i.test(t.label))?.value ?? terms[0]!.value }))
  }, [terms, id, form.paymentTermId])

  const locked = !!doc && doc.status !== 'aberto'

  // Confere os pré-requisitos (empresa, série) ao abrir o formulário, e não só ao salvar.
  useEffect(() => {
    if (locked || !loaded) return
    let alive = true
    api<Readiness>(`/sales/readiness${form.companyId ? `?companyId=${form.companyId}` : ''}`).then((r) => alive && setReadiness(r)).catch(() => undefined)
    return () => { alive = false }
  }, [form.companyId, locked, loaded])
  const body = () => ({
    costCenterId: costCenterId || undefined,
    customerId: form.customerId, paymentTermId: form.paymentTermId, priceTableId: form.priceTableId || undefined, companyId: form.companyId || undefined,
    operationTypeId: form.operationTypeId || undefined, validUntil: form.validUntil || undefined, freight: form.freight || 0, discount: form.discount || 0,
    notes: form.notes || undefined, items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct })),
  })

  // Recalcula impostos quando algo que muda o cálculo é alterado.
  const signature = JSON.stringify({ c: form.customerId, t: form.paymentTermId, co: form.companyId, op: form.operationTypeId, f: form.freight, d: form.discount, l: lines.map((l) => [l.productId, l.quantity, l.unitPrice, l.discountPct]) })
  const [debounced] = useDebouncedValue(signature, 400)
  useEffect(() => {
    if (locked || !form.customerId || !form.paymentTermId || !lines.length) return
    let alive = true
    setPreviewing(true)
    api<Preview>('/sales/preview', { method: 'POST', body: body() })
      .then((p) => { if (!alive) return; setPreview(p); setLines((ls) => ls.map((l, i) => ({ ...l, cfop: p.items[i]?.cfop ?? l.cfop, taxes: p.items[i]?.taxes ?? l.taxes }))) })
      .catch(() => undefined).finally(() => alive && setPreviewing(false))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, locked])

  if (!loaded) return <Loading />
  const itemsTotal = lines.reduce((s, l) => s + lineTotal(l), 0)
  const saved = doc && JSON.stringify({ c: doc.customerId, t: doc.paymentTermId, co: doc.companyId, op: doc.operationTypeId, f: doc.freight, d: doc.discount, l: doc.items.map((l) => [l.productId, l.quantity, l.unitPrice, l.discountPct]) })
  const dirty = !doc || saved !== signature || form.priceTableId !== doc.priceTableId || (form.validUntil || null) !== doc.validUntil || (form.notes || null) !== doc.notes || costCenterId !== ((doc as SalesDoc & { costCenterId?: string | null }).costCenterId ?? null)

  const addProduct = async (p: Product | null) => {
    if (!p) return
    setAdding(null)
    const info = await api<{ price: number; stock: number; unit: string }>(`/sales/price?productId=${p.id}${form.priceTableId ? `&priceTableId=${form.priceTableId}` : ''}`)
    setLines((ls) => [...ls, { key: ++seq, productId: p.id, sku: p.sku, name: p.name, unit: info.unit, stock: info.stock, quantity: 1, unitPrice: info.price, discountPct: 0 }])
  }
  const change = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const save = () => run(async () => {
    const r = await api<SalesDoc>(doc ? `${k.api}/${doc.id}` : k.api, { method: doc ? 'PUT' : 'POST', body: body() })
    apply(r)
    if (!doc) navigate(`${k.path}/${r.id}`, { replace: true })
  }, kind === 'quote' ? 'Orçamento salvo' : 'Pedido salvo')
  const post = (path: string, msg: string, payload?: unknown) => run(async () => apply(await api<SalesDoc>(`${k.api}/${doc!.id}/${path}`, { method: 'POST', body: payload })), msg)
  const win = () => confirm(`Marcar ${doc!.code} como ganho e gerar o pedido de venda?`) && run(async () => {
    const order = await api<SalesDoc>(`/sales-quotes/${doc!.id}/win`, { method: 'POST' })
    navigate(`/faturamento/pedidos/${order.id}`)
  }, 'Orçamento ganho: pedido gerado')
  const invoice = () => confirm(`Faturar ${doc!.code} no valor de ${money(doc!.total)}? O estoque baixa e as contas a receber são geradas.`) && run(async () => {
    const nf = await api<SalesInvoice>(`/sales-orders/${doc!.id}/invoice`, { method: 'POST' })
    navigate(`/faturamento/notas/${nf.id}`)
  }, 'Pedido faturado')
  const warnings = [...new Set([...(doc?.warnings ?? []), ...(preview?.warnings ?? [])])]
  const regimeKey = preview?.regime ?? doc?.taxRegime ?? readiness?.company?.regime ?? null
  const regime = regimeKey ? REGIMES[regimeKey] : undefined
  const blocked = !!readiness && !readiness.ready
  const isAdmin = user.role === 'admin'

  return (
    <>
      <PageHeader
        back={<Anchor component={Link} to={k.path} size="sm" c="dimmed"><Group gap={4}><IconArrowLeft size={14} /> {kind === 'quote' ? 'Orçamentos' : 'Pedidos de venda'}</Group></Anchor>}
        title={doc ? <Group gap="sm">{doc.code} <Status value={doc.status === 'aberto' ? (kind === 'quote' ? 'em_negociacao' : 'a_faturar') : doc.status} /></Group> : kind === 'quote' ? 'Novo orçamento' : 'Novo pedido de venda'}
        description={doc ? `Criado em ${date(doc.createdAt)} por ${doc.sellerName} · ${doc.companyLabel}${regime ? ` · ${regime}` : ''}` : 'Escolha o cliente, a condição de pagamento e os produtos. Os impostos são calculados na hora.'}
        actions={doc && <>
          {doc.quoteCode && doc.quoteId && <Button component={Link} to={`/faturamento/orcamentos/${doc.quoteId}`} variant="subtle">Orçamento {doc.quoteCode}</Button>}
          {doc.orderCode && doc.orderId && <Button component={Link} to={`/faturamento/pedidos/${doc.orderId}`} variant="light">Pedido {doc.orderCode}</Button>}
          {doc.invoice && <Button component={Link} to={`/faturamento/notas/${doc.invoice.id}`} variant="light" leftSection={<IconFileInvoice size={16} />}>{doc.invoice.label}</Button>}
          {doc.status !== 'cancelado' && (
            <Tooltip label="Salve as alterações antes de enviar" disabled={!dirty}>
              <Button variant="light" leftSection={<IconMail size={16} />} onClick={() => setMailing(true)} disabled={dirty}>Enviar por e-mail</Button>
            </Tooltip>
          )}
          {kind === 'quote' && doc.status === 'aberto' && !dirty && <Button leftSection={<IconTrophy size={16} />} onClick={win} loading={busy}>Ganho: gerar pedido</Button>}
          {kind === 'quote' && doc.status === 'aberto' && <Button variant="subtle" color="red" leftSection={<IconThumbDown size={16} />} onClick={() => setLosing(true)}>Perdido</Button>}
          {kind === 'quote' && doc.status === 'perdido' && <Button variant="light" leftSection={<IconArrowBackUp size={16} />} onClick={() => post('reopen', 'Orçamento reaberto')} loading={busy}>Reabrir</Button>}
          {kind === 'order' && doc.status === 'aberto' && !dirty && can(user, 'faturamento') && <Button leftSection={<IconFileInvoice size={16} />} onClick={invoice} loading={busy}>Faturar</Button>}
          {kind === 'order' && doc.status === 'aberto' && <Button variant="subtle" color="red" leftSection={<IconX size={16} />} onClick={() => confirm('Cancelar este pedido?') && post('cancel', 'Pedido cancelado')} loading={busy}>Cancelar</Button>}
        </>}
      />

      {readiness && !readiness.complete && !locked && (
        <Alert color={blocked ? 'red' : 'yellow'} icon={<IconAlertTriangle size={18} />} mb="md"
          title={blocked ? 'Antes de preencher: falta cadastrar' : `Pendências para emitir a nota${kind === 'quote' ? ' (o orçamento pode ser salvo)' : ' (o pedido pode ser salvo)'}`}>
          <Stack gap={4}>
            {readiness.issues.map((i) => (
              <Group key={i.key + i.message} gap="xs" wrap="wrap">
                <Text size="sm">{i.message}</Text>
                {isAdmin
                  ? <Anchor component={Link} to={i.link} size="sm" fw={600}>{i.link === '/empresas' ? 'Abrir Administração › Empresas' : i.link === '/parametros' ? 'Abrir Parâmetros' : 'Corrigir'}</Anchor>
                  : <Text size="xs" c="dimmed">(peça ao administrador)</Text>}
              </Group>
            ))}
          </Stack>
        </Alert>
      )}
      {doc?.status === 'perdido' && <Alert color="red" variant="light" mb="md" title="Orçamento perdido">{doc.lostReason}</Alert>}
      {warnings.length > 0 && !locked && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} mb="md" title="Atenção">
          <Stack gap={2}>{warnings.map((w) => <Text key={w} size="sm">{w}</Text>)}</Stack>
        </Alert>
      )}

      <Card mb="md">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <Select label="Cliente" data={customers} value={form.customerId} onChange={(v) => setForm({ ...form, customerId: v })} searchable required disabled={locked} nothingFoundMessage="Cadastre em Cadastros › Clientes" />
          <Select label="Condição de pagamento" data={terms} value={form.paymentTermId} onChange={(v) => setForm({ ...form, paymentTermId: v })} required disabled={locked} allowDeselect={false} />
          <Select label="Tabela de preço" placeholder="Preço de venda do produto" data={tables} value={form.priceTableId} onChange={(v) => setForm({ ...form, priceTableId: v })} clearable disabled={locked} />
          {kind === 'quote' && <TextInput type="date" label="Validade" placeholder="Padrão do parâmetro MV_ORCVAL" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.currentTarget.value })} disabled={locked} />}
          <Select label="Empresa/filial" placeholder="Filial atual" data={companies} value={form.companyId} onChange={(v) => setForm({ ...form, companyId: v })} allowDeselect={false} disabled={locked} />
          <Select label="Tipo de operação" placeholder="S01 · Venda de mercadoria" data={operations.filter((o) => o.label.startsWith('S'))} value={form.operationTypeId} onChange={(v) => setForm({ ...form, operationTypeId: v })} clearable disabled={locked} />
          <Select label="Centro de custo" placeholder="Sem centro de custo" data={costCenters} value={costCenterId} onChange={setCostCenterId} clearable searchable disabled={locked} />
          {doc && <div><Text size="sm" fw={500}>Cliente</Text><Text size="sm" c="dimmed" ff="monospace">{cnpj(doc.customerDocument)}{doc.customerUf && ` · ${doc.customerUf}`} · {{ '1': 'contribuinte', '2': 'isento', '9': 'não contribuinte' }[doc.customerTaxpayer as '1']}</Text></div>}
        </SimpleGrid>
      </Card>

      <Card p={0} mb="md">
        <Table.ScrollContainer minWidth={1040}>
          <Table>
            <Table.Thead>
              <Table.Tr><Table.Th>Produto</Table.Th><Table.Th w={100}>Qtd.</Table.Th><Table.Th w={140}>Preço unit.</Table.Th><Table.Th w={90}>Desc. %</Table.Th><Table.Th ta="right" w={120}>Total</Table.Th><Table.Th w={86}>CFOP</Table.Th><Table.Th w={150}>Impostos</Table.Th><Table.Th ta="right" w={120}>Na nota</Table.Th><Table.Th w={44} /></Table.Tr>
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
                  <Table.Td>{l.cfop ? <Badge variant="light" radius="sm">{l.cfop}</Badge> : <Text size="xs" c="dimmed">—</Text>}</Table.Td>
                  <Table.Td><ItemTaxBadge taxes={l.taxes} /></Table.Td>
                  <Table.Td ta="right">{l.taxes ? money(l.taxes.total) : '—'}</Table.Td>
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
          <Textarea label="Observações (saem no documento e na nota)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })} autosize minRows={3} disabled={locked} />
          <SimpleGrid cols={2} mt="md">
            {locked ? <Text size="sm">Frete: {money(form.freight)}</Text> : <Money label="Frete" value={form.freight} onChange={(v) => setForm({ ...form, freight: Number(v) || 0 })} decimalScale={2} aria-label="Frete" />}
            {locked ? <Text size="sm">Desconto: {money(form.discount)}</Text> : <Money label="Desconto no documento" value={form.discount} onChange={(v) => setForm({ ...form, discount: Number(v) || 0 })} decimalScale={2} aria-label="Desconto no pedido" />}
          </SimpleGrid>
        </Card>
        <Card>
          <Group justify="space-between" mb="xs"><Text fw={700}>Totais e impostos</Text>{previewing && <Loader size="xs" />}</Group>
          {preview ? <TaxTotalsBlock totals={preview.totals} regime={regimeKey} csts={lines.map((l) => l.taxes?.icms.cst).filter((c): c is string => !!c)} /> : <Text size="sm" c="dimmed">Itens: {money(itemsTotal)}. Escolha o cliente para calcular os impostos.</Text>}
          {!locked && (
            <Group justify="flex-end" mt="md">
              <Button onClick={save} loading={busy} disabled={blocked || !dirty || !form.customerId || !form.paymentTermId || !lines.length}>{doc ? 'Salvar alterações' : kind === 'quote' ? 'Salvar orçamento' : 'Salvar pedido'}</Button>
            </Group>
          )}
        </Card>
      </SimpleGrid>

      {doc?.emails && <EmailHistory emails={doc.emails} />}
      {doc && <SendEmailModal opened={mailing} onClose={() => setMailing(false)} api={k.api} id={doc.id} code={doc.code} onSent={(emails) => setDoc({ ...doc, emails })} />}

      <Modal opened={losing} onClose={() => setLosing(false)} title={`Orçamento ${doc?.code} perdido`}>
        <Stack>
          <Textarea label="Motivo" placeholder="Preço, prazo de entrega, concorrente, desistência…" value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={2} data-autofocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setLosing(false)}>Voltar</Button>
            <Button color="red" disabled={reason.trim().length < 3} loading={busy} onClick={() => { post('lose', 'Orçamento marcado como perdido', { reason }); setLosing(false) }}>Marcar como perdido</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
