import { Anchor, Button, Card, Group, SimpleGrid, Stack, Table, Text, Textarea, ThemeIcon, Timeline, Title } from '@mantine/core'
import { IconArrowLeft, IconCheck, IconClock, IconPrinter, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Loading, PageHeader, ReportHeader, Status } from '../../components/ui'
import { api } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { cnpj, date, money, price, qty } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'
import type { OrderDetail as Detail } from '../../lib/types'

export default function OrderDetail() {
  const { id } = useParams()
  const user = useUser()
  const { data: o, error, setData } = useApi<Detail>(`/purchase-orders/${id}`)
  const [comment, setComment] = useState('')
  const { busy, run } = useAction()

  if (error) return <Text c="red">{error}</Text>
  if (!o) return <Loading />

  const decide = (kind: 'approve' | 'reject') => run(async () => {
    setData(await api<Detail>(`/purchase-orders/${id}/${kind}`, { method: 'POST', body: { comment: comment || undefined } }))
    setComment('')
  }, kind === 'approve' ? 'Pedido aprovado' : 'Pedido reprovado')
  const cancel = () => confirm(`Cancelar o pedido ${o.code}? Os itens voltam para cotação.`) && run(async () => setData(await api<Detail>(`/purchase-orders/${id}/cancel`, { method: 'POST', body: {} })), 'Pedido cancelado')
  const canCancel = ['aguardando_aprovacao', 'aprovado', 'reprovado'].includes(o.status) && (o.buyerId === user.id || user.role === 'admin')
  const itemsTotal = o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const facts: [string, React.ReactNode][] = [
    ['Fornecedor', <><Text fw={600}>{o.supplierName}</Text><Text size="xs" c="dimmed" ff="monospace">{cnpj(o.supplierCnpj)}</Text></>],
    ['Grupo de compras', o.purchaseGroupName], ['Condição de pagamento', o.paymentTerms || '—'],
    ['Prazo de entrega', o.deliveryDays !== null ? `${o.deliveryDays} dias` : '—'], ['Total', <Text fw={800} fz="xl">{money(o.total)}</Text>],
  ]

  return (
    <>
      <ReportHeader title={`Pedido de compra ${o.code}`} />
      <PageHeader
        back={<Anchor component={Link} to="/compras/pedidos" size="sm" c="dimmed"><Group gap={4}><IconArrowLeft size={14} /> Pedidos</Group></Anchor>}
        title={<Group gap="sm">{o.code} <Status value={o.status} /></Group>}
        description={`Emitido em ${date(o.createdAt)} por ${o.buyerName}${o.quotationCode ? ` · origem ${o.quotationCode}` : ''}`}
        actions={<><Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Imprimir</Button>{canCancel && <Button variant="subtle" color="red" onClick={cancel} loading={busy}>Cancelar pedido</Button>}</>}
      />

      <Card mb="md">
        <SimpleGrid cols={{ base: 2, md: 5 }}>
          {facts.map(([label, value]) => <div key={label}><Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={2}>{label}</Text><Text size="sm" component="div">{value}</Text></div>)}
        </SimpleGrid>
      </Card>

      <Card p={0} mb="xl">
        <Table.ScrollContainer minWidth={680}>
          <Table>
            <Table.Thead><Table.Tr><Table.Th>Item</Table.Th><Table.Th ta="right">Qtd.</Table.Th><Table.Th ta="right">Preço unit.</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th ta="right">Recebido</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {o.items.map((i) => (
                <Table.Tr key={i.id}>
                  <Table.Td>{i.sku && <Text span fw={700}>{i.sku} · </Text>}{i.description}{i.requestCode && <Text size="xs" c="dimmed">{i.requestCode}</Text>}</Table.Td>
                  <Table.Td ta="right">{qty(i.quantity)} {i.unit}</Table.Td>
                  <Table.Td ta="right">{price(i.unitPrice)}</Table.Td>
                  <Table.Td ta="right">{money(i.quantity * i.unitPrice)}</Table.Td>
                  <Table.Td ta="right">{qty(i.receivedQuantity)}</Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr bg="var(--mantine-color-default-hover)"><Table.Td colSpan={3} c="dimmed">Itens</Table.Td><Table.Td ta="right">{money(itemsTotal)}</Table.Td><Table.Td /></Table.Tr>
              <Table.Tr bg="var(--mantine-color-default-hover)"><Table.Td colSpan={3} c="dimmed">Frete</Table.Td><Table.Td ta="right">{money(o.freight)}</Table.Td><Table.Td /></Table.Tr>
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <Title order={4} mb="md">Aprovação</Title>
      {!o.requiredLevels.length && <Text c="dimmed">Grupo sem alçada: pedido aprovado automaticamente.</Text>}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
        <Timeline bulletSize={30} lineWidth={2} active={o.levels.findIndex((l) => l.level === o.pendingLevel)}>
          {o.levels.map((l) => {
            const decision = [...o.approvals].reverse().find((a) => a.level === l.level)
            const pending = o.pendingLevel === l.level
            const bullet = decision
              ? <ThemeIcon radius="xl" size={30} color={decision.decision === 'aprovado' ? 'teal' : 'red'}>{decision.decision === 'aprovado' ? <IconCheck size={16} /> : <IconX size={16} />}</ThemeIcon>
              : <ThemeIcon radius="xl" size={30} color={pending ? 'yellow' : 'gray'} variant={pending ? 'filled' : 'light'}>{pending ? <IconClock size={16} /> : <Text size="xs" fw={700}>{l.level}</Text>}</ThemeIcon>
            return (
              <Timeline.Item key={l.level} bullet={bullet} title={<Text fw={600}>Nível {l.level} · {l.limitAmount === null ? 'sem limite' : `até ${money(l.limitAmount)}`}</Text>}>
                <Text size="sm" c="dimmed">{l.approvers.join(', ')}</Text>
                {decision && <Text size="sm" mt={4}>{decision.decision === 'aprovado' ? 'Aprovado' : 'Reprovado'} por {decision.userName} em {date(decision.createdAt)}{decision.comment && ` — "${decision.comment}"`}</Text>}
                {!decision && pending && <Text size="sm" c="yellow" mt={4}>Aguardando este nível</Text>}
              </Timeline.Item>
            )
          })}
        </Timeline>
        {o.canApprove && (
          <Card className="no-print">
            <Stack>
              <Text fw={700}>Sua decisão (nível {o.pendingLevel})</Text>
              <Textarea label="Comentário" description="Obrigatório para reprovar" autosize minRows={2} value={comment} onChange={(e) => setComment(e.currentTarget.value)} />
              <Group>
                <Button color="teal" leftSection={<IconCheck size={16} />} onClick={() => decide('approve')} loading={busy}>Aprovar nível {o.pendingLevel}</Button>
                <Button variant="light" color="red" leftSection={<IconX size={16} />} onClick={() => decide('reject')} loading={busy}>Reprovar</Button>
              </Group>
            </Stack>
          </Card>
        )}
      </SimpleGrid>
      {o.status === 'aguardando_aprovacao' && !o.canApprove && o.buyerId === user.id && <Text size="sm" c="dimmed" mt="md">Você gerou este pedido, então não pode aprová-lo.</Text>}
    </>
  )
}
