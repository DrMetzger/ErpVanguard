import { Alert, Anchor, Badge, Button, Card, Group, List, Modal, Select, SimpleGrid, Stack, Table, Text, TextInput, ThemeIcon, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconArrowLeft, IconBox, IconCircleCheck, IconCoin, IconReceiptTax, IconSparkles, IconTrash } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loading, PageHeader, ProductSelect, Status } from '../../components/ui'
import { api } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { useOptions } from '../../lib/catalog'
import { useCostCenters } from '../../lib/costCenters'
import { can, cnpj, date, money, price, qty } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'
import type { CatalogRow, Invoice, InvoiceItem, Product } from '../../lib/types'

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
  const user = useUser()
  const operations = useOptions('operation-types')
  const costCenters = useCostCenters()
  const { data: tesList } = useApi<CatalogRow[]>('/catalog/tes')
  const entryTes = (tesList ?? []).filter((t) => t.kind === 'E' && t.active).map((t) => ({ value: String(t.id), label: `${t.code} · ${t.description}` }))

  if (error) return <Text c="red">{error}</Text>
  if (!nf) return <Loading />

  const pending = nf.status === 'pre_nota'
  const fiscal = can(user, 'fiscal')
  const noTes = nf.items.filter((i) => !i.tesId).length
  const unmatched = nf.items.filter((i) => !i.productId).length
  const update = (body: { purchaseOrderId?: string | null; operationTypeId?: string; costCenterId?: string | null; items?: { id: string; productId?: string | null; orderItemId?: string | null; tesId?: string }[] }) =>
    run(async () => setData(await api<Invoice>(`/invoices/${id}`, { method: 'PUT', body: { items: [], ...body } })))
  const ai = () => run(async () => setData(await api<Invoice>(`/invoices/${id}/ai-match`, { method: 'POST' })), 'Sugestões da IA aplicadas')
  const summary = [
    nf.preview.stockItems ? `${nf.preview.stockItems} item(ns) entram no estoque` : 'nenhum item movimenta estoque',
    nf.preview.financialAmount > 0
      ? nf.preview.financialKind === 'NCC' ? `crédito ao cliente (NCC) de ${money(nf.preview.financialAmount)} no contas a receber` : `contas a pagar de ${money(nf.preview.financialAmount)}${nf.preview.duplicates ? ` em ${nf.preview.duplicates} duplicata(s) do XML` : ''}`
      : 'não gera financeiro',
  ]
  const post = () => confirm(`Classificar a nota?\n\n• ${summary.join('\n• ')}`) && run(async () => setData(await api<Invoice>(`/invoices/${id}/classify`, { method: 'POST' })), 'Nota classificada')
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
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Emissão · destinatário</Text><Text>{date(nf.issueDate)}</Text>
            <Text size="xs" c={nf.companyLabel ? 'dimmed' : 'orange'}>{nf.companyLabel ?? (nf.recipientDocument ? cnpj(nf.recipientDocument) : '—')}</Text>
          </div>
          <div><Text size="xs" c="dimmed" tt="uppercase" fw={700}>Total da nota</Text><Text fw={800} fz="xl">{money(nf.total)}</Text></div>
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Pedido de compra</Text>
            {pending ? (
              <Select placeholder="Sem pedido" clearable value={nf.purchaseOrderId} onChange={(v) => update({ purchaseOrderId: v })} data={nf.orders.map((o) => ({ value: o.id, label: `${o.code} · ${money(o.total)}` }))} aria-label="Pedido de compra" />
            ) : <Text>{nf.orderCode ?? '—'}</Text>}
          </div>
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Centro de custo</Text>
            {pending ? (
              <Select placeholder="Sem centro de custo" clearable searchable value={(nf as Invoice & { costCenterId?: string | null }).costCenterId ?? null} onChange={(v) => update({ costCenterId: v })} data={costCenters} aria-label="Centro de custo" />
            ) : <Text>{(nf as Invoice & { costCenter?: string | null }).costCenter ?? '—'}</Text>}
          </div>
        </SimpleGrid>
      </Card>

      <Card mb="md">
        <Group mb="sm" gap="xs"><IconReceiptTax size={18} /><Text fw={700}>Classificação fiscal</Text>{nf.isReturn && <Badge color="orange" variant="light" radius="sm">Devolução</Badge>}</Group>
        <SimpleGrid cols={{ base: 1, md: 3 }}>
          {pending && fiscal ? (
            <Select label="Tipo de operação (entrada)" data={operations.filter((o) => o.label.startsWith('E'))} value={nf.operationTypeId} onChange={(v) => v && update({ operationTypeId: v })} allowDeselect={false} searchable
              description="Trocar a operação sugere de novo a TES de cada item" />
          ) : <div><Text size="xs" c="dimmed" tt="uppercase" fw={700}>Tipo de operação</Text><Text>{nf.operationLabel ?? '—'}</Text></div>}
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon variant="light" color={nf.preview.stockItems ? 'teal' : 'gray'} size={36} radius="md"><IconBox size={20} /></ThemeIcon>
            <div><Text size="xs" c="dimmed" tt="uppercase" fw={700}>Estoque</Text><Text size="sm">{nf.preview.stockItems ? `${nf.preview.stockItems} de ${nf.items.length} item(ns) ${pending ? 'entram' : 'entraram'}${nf.isReturn ? ' (pelo custo médio atual)' : ' e atualizam o custo médio'}` : 'Nenhum item movimenta estoque'}</Text></div>
          </Group>
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon variant="light" color={nf.preview.financialAmount ? 'teal' : 'gray'} size={36} radius="md"><IconCoin size={20} /></ThemeIcon>
            <div><Text size="xs" c="dimmed" tt="uppercase" fw={700}>Financeiro</Text><Text size="sm">{summary[1]!.replace(/^./, (c) => c.toUpperCase())}</Text>{nf.customerName && <Text size="xs" c="dimmed">Cliente: {nf.customerName}</Text>}</div>
          </Group>
        </SimpleGrid>
      </Card>

      {nf.warnings.length > 0 && pending && (
        <Alert color="yellow" icon={<IconAlertTriangle />} title="Confira antes de classificar" mb="md">
          <List size="sm">{nf.warnings.map((w) => <List.Item key={w}>{w}</List.Item>)}</List>
        </Alert>
      )}

      <Card p={0} mb="md">
        <Table.ScrollContainer minWidth={nf.purchaseOrderId ? 1100 : 860}>
          <Table className="invoice-table" verticalSpacing="md">
            <Table.Thead><Table.Tr><Table.Th w={40}>#</Table.Th><Table.Th>Item na nota</Table.Th><Table.Th ta="right">Qtd.</Table.Th><Table.Th ta="right">Unit.</Table.Th><Table.Th miw={300}>Produto no sistema</Table.Th><Table.Th miw={240}>TES · CFOP</Table.Th>{nf.purchaseOrderId && !nf.isReturn && <Table.Th miw={240}>Item do pedido</Table.Th>}</Table.Tr></Table.Thead>
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
                    <Table.Td>
                      {pending && fiscal ? (
                        <Select placeholder="Escolher TES…" data={entryTes} value={i.tesId} onChange={(v) => v && update({ items: [{ id: i.id, tesId: v }] })} allowDeselect={false} searchable aria-label={`TES do item ${i.itemNumber}`} error={!i.tesId ? 'Sem regra na matriz fiscal' : undefined} />
                      ) : <Text size="sm">{i.tesLabel ?? <Text span c="orange">sem TES</Text>}</Text>}
                      <Group gap={6} mt={4}>
                        {i.entryCfop && <Badge size="sm" variant="light" radius="sm">CFOP {i.entryCfop}</Badge>}
                        {i.tesId && <Badge size="sm" variant="dot" color={i.updatesStock ? 'teal' : 'gray'} style={{ textTransform: 'none' }}>{i.updatesStock ? 'estoque' : 'sem estoque'}</Badge>}
                        {i.tesId && <Badge size="sm" variant="dot" color={i.generatesFinancial ? 'teal' : 'gray'} style={{ textTransform: 'none' }}>{i.generatesFinancial ? 'financeiro' : 'sem financeiro'}</Badge>}
                      </Group>
                    </Table.Td>
                    {nf.purchaseOrderId && !nf.isReturn && (
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
          {fiscal
            ? <Button ml="auto" size="md" onClick={post} loading={busy} disabled={unmatched > 0 || noTes > 0}>{unmatched ? `Faltam ${unmatched} produto(s)` : noTes ? `Falta TES em ${noTes} item(ns)` : 'Classificar nota'}</Button>
            : <Text ml="auto" size="sm" c="dimmed">Pré-nota pronta. A classificação fiscal (TES) é feita pelo perfil Fiscal.</Text>}
        </Group>
      ) : (
        <Stack>
          <Alert color="teal" icon={<IconCircleCheck />}>Nota classificada em {date(nf.postedAt)}{nf.classifiedBy && ` por ${nf.classifiedBy}`}.</Alert>
          {nf.titles.length > 0 && (
            <Card p={0}>
              <Table>
                <Table.Thead><Table.Tr><Table.Th>Título gerado</Table.Th><Table.Th>Parcela</Table.Th><Table.Th>Vencimento</Table.Th><Table.Th ta="right">Valor</Table.Th><Table.Th>Situação</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {nf.titles.map((t) => (
                    <Table.Tr key={t.id}>
                      <Table.Td>{t.docType === 'NCC' ? 'Crédito do cliente (NCC) · a receber' : 'Contas a pagar'}</Table.Td>
                      <Table.Td>{t.installment}/{t.installments}</Table.Td><Table.Td>{date(t.dueDate)}</Table.Td>
                      <Table.Td ta="right">{money(t.amount)}</Table.Td><Table.Td><Status value={t.status} /></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          )}
        </Stack>
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
        <Text size="sm" c="dimmed">Dados trazidos da nota. O estoque e o custo entram quando a nota for classificada.</Text>
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
