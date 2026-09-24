import { Alert, Anchor, Badge, Button, Card, Group, List, Radio, Select, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core'
import { IconArrowLeft, IconCircleCheck, IconScale, IconTable } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BrNumber, Money } from '../../components/inputs'
import { Loading, PageHeader, Status } from '../../components/ui'
import { api } from '../../lib/api'
import { date, money, price, qty, toNumber } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'
import type { Quotation, Supplier } from '../../lib/types'

interface SupplierForm { paymentTerms: string; deliveryDays: number | string; freight: number | string; prices: Record<string, number | string> }
interface CreatedOrder { id: string; code: string; supplierName: string; total: number; status: string }

export default function QuotationDetail() {
  const { id } = useParams()
  const { data: q, error, setData } = useApi<Quotation>(`/quotations/${id}`)
  const suppliers = useApi<Supplier[]>('/suppliers')
  const [tab, setTab] = useState<string | null>('precos')
  const [form, setForm] = useState<Record<string, SupplierForm> | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<CreatedOrder[] | null>(null)
  const [addId, setAddId] = useState<string | null>(null)
  const { busy, run } = useAction()

  useEffect(() => {
    if (!q) return
    setForm(Object.fromEntries(q.suppliers.map((s) => [s.id, {
      paymentTerms: s.paymentTerms ?? '', deliveryDays: s.deliveryDays ?? '', freight: s.freight || '',
      prices: Object.fromEntries(q.items.map((i) => [i.id, i.prices.find((p) => p.quotationSupplierId === s.id)?.unitPrice ?? ''])),
    }])))
  }, [q])

  // Mapa comparativo calculado com o que está digitado.
  const analysis = useMemo(() => {
    if (!q || !form) return null
    const items = q.items.map((i) => {
      const cells = q.suppliers.map((s) => ({ sid: s.id, value: toNumber(form[s.id]?.prices[i.id]) }))
      const quoted = cells.filter((c) => c.value !== null).map((c) => c.value as number)
      const best = quoted.length ? Math.min(...quoted) : null
      return { ...i, cells, best, bestIds: cells.filter((c) => best !== null && c.value === best).map((c) => c.sid) }
    })
    const totals = q.suppliers.map((s) => {
      const items2 = items.reduce((sum, i) => sum + (i.cells.find((c) => c.sid === s.id)!.value ?? 0) * i.quantity, 0)
      const quoted = items.filter((i) => i.cells.find((c) => c.sid === s.id)!.value !== null).length
      return { sid: s.id, items: items2, freight: toNumber(form[s.id]?.freight) ?? 0, quoted }
    })
    return { items, totals }
  }, [q, form])

  // Vencedor: escolha manual (se ainda tiver preço) ou o menor preço.
  const winners = useMemo(() => Object.fromEntries((analysis?.items ?? []).map((i) => {
    const manual = choices[i.id]
    const valid = manual && i.cells.some((c) => c.sid === manual && c.value !== null)
    return [i.id, valid ? manual : i.bestIds[0] ?? null]
  })), [analysis, choices])

  if (error) return <Text c="red">{error}</Text>
  if (!q || !form || !analysis) return <Loading />

  const open = q.status === 'aberta'
  const setSup = (sid: string, patch: Partial<SupplierForm>) => setForm({ ...form, [sid]: { ...form[sid]!, ...patch } })
  const body = () => ({
    suppliers: q.suppliers.map((s) => ({
      quotationSupplierId: s.id, paymentTerms: form[s.id]!.paymentTerms || undefined,
      deliveryDays: toNumber(form[s.id]!.deliveryDays), freight: toNumber(form[s.id]!.freight) ?? 0,
      prices: q.items.map((i) => ({ quotationItemId: i.id, unitPrice: toNumber(form[s.id]!.prices[i.id]) })),
    })),
  })
  const save = () => run(async () => setData(await api<Quotation>(`/quotations/${id}/responses`, { method: 'PUT', body: body() })), 'Preços salvos')
  const addSupplier = () => addId && run(async () => {
    await api(`/quotations/${id}/responses`, { method: 'PUT', body: body() })
    setData(await api<Quotation>(`/quotations/${id}/suppliers`, { method: 'POST', body: { supplierId: addId } }))
    setAddId(null)
  }, 'Fornecedor adicionado')
  const cancel = () => confirm('Cancelar esta cotação? Os itens voltam para "pendente".') && run(async () => setData(await api<Quotation>(`/quotations/${id}/cancel`, { method: 'POST' })), 'Cotação cancelada')
  const close = () => {
    const list = Object.entries(winners).filter(([, sid]) => sid).map(([quotationItemId, quotationSupplierId]) => ({ quotationItemId, quotationSupplierId }))
    if (!confirm(`Gerar ${new Set(list.map((w) => w.quotationSupplierId)).size} pedido(s) de compra?`)) return
    run(async () => {
      await api(`/quotations/${id}/responses`, { method: 'PUT', body: body() })
      const res = await api<{ quotation: Quotation; orders: CreatedOrder[] }>(`/quotations/${id}/close`, { method: 'POST', body: { winners: list } })
      setData(res.quotation)
      setCreated(res.orders)
    }, 'Pedidos gerados')
  }

  const preview = q.suppliers.map((s) => {
    const won = analysis.items.filter((i) => winners[i.id] === s.id)
    const value = won.reduce((sum, i) => sum + (i.cells.find((c) => c.sid === s.id)!.value ?? 0) * i.quantity, 0)
    return { s, count: won.length, total: won.length ? value + (toNumber(form[s.id]!.freight) ?? 0) : 0 }
  }).filter((p) => p.count)

  const supplierHeads = q.suppliers.map((s) => <Table.Th key={s.id} ta="right" miw={170}>{s.name}</Table.Th>)

  return (
    <>
      <PageHeader
        back={<Anchor component={Link} to=".." relative="path" size="sm" c="dimmed"><Group gap={4}><IconArrowLeft size={14} /> Cotações</Group></Anchor>}
        title={<Group gap="sm">{q.code} <Status value={q.status} /></Group>}
        description={`${q.purchaseGroupName} · comprador ${q.buyerName} · prazo ${date(q.deadline)}`}
        actions={open && <><Button variant="subtle" color="red" onClick={cancel} loading={busy}>Cancelar cotação</Button><Button variant="default" onClick={save} loading={busy}>Salvar preços</Button></>}
      />

      {created && (
        <Alert color="teal" icon={<IconCircleCheck />} title="Pedidos gerados" mb="md">
          <List size="sm">{created.map((o) => <List.Item key={o.id}><Anchor component={Link} to={`../../pedidos/${o.id}`} relative="path" fw={600}>{o.code}</Anchor> · {o.supplierName} · {money(o.total)} · <Status value={o.status} /></List.Item>)}</List>
        </Alert>
      )}

      <Tabs value={tab} onChange={setTab} variant="pills" mb="md">
        <Tabs.List>
          <Tabs.Tab value="precos" leftSection={<IconTable size={16} />}>1. Preços dos fornecedores</Tabs.Tab>
          <Tabs.Tab value="analise" leftSection={<IconScale size={16} />}>2. Análise e pedido</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {tab === 'precos' && (
        <Card p={0}>
          <Table.ScrollContainer minWidth={320 + q.suppliers.length * 180}>
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Item</Table.Th><Table.Th ta="right">Qtd.</Table.Th>{supplierHeads}</Table.Tr></Table.Thead>
              <Table.Tbody>
                {q.items.map((i) => (
                  <Table.Tr key={i.id}>
                    <Table.Td>{i.sku && <Text span fw={700}>{i.sku} · </Text>}{i.description}{i.requestCode && <Text size="xs" c="dimmed">{i.requestCode}</Text>}</Table.Td>
                    <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>{qty(i.quantity)} {i.unit}</Table.Td>
                    {q.suppliers.map((s) => (
                      <Table.Td key={s.id}>
                        <Money size="sm" disabled={!open} placeholder="não cotou" value={form[s.id]!.prices[i.id]} onChange={(v) => setSup(s.id, { prices: { ...form[s.id]!.prices, [i.id]: v } })} styles={{ input: { textAlign: 'right' } }} aria-label={`Preço unitário ${s.name} ${i.description}`} />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
                <Table.Tr bg="var(--mantine-color-default-hover)"><Table.Td colSpan={2}><Text size="sm" c="dimmed">Frete</Text></Table.Td>{q.suppliers.map((s) => <Table.Td key={s.id}><Money size="sm" decimalScale={2} disabled={!open} placeholder="R$ 0,00" value={form[s.id]!.freight} onChange={(v) => setSup(s.id, { freight: v })} styles={{ input: { textAlign: 'right' } }} aria-label={`Frete ${s.name}`} /></Table.Td>)}</Table.Tr>
                <Table.Tr bg="var(--mantine-color-default-hover)"><Table.Td colSpan={2}><Text size="sm" c="dimmed">Prazo de entrega (dias)</Text></Table.Td>{q.suppliers.map((s) => <Table.Td key={s.id}><BrNumber size="sm" decimalScale={0} disabled={!open} value={form[s.id]!.deliveryDays} onChange={(v) => setSup(s.id, { deliveryDays: v })} styles={{ input: { textAlign: 'right' } }} aria-label={`Prazo ${s.name}`} /></Table.Td>)}</Table.Tr>
                <Table.Tr bg="var(--mantine-color-default-hover)"><Table.Td colSpan={2}><Text size="sm" c="dimmed">Condição de pagamento</Text></Table.Td>{q.suppliers.map((s) => <Table.Td key={s.id}><TextInput size="sm" disabled={!open} placeholder="28 dias" value={form[s.id]!.paymentTerms} onChange={(e) => setSup(s.id, { paymentTerms: e.currentTarget.value })} aria-label={`Pagamento ${s.name}`} /></Table.Td>)}</Table.Tr>
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {open && (
            <Group p="md" gap="sm">
              <Select placeholder="Adicionar fornecedor…" searchable clearable w={280} value={addId} onChange={setAddId}
                data={suppliers.data?.filter((s) => s.active && !q.suppliers.some((x) => x.supplierId === s.id)).map((s) => ({ value: s.id, label: s.name })) ?? []} />
              <Button variant="default" onClick={addSupplier} disabled={!addId} loading={busy}>Adicionar</Button>
              <Button ml="auto" onClick={async () => { await save(); setTab('analise') }} loading={busy}>Salvar e analisar →</Button>
            </Group>
          )}
        </Card>
      )}

      {tab === 'analise' && (
        <Stack>
          <Card p={0}>
            <Table.ScrollContainer minWidth={320 + q.suppliers.length * 180}>
              <Table>
                <Table.Thead><Table.Tr><Table.Th>Item</Table.Th><Table.Th ta="right">Qtd.</Table.Th>{supplierHeads}</Table.Tr></Table.Thead>
                <Table.Tbody>
                  {analysis.items.map((i) => (
                    <Table.Tr key={i.id}>
                      <Table.Td>{i.description}</Table.Td>
                      <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>{qty(i.quantity)} {i.unit}</Table.Td>
                      {i.cells.map((c) => (
                        <Table.Td key={c.sid} ta="right" className={`${i.bestIds.includes(c.sid) ? 'cell-best' : ''} ${winners[i.id] === c.sid ? 'cell-chosen' : ''}`}>
                          {c.value === null ? <Text c="dimmed">—</Text> : (
                            <Radio
                              name={`w-${i.id}`} disabled={!open} checked={winners[i.id] === c.sid} onChange={() => setChoices({ ...choices, [i.id]: c.sid })}
                              labelPosition="left" styles={{ body: { justifyContent: 'flex-end' } }}
                              label={<div><Text size="sm" fw={600}>{price(c.value)}</Text><Text size="xs" c="dimmed">{money(c.value * i.quantity)}</Text></div>}
                            />
                          )}
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                  <Table.Tr bg="var(--mantine-color-default-hover)"><Table.Td colSpan={2}><Text size="sm" c="dimmed">Itens cotados</Text></Table.Td>{analysis.totals.map((t) => <Table.Td key={t.sid} ta="right">{t.quoted}/{q.items.length}</Table.Td>)}</Table.Tr>
                  <Table.Tr bg="var(--mantine-color-default-hover)"><Table.Td colSpan={2}><Text size="sm" c="dimmed">Frete</Text></Table.Td>{analysis.totals.map((t) => <Table.Td key={t.sid} ta="right">{money(t.freight)}</Table.Td>)}</Table.Tr>
                  <Table.Tr bg="var(--mantine-color-default-hover)"><Table.Td colSpan={2}><Text size="sm" c="dimmed">Prazo · pagamento</Text></Table.Td>{q.suppliers.map((s) => <Table.Td key={s.id} ta="right"><Text size="sm">{form[s.id]!.deliveryDays !== '' ? `${form[s.id]!.deliveryDays} dias` : '—'} · {form[s.id]!.paymentTerms || '—'}</Text></Table.Td>)}</Table.Tr>
                  <Table.Tr><Table.Td colSpan={2} fw={700}>Total se comprar tudo</Table.Td>{analysis.totals.map((t) => <Table.Td key={t.sid} ta="right" fw={700}>{t.quoted === q.items.length ? money(t.items + t.freight) : <Badge color="gray" variant="light">incompleto</Badge>}</Table.Td>)}</Table.Tr>
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
          <Text size="sm" c="dimmed">Verde = menor preço do item. O vencedor já vem marcado no menor preço; troque se preferir outro fornecedor (prazo, condição de pagamento, qualidade).</Text>
          {open && (
            <Card>
              <Title order={5} mb="sm">Pedidos que serão gerados</Title>
              {preview.length ? (
                <Stack gap={6} mb="md" className="order-preview">{preview.map((p) => <Group key={p.s.id} justify="space-between"><Text fw={600}>{p.s.name}</Text><Text>{p.count} item(ns) · <b>{money(p.total)}</b></Text></Group>)}</Stack>
              ) : <Text c="dimmed" mb="md">Nenhum vencedor escolhido.</Text>}
              {analysis.items.some((i) => !winners[i.id]) && <Text size="sm" c="dimmed" mb="md">Itens sem vencedor voltam para "pendente" e podem entrar em outra cotação.</Text>}
              <Button variant="gradient" onClick={close} loading={busy} disabled={!preview.length}>Gerar pedidos de compra</Button>
            </Card>
          )}
        </Stack>
      )}
    </>
  )
}
