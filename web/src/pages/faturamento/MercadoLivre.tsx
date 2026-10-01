import { ActionIcon, Alert, Anchor, Badge, Button, Card, Group, Modal, Select, SimpleGrid, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconCloudUpload, IconExternalLink, IconLink, IconLinkOff, IconRefresh, IconSearch, IconShoppingCart } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading } from '../../components/ui'
import { api } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { can, money } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'

interface Listing { productId: string; sku: string; name: string; salePrice: number; id: string | null; externalId: string | null; title: string | null; permalink: string | null; status: string | null; price: number | null; quantity: number | null; syncedAt: string | null; syncError: string | null }
interface MlOrder { id: string; externalId: string; status: string; buyer: string | null; total: number | null; error: string | null; createdAt: string; salesOrderId: string | null; orderNumber: number | null }
const when = (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const ITEM_STATUS: Record<string, string> = { active: 'ativo', paused: 'pausado', closed: 'finalizado', under_review: 'em revisão', inactive: 'inativo' }
const ORDER_COLOR: Record<string, string> = { importado: 'teal', erro: 'red', aguardando: 'yellow' }

// Faturamento › Mercado Livre: vendas que viram pedido e anúncios ligados aos produtos.
export default function MercadoLivre() {
  const user = useUser()
  const status = useApi<{ connected: boolean; nickname: string | null }>('/marketplace/mercadolivre/status')
  if (!status.data) return <Loading />
  if (!status.data.connected) {
    return (
      <Alert color="yellow" icon={<IconShoppingCart size={18} />} title="Mercado Livre ainda não conectado">
        A conta é conectada em Administração › Integrações.{' '}
        {user.role === 'admin' ? <Anchor component={Link} to="/integracoes">Abrir Integrações</Anchor> : 'Peça a um administrador.'}
      </Alert>
    )
  }
  return (
    <Stack>
      <Text size="sm" c="dimmed">Conta <b>{status.data.nickname}</b>. Vendas pagas viram pedido de venda sozinhas; preço e estoque da filial da integração vão para os anúncios a cada 5 minutos.</Text>
      {can(user, 'faturamento') && <Orders />}
      {can(user, 'cadastro') && <Listings />}
    </Stack>
  )
}

function Orders() {
  const { data, reload } = useApi<MlOrder[]>('/marketplace/mercadolivre/orders')
  const { busy, run } = useAction()
  const fetchNow = () => run(async () => { const r = await api<{ found: number; created: number }>('/marketplace/mercadolivre/orders/import', { method: 'POST' }); reload(); return r }, 'Vendas conferidas')
  const retry = (o: MlOrder) => run(async () => { await api(`/marketplace/mercadolivre/orders/${o.externalId}/retry`, { method: 'POST' }); reload() })
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Text fw={700}>Vendas</Text>
        <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} loading={busy} onClick={fetchNow}>Buscar vendas</Button>
      </Group>
      {!data ? <Loading /> : !data.length ? <Text size="sm" c="dimmed">Nenhuma venda recebida ainda.</Text> : (
        <Table.ScrollContainer minWidth={640}>
          <Table striped>
            <Table.Thead><Table.Tr><Table.Th>Quando</Table.Th><Table.Th>Venda</Table.Th><Table.Th>Comprador</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Situação</Table.Th><Table.Th>Pedido</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {data.map((o) => (
                <Table.Tr key={o.id}>
                  <Table.Td>{when(o.createdAt)}</Table.Td>
                  <Table.Td>{o.externalId}</Table.Td>
                  <Table.Td>{o.buyer}</Table.Td>
                  <Table.Td ta="right">{o.total === null ? '—' : money(Number(o.total))}</Table.Td>
                  <Table.Td><Badge size="sm" variant="light" color={ORDER_COLOR[o.status] ?? 'gray'}>{o.status}</Badge>{o.error && <Text size="xs" c={o.status === 'erro' ? 'red' : 'dimmed'}>{o.error}</Text>}</Table.Td>
                  <Table.Td>
                    {o.salesOrderId ? <Anchor component={Link} to={`/faturamento/pedidos/${o.salesOrderId}`} size="sm">PV-{String(o.orderNumber).padStart(6, '0')}</Anchor>
                      : o.status === 'erro' ? <Button size="compact-xs" variant="light" onClick={() => retry(o)} loading={busy}>Reprocessar</Button> : '—'}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  )
}

function Listings() {
  const [query, setQuery] = useState('')
  const [q] = useDebouncedValue(query.trim(), 300)
  const { data, reload } = useApi<Listing[]>(`/marketplace/mercadolivre/listings${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  const [linking, setLinking] = useState<Listing | null>(null)
  const [publishing, setPublishing] = useState<Listing | null>(null)
  const { busy, run } = useAction()
  const syncAll = () => run(async () => { const r = await api<{ listings: number; sent: number }>('/marketplace/mercadolivre/sync', { method: 'POST' }); reload(); return r }, 'Preço e estoque enviados')
  const sync = (l: Listing) => run(async () => { await api(`/marketplace/mercadolivre/listings/${l.id}/sync`, { method: 'POST' }); reload() }, 'Enviado')
  const unlink = (l: Listing) => confirm(`Desvincular ${l.externalId}? O anúncio continua no Mercado Livre, só para de ser atualizado pelo ERP.`) && run(async () => { await api(`/marketplace/mercadolivre/listings/${l.id}`, { method: 'DELETE' }); reload() }, 'Desvinculado')
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs" gap="xs">
        <Text fw={700}>Anúncios</Text>
        <Group gap="xs">
          <TextInput size="xs" placeholder="Buscar produto ou MLB" leftSection={<IconSearch size={14} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={200} />
          <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} loading={busy} onClick={syncAll}>Sincronizar tudo</Button>
        </Group>
      </Group>
      {!data ? <Loading /> : (
        <Table.ScrollContainer minWidth={720}>
          <Table striped>
            <Table.Thead><Table.Tr><Table.Th>Produto</Table.Th><Table.Th>Anúncio</Table.Th><Table.Th ta="right">Preço</Table.Th><Table.Th ta="right">Estoque</Table.Th><Table.Th>Atualizado</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {data.map((l) => (
                <Table.Tr key={l.productId + (l.id ?? '')}>
                  <Table.Td><Text size="sm" fw={600}>{l.sku}</Text><Text size="xs" c="dimmed" lineClamp={1}>{l.name}</Text></Table.Td>
                  <Table.Td>{l.externalId
                    ? <Group gap={4} wrap="nowrap"><Text size="sm">{l.externalId}</Text>{l.permalink && <ActionIcon component="a" href={l.permalink} target="_blank" variant="subtle" size="sm" aria-label="Abrir anúncio"><IconExternalLink size={14} /></ActionIcon>}{l.status && <Badge size="xs" variant="light" color={l.status === 'active' ? 'teal' : 'gray'}>{ITEM_STATUS[l.status] ?? l.status}</Badge>}</Group>
                    : <Text size="sm" c="dimmed">sem anúncio</Text>}</Table.Td>
                  <Table.Td ta="right">{l.price === null ? '—' : money(l.price)}</Table.Td>
                  <Table.Td ta="right">{l.quantity ?? '—'}</Table.Td>
                  <Table.Td><Text size="xs">{when(l.syncedAt)}</Text>{l.syncError && <Text size="xs" c="red">{l.syncError}</Text>}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      {l.id ? <>
                        <Tooltip label="Enviar preço e estoque agora"><ActionIcon variant="subtle" onClick={() => sync(l)} aria-label="Sincronizar"><IconRefresh size={16} /></ActionIcon></Tooltip>
                        <Tooltip label="Desvincular"><ActionIcon variant="subtle" color="red" onClick={() => unlink(l)} aria-label="Desvincular"><IconLinkOff size={16} /></ActionIcon></Tooltip>
                      </> : <>
                        <Button size="compact-xs" variant="light" leftSection={<IconLink size={12} />} onClick={() => setLinking(l)}>Vincular</Button>
                        <Button size="compact-xs" variant="light" color="yellow" leftSection={<IconCloudUpload size={12} />} onClick={() => setPublishing(l)}>Publicar</Button>
                      </>}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {linking && <LinkModal l={linking} onClose={() => setLinking(null)} onDone={() => { setLinking(null); reload() }} />}
      {publishing && <PublishModal l={publishing} onClose={() => setPublishing(null)} onDone={() => { setPublishing(null); reload() }} />}
    </Card>
  )
}

function LinkModal({ l, onClose, onDone }: { l: Listing; onClose: () => void; onDone: () => void }) {
  const [itemId, setItemId] = useState('')
  const { busy, run } = useAction()
  const save = () => run(async () => { await api('/marketplace/mercadolivre/link', { method: 'POST', body: { productId: l.productId, itemId } }); onDone() }, 'Anúncio vinculado')
  return (
    <Modal opened onClose={onClose} title={`Vincular ${l.sku} a um anúncio existente`}>
      <Stack>
        <TextInput label="Código do anúncio" description="Aparece no anúncio do Mercado Livre (ex.: MLB1234567890)" value={itemId} onChange={(e) => setItemId(e.currentTarget.value)} data-autofocus />
        <Text size="xs" c="dimmed">Ao vincular, o preço e o estoque do ERP passam a valer no anúncio.</Text>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy} disabled={itemId.trim().length < 4}>Vincular</Button></Group>
      </Stack>
    </Modal>
  )
}

function PublishModal({ l, onClose, onDone }: { l: Listing; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(l.name.slice(0, 60))
  const [cats, setCats] = useState<{ categoryId: string; category: string; domain: string }[] | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [attrs, setAttrs] = useState<{ id: string; name: string; values: string[] }[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [listingType, setListingType] = useState('gold_special')
  const { busy, run } = useAction()
  const suggest = () => run(async () => { const c = await api<typeof cats>(`/marketplace/mercadolivre/categories?q=${encodeURIComponent(title)}`); setCats(c); if (c?.[0]) await pick(c[0].categoryId) })
  const pick = async (id: string | null) => { setCategoryId(id); setAttrs(id ? await api(`/marketplace/mercadolivre/categories/${id}/attributes`) : []) }
  const publish = () => run(async () => {
    await api('/marketplace/mercadolivre/publish', { method: 'POST', body: { productId: l.productId, categoryId, title, listingType, attributes: Object.entries(values).map(([id, value]) => ({ id, value })) } })
    onDone()
  }, 'Anúncio publicado')
  return (
    <Modal opened onClose={onClose} title={`Publicar ${l.sku} no Mercado Livre`} size="lg">
      <Stack>
        <TextInput label="Título do anúncio" description={`${title.length}/60 caracteres`} value={title} maxLength={60} onChange={(e) => setTitle(e.currentTarget.value)} />
        <Group align="flex-end" gap="xs">
          <Select label="Categoria" placeholder="Clique em Sugerir" data={(cats ?? []).map((c) => ({ value: c.categoryId, label: `${c.category} (${c.categoryId})` }))} value={categoryId} onChange={(v) => void pick(v)} style={{ flex: 1 }} />
          <Button variant="light" onClick={suggest} loading={busy}>Sugerir</Button>
        </Group>
        {attrs.length > 0 && (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {attrs.map((a) => a.values.length
              ? <Select key={a.id} label={a.name} data={a.values} searchable value={values[a.id] ?? null} onChange={(v) => setValues({ ...values, [a.id]: v ?? '' })} />
              : <TextInput key={a.id} label={a.name} value={values[a.id] ?? ''} onChange={(e) => setValues({ ...values, [a.id]: e.currentTarget.value })} />)}
          </SimpleGrid>
        )}
        <Select label="Tipo de anúncio" data={[{ value: 'gold_special', label: 'Clássico' }, { value: 'gold_pro', label: 'Premium' }]} value={listingType} onChange={(v) => setListingType(v ?? 'gold_special')} allowDeselect={false} />
        <Text size="xs" c="dimmed">Vão junto: preço (tabela da integração ou preço de venda), estoque da filial, fotos do produto, código de barras (GTIN) e o SKU.</Text>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancelar</Button><Button onClick={publish} loading={busy} disabled={!categoryId || !title.trim()}>Publicar</Button></Group>
      </Stack>
    </Modal>
  )
}
