import { Accordion, Alert, Badge, Button, Card, CopyButton, Group, List, PasswordInput, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core'
import { IconBrandWhatsapp, IconBuildingStore, IconCheck, IconCopy, IconPlugConnected, IconShoppingBag, IconShoppingCart } from '@tabler/icons-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Loading } from '../components/ui'
import { api, API_URL } from '../lib/api'
import { useAction, useApi } from '../lib/hooks'
import { showPhone } from './faturamento/SendWhatsApp'

interface Integration {
  provider: string; label: string; ready: boolean; enabled: boolean; status: string; lastError: string | null; checkedAt: string | null
  config: Record<string, string>; secrets: Record<string, { set: boolean; end: string | null }>
}
interface Log { id: string; provider: string; direction: 'in' | 'out'; kind: string; status: string; target: string | null; summary: string | null; error: string | null; createdAt: string; userName: string | null }

const ICON: Record<string, ReactNode> = { whatsapp: <IconBrandWhatsapp size={22} />, mercadolivre: <IconShoppingCart size={22} />, shopee: <IconShoppingBag size={22} />, magalu: <IconBuildingStore size={22} /> }
const STATUS: Record<string, string> = { conectado: 'teal', erro: 'red', desconectado: 'gray', desativado: 'gray' }
const when = (v: string) => new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const origin = () => (API_URL || window.location.origin).replace(/\/$/, '')
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('')

// Administração › Integrações: WhatsApp agora; Mercado Livre, Shopee e Magalu na sequência.
export default function Integrations() {
  const { data, loading, reload } = useApi<Integration[]>('/integrations')
  const logs = useApi<Log[]>('/integrations/logs')
  if (loading || !data) return <Loading />
  const wa = data.find((i) => i.provider === 'whatsapp')!
  return (
    <Stack>
      <div>
        <Title order={2}>Integrações</Title>
        <Text size="sm" c="dimmed">Conexões do ERP com WhatsApp e marketplaces. As chaves ficam criptografadas no servidor e nunca aparecem de novo na tela.</Text>
      </div>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        {data.map((i) => (
          <Card key={i.provider} withBorder p="md">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">{ICON[i.provider]}<Text fw={700}>{i.label}</Text></Group>
              {i.ready ? <Badge variant="light" color={STATUS[i.status] ?? 'gray'}>{i.status}</Badge> : <Badge variant="light" color="yellow">em construção</Badge>}
            </Group>
            <Text size="xs" c="dimmed" mt={6}>
              {i.provider === 'whatsapp' ? 'Orçamento, pedido e DANFE para o celular do cliente, com aviso de entregue e lido.'
                : 'Produtos, preço e estoque da filial no marketplace; vendas entrando como pedido.'}
            </Text>
          </Card>
        ))}
      </SimpleGrid>
      <WhatsAppCard it={wa} onSaved={() => { reload(); logs.reload() }} />
      <Card withBorder>
        <Group justify="space-between" mb="xs"><Text fw={700}>Histórico</Text><Button size="xs" variant="subtle" onClick={logs.reload}>Atualizar</Button></Group>
        {!logs.data?.length ? <Text size="sm" c="dimmed">Nada enviado ou recebido ainda.</Text> : (
          <Table.ScrollContainer minWidth={640}>
            <Table striped>
              <Table.Thead><Table.Tr><Table.Th>Quando</Table.Th><Table.Th>Integração</Table.Th><Table.Th>O quê</Table.Th><Table.Th>Contato</Table.Th><Table.Th>Situação</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {logs.data.map((l) => (
                  <Table.Tr key={l.id}>
                    <Table.Td><Text size="sm">{when(l.createdAt)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{l.provider}{l.direction === 'in' ? ' (recebido)' : ''}</Text></Table.Td>
                    <Table.Td><Text size="sm" lineClamp={2}>{l.summary}</Text>{l.userName && <Text size="xs" c="dimmed">{l.userName}</Text>}</Table.Td>
                    <Table.Td><Text size="sm">{showPhone(l.target)}</Text></Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={l.status === 'erro' ? 'red' : l.status === 'lido' ? 'green' : l.status === 'entregue' ? 'teal' : 'blue'}>{l.status}</Badge>{l.error && <Text size="xs" c="red">{l.error}</Text>}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
    </Stack>
  )
}

function Secret({ label, value, onChange, it, k, description }: { label: string; value: string; onChange: (v: string) => void; it: Integration; k: string; description?: string }) {
  const s = it.secrets[k]
  return <PasswordInput label={label} description={description} value={value} onChange={(e) => onChange(e.currentTarget.value)} autoComplete="new-password"
    placeholder={s?.set ? `preenchido (termina em ${s.end ?? '••••'}) — deixe vazio para manter` : 'cole aqui'} />
}

function WhatsAppCard({ it, onSaved }: { it: Integration; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(it.enabled)
  const [cfg, setCfg] = useState<Record<string, string>>({ ...it.config })
  const [sec, setSec] = useState<Record<string, string>>({ accessToken: '', appSecret: '', verifyToken: '' })
  const [testTo, setTestTo] = useState(it.config.testNumber ?? '')
  const [result, setResult] = useState<string | null>(null)
  const { busy, run } = useAction()
  useEffect(() => { setEnabled(it.enabled); setCfg({ ...it.config }) }, [it])
  const set = (k: string) => (v: string) => setCfg((c) => ({ ...c, [k]: v }))
  const webhook = `${origin()}/api/webhooks/whatsapp`
  const save = () => run(async () => {
    const secrets = Object.fromEntries(Object.entries(sec).filter(([, v]) => v.trim()))
    await api('/integrations/whatsapp', { method: 'PUT', body: { enabled, config: { ...cfg, testNumber: testTo }, secrets } })
    setSec({ accessToken: '', appSecret: '', verifyToken: '' })
    onSaved()
  }, 'WhatsApp salvo')
  const test = (to?: string) => run(async () => {
    const r = await api<{ number: string; name: string; quality: string | null; sent: string | null }>('/integrations/whatsapp/test', { method: 'POST', body: to ? { to: to.replace(/\D/g, '') } : {} })
    setResult(`Conectado: ${r.name ?? ''} ${r.number ?? ''}${r.quality ? ` · qualidade ${r.quality}` : ''}${r.sent ? ' · mensagem de teste enviada' : ''}`)
    onSaved()
  })

  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Group gap="xs"><IconBrandWhatsapp size={22} color="var(--mantine-color-green-6)" /><Text fw={700}>WhatsApp (Meta Cloud API)</Text></Group>
        <Switch label="Ativo" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />
      </Group>
      {it.lastError && it.status === 'erro' && <Alert color="red" mb="sm">{it.lastError}</Alert>}
      {result && <Alert color="teal" mb="sm" icon={<IconCheck size={18} />}>{result}</Alert>}
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label="ID do número de telefone" description="Phone number ID (WhatsApp › Configuração da API)" value={cfg.phoneNumberId ?? ''} onChange={(e) => set('phoneNumberId')(e.currentTarget.value.trim())} />
        <TextInput label="ID da conta do WhatsApp Business" description="WhatsApp Business Account ID" value={cfg.businessAccountId ?? ''} onChange={(e) => set('businessAccountId')(e.currentTarget.value.trim())} />
        <Secret label="Token de acesso permanente" description="Usuário do sistema no Business Manager, com whatsapp_business_messaging" it={it} k="accessToken" value={sec.accessToken!} onChange={(v) => setSec({ ...sec, accessToken: v })} />
        <Secret label="Chave secreta do app (App Secret)" description="Configurações do app › Básico; confere os avisos da Meta" it={it} k="appSecret" value={sec.appSecret!} onChange={(v) => setSec({ ...sec, appSecret: v })} />
        <TextInput label="Modelo de mensagem aprovado" description="Nome do modelo com documento no cabeçalho e {{1}} no texto (vazio = só conversa aberta)" value={cfg.templateName ?? ''} onChange={(e) => set('templateName')(e.currentTarget.value.trim())} placeholder="documento_erp" />
        <TextInput label="Idioma do modelo" value={cfg.templateLanguage ?? ''} onChange={(e) => set('templateLanguage')(e.currentTarget.value.trim())} placeholder="pt_BR" />
        <TextInput label="Versão da API" value={cfg.apiVersion ?? ''} onChange={(e) => set('apiVersion')(e.currentTarget.value.trim())} placeholder="v23.0" />
        <div>
          <Secret label="Token de verificação do webhook" description="Você inventa; o mesmo vai no app da Meta" it={it} k="verifyToken" value={sec.verifyToken!} onChange={(v) => setSec({ ...sec, verifyToken: v })} />
          <Button size="compact-xs" variant="subtle" mt={4} onClick={() => setSec({ ...sec, verifyToken: randomToken() })}>Gerar um</Button>
        </div>
      </SimpleGrid>
      <Group mt="sm" gap="xs" align="flex-end">
        <TextInput label="URL do webhook (cole no app da Meta)" value={webhook} readOnly style={{ flex: 1, minWidth: 220 }} />
        <CopyButton value={webhook}>{({ copied, copy }) => <Button variant="default" leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />} onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</Button>}</CopyButton>
      </Group>
      <Group mt="md" justify="space-between" align="flex-end">
        <Group gap="xs" align="flex-end">
          <TextInput label="Celular para teste" placeholder="(17) 99999-0000" value={testTo} onChange={(e) => setTestTo(e.currentTarget.value)} inputMode="tel" w={200} />
          <Button variant="light" leftSection={<IconPlugConnected size={16} />} loading={busy} onClick={() => test()}>Testar conexão</Button>
          <Button variant="light" color="green" loading={busy} disabled={testTo.replace(/\D/g, '').length < 10} onClick={() => test(testTo)}>Enviar teste</Button>
        </Group>
        <Button onClick={save} loading={busy}>Salvar</Button>
      </Group>
      <Accordion mt="md" variant="contained">
        <Accordion.Item value="passo">
          <Accordion.Control>Passo a passo na Meta (uma vez só)</Accordion.Control>
          <Accordion.Panel>
            <List type="ordered" size="sm" spacing={6}>
              <List.Item>Em <b>business.facebook.com</b>, tenha a conta da empresa verificada.</List.Item>
              <List.Item>Em <b>developers.facebook.com</b> › Meus apps › Criar app › tipo <b>Empresa</b> › adicione o produto <b>WhatsApp</b>.</List.Item>
              <List.Item>Em WhatsApp › Configuração da API: adicione o <b>número da empresa</b> (um número que não esteja em uso no WhatsApp do celular) e copie o <b>ID do número</b> e o <b>ID da conta</b>.</List.Item>
              <List.Item>No Business Manager › Usuários do sistema: crie um usuário <b>administrador</b>, dê acesso ao app e à conta do WhatsApp e gere um <b>token permanente</b> com <i>whatsapp_business_messaging</i> e <i>whatsapp_business_management</i>.</List.Item>
              <List.Item>No app › Configurações › Básico: copie a <b>Chave secreta do app</b>.</List.Item>
              <List.Item>WhatsApp › Configuração › Webhook: cole a <b>URL do webhook</b> acima e o <b>token de verificação</b>; assine o campo <b>messages</b>.</List.Item>
              <List.Item>Gerenciador do WhatsApp › Modelos de mensagem: crie <b>documento_erp</b>, categoria <b>Utilidade</b>, idioma <b>Português (BR)</b>, cabeçalho <b>Documento</b> e o texto: <i>"Olá! Segue {'{{1}}'}. Qualquer dúvida é só responder esta mensagem."</i>. A Meta costuma aprovar em minutos.</List.Item>
              <List.Item>Preencha os campos acima, salve, ative e clique em <b>Enviar teste</b> para o seu celular.</List.Item>
            </List>
            <Text size="xs" c="dimmed" mt="sm">A Meta cobra por conversa iniciada pela empresa (modelos de utilidade); respostas do cliente dentro de 24 horas não têm custo extra.</Text>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  )
}
