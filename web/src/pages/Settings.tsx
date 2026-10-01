import { Alert, Badge, Button, Card, Group, PasswordInput, Select, SimpleGrid, Stack, Switch, TagsInput, Text, TextInput, ThemeIcon, Title } from '@mantine/core'
import { IconBrain, IconBuilding, IconShieldCheck, IconCircleCheck, IconFileCode, IconKey, IconLock, IconMail, IconPlugConnected, IconSend } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading } from '../components/ui'
import { api } from '../lib/api'
import { useAction, useApi } from '../lib/hooks'

interface SettingsData {
  gemini: { configured: boolean; source: 'tela' | 'servidor' | 'nenhuma'; apiKeyHint: string | null; model: string; fallbackModels: string[] }
  nfe: { autoAi: boolean }
  security: { twoFactor: boolean }
  company: { name: string; cnpj: string; uf: string }
  serasa: { enabled: boolean; environment: 'homologacao' | 'producao'; clientId: string | null; secretHint: string | null }
  smtp: {
    configured: boolean; source: 'tela' | 'servidor' | 'nenhuma'; host: string | null; port: number; security: 'ssl' | 'starttls' | 'nenhuma'
    user: string | null; passwordHint: string | null; fromName: string | null; fromEmail: string | null; replyTo: string | null
  }
}
const SOURCE = { tela: 'Configurada nesta tela', servidor: 'Configurada no servidor (GitHub)', nenhuma: 'Não configurada' }

function Section({ icon: Icon, title, description, children }: { icon: typeof IconKey; title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <Group mb="md" align="flex-start" wrap="nowrap">
        <ThemeIcon variant="light" size={40} radius="md"><Icon size={22} /></ThemeIcon>
        <div><Title order={4}>{title}</Title><Text size="sm" c="dimmed">{description}</Text></div>
      </Group>
      {children}
    </Card>
  )
}

export default function Settings() {
  const { data, setData } = useApi<SettingsData>('/settings')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [fallbacks, setFallbacks] = useState<string[]>([])
  const [test, setTest] = useState<{ ok: boolean; model: string | null; seconds: number; answer: string | null } | null>(null)
  const { busy, run } = useAction()

  useEffect(() => {
    if (!data) return
    setModel(data.gemini.model)
    setFallbacks(data.gemini.fallbackModels)
  }, [data])

  if (!data) return <Loading />
  const put = (path: string, body: unknown, msg: string) => run(async () => setData(await api<SettingsData>(`/settings/${path}`, { method: 'PUT', body })), msg)

  return (
    <>
      <Title order={2} mb={4}>Configurações</Title>
      <Text c="dimmed" mb="lg">Só administradores veem esta tela.</Text>
      <Stack gap="lg" maw={900}>
        <Section icon={IconBuilding} title="Empresas, filiais, logo e certificado A1" description="Ficam em Administração › Empresas: dados de cada filial (a UF define CFOP 5xxx ou 6xxx), logo do DANFE e dos relatórios e o certificado digital.">
          <Group justify="flex-end"><Button component={Link} to="/empresas" variant="light">Abrir Administração › Empresas</Button></Group>
        </Section>

        <Section icon={IconLock} title="Login em duas etapas (código por e-mail)" description="Depois da senha, o usuário recebe um código de 6 números por e-mail para entrar. Protege a empresa mesmo se alguém descobrir uma senha.">
          <Stack>
            <Switch
              checked={data.security.twoFactor}
              onChange={(e) => {
                const on = e.currentTarget.checked
                if (!on && !confirm('Desligar o código por e-mail no login de TODOS os usuários? Quem souber uma senha passa a entrar direto.')) return
                void put('security', { twoFactor: on }, on ? 'Login em duas etapas ligado' : 'Login em duas etapas desligado')
              }}
              label="Exigir o código por e-mail no login"
              description={data.security.twoFactor ? 'Ligado (recomendado): todos os usuários, no navegador e no app.' : 'Desligado: entra só com e-mail e senha.'}
              color="teal"
            />
            {!data.security.twoFactor && <Alert color="red" title="Login em duas etapas desligado">Recomendamos deixar ligado.</Alert>}
            {data.security.twoFactor && !data.smtp.configured && <Alert color="yellow" title="Configure o e-mail abaixo">Sem o servidor de e-mail ninguém recebe o código.</Alert>}
            <Text size="sm" c="dimmed">O e-mail que recebe o código de cada usuário é definido em Administração › Usuários (campo "E-mail para o código"). Em branco, vai para o e-mail de login.</Text>
          </Stack>
        </Section>

        <SmtpSection data={data.smtp} onSaved={setData} />

        <SerasaSection data={data.serasa} onSaved={setData} />

        <Section icon={IconBrain} title="Inteligência artificial (Gemini)" description="Usada para amarrar itens de notas fiscais aos seus produtos. A chave fica criptografada e nunca é mostrada inteira.">
          <Group mb="md" gap="xs">
            <Badge color={data.gemini.configured ? 'teal' : 'gray'} variant="light" leftSection={<IconKey size={12} />} style={{ textTransform: 'none' }}>
              {SOURCE[data.gemini.source]}{data.gemini.apiKeyHint && ` · ${data.gemini.apiKeyHint}`}
            </Badge>
          </Group>
          <Stack>
            <PasswordInput label="Nova chave da API" description="Crie em aistudio.google.com/apikey. Deixe vazio para manter a atual." placeholder="AIza…" value={apiKey} onChange={(e) => setApiKey(e.currentTarget.value)} autoComplete="off" />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Modelo principal" value={model} onChange={(e) => setModel(e.currentTarget.value)} />
              <TagsInput label="Modelos reserva (em ordem)" description="Usados quando o principal está lotado" value={fallbacks} onChange={setFallbacks} />
            </SimpleGrid>
            <Group justify="space-between">
              <Group>
                <Button variant="light" leftSection={<IconPlugConnected size={16} />} disabled={!data.gemini.configured} loading={busy}
                  onClick={() => run(async () => { setTest(null); setTest(await api('/settings/gemini/test', { method: 'POST' })) })}>Testar conexão</Button>
                {data.gemini.source === 'tela' && (
                  <Button variant="subtle" color="red" onClick={() => confirm('Remover a chave salva nesta tela?') && put('gemini', { clearApiKey: true }, 'Chave removida')}>Remover chave</Button>
                )}
              </Group>
              <Button loading={busy} onClick={() => put('gemini', { ...(apiKey ? { apiKey } : {}), model, fallbackModels: fallbacks }, 'Configuração da IA salva').then(() => setApiKey(''))}>Salvar IA</Button>
            </Group>
            {test && (
              <Alert color={test.ok ? 'teal' : 'yellow'} icon={<IconCircleCheck />} title={test.ok ? 'A IA respondeu certo' : 'A IA respondeu, mas diferente do esperado'}>
                Modelo usado: <b>{test.model}</b> · {test.seconds}s{test.answer && <Text size="sm" mt={4}>"{test.answer}"</Text>}
              </Alert>
            )}
          </Stack>
        </Section>

        <Section icon={IconFileCode} title="Notas fiscais (XML)" description="A leitura do XML é sempre exata, feita pelo próprio sistema. A IA só entra para amarrar itens que o sistema não reconheceu.">
          <Switch
            checked={data.nfe.autoAi}
            onChange={(e) => put('nfe', { autoAi: e.currentTarget.checked }, e.currentTarget.checked ? 'IA automática ligada' : 'IA automática desligada')}
            label="Usar a IA automaticamente ao importar o XML"
            description={data.nfe.autoAi ? 'Os itens não reconhecidos já chegam com a sugestão da IA.' : 'Desligado: o comprador clica em "Amarrar com IA" quando quiser.'}
            disabled={!data.gemini.configured}
          />
        </Section>
      </Stack>
    </>
  )
}

// Servidor de e-mail (SMTP) para enviar orçamentos e pedidos. A senha fica criptografada e não volta para a tela.
const SECURITY = [
  { value: 'ssl', label: 'SSL/TLS (porta 465)' },
  { value: 'starttls', label: 'STARTTLS (porta 587)' },
  { value: 'nenhuma', label: 'Sem criptografia (rede interna)' },
]
function SmtpSection({ data, onSaved }: { data: SettingsData['smtp']; onSaved: (d: SettingsData) => void }) {
  const initial = () => ({ host: data.host ?? '', port: data.port || 587, security: data.security, user: data.user ?? '', password: '', fromName: data.fromName ?? '', fromEmail: data.fromEmail ?? '', replyTo: data.replyTo ?? '' })
  const [form, setForm] = useState(initial)
  const [testTo, setTestTo] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const { busy, run } = useAction()
  const set = (patch: Partial<ReturnType<typeof initial>>) => setForm({ ...form, ...patch })
  const save = () => run(async () => {
    const { password, ...rest } = form
    onSaved(await api<SettingsData>('/settings/smtp', { method: 'PUT', body: { ...rest, port: Number(form.port), ...(password ? { password } : {}) } }))
    setForm((f) => ({ ...f, password: '' }))
  }, 'Servidor de e-mail salvo')
  const test = () => run(async () => {
    setSent(null)
    const r = await api<{ to: string }>('/settings/smtp/test', { method: 'POST', body: testTo ? { to: testTo } : {} })
    setSent(r.to)
  })
  return (
    <Section icon={IconMail} title="E-mail (servidor SMTP)" description="Usado para enviar orçamentos e pedidos ao cliente. O texto dos e-mails fica em Administração › Modelos de e-mail.">
      <Group mb="md" gap="xs">
        <Badge color={data.configured ? 'teal' : 'gray'} variant="light" style={{ textTransform: 'none' }}>{SOURCE[data.source]}{data.configured && data.host && ` · ${data.host}:${data.port}`}</Badge>
        {data.passwordHint && <Badge variant="light" color="gray" leftSection={<IconKey size={12} />} style={{ textTransform: 'none' }}>Senha salva {data.passwordHint}</Badge>}
      </Group>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label="Servidor (host)" placeholder="smtp.seudominio.com.br" value={form.host} onChange={(e) => set({ host: e.currentTarget.value.trim() })} autoComplete="off" />
          <TextInput label="Porta" type="number" value={String(form.port)} onChange={(e) => set({ port: Number(e.currentTarget.value) })} />
          <Select label="Segurança" data={SECURITY} value={form.security} allowDeselect={false}
            onChange={(v) => set({ security: (v ?? 'starttls') as 'ssl', port: v === 'ssl' ? 465 : v === 'starttls' && form.port === 465 ? 587 : form.port })} />
          <TextInput label="Usuário" placeholder="Em branco se o servidor não pede login" value={form.user} onChange={(e) => set({ user: e.currentTarget.value })} autoComplete="off" />
          <PasswordInput label="Senha" placeholder={data.passwordHint ? 'Deixe vazio para manter' : ''} value={form.password} onChange={(e) => set({ password: e.currentTarget.value })} autoComplete="new-password" />
          <div />
          <TextInput label="Nome do remetente" placeholder="Vendas Empresa" value={form.fromName} onChange={(e) => set({ fromName: e.currentTarget.value })} />
          <TextInput label="E-mail do remetente" placeholder="vendas@seudominio.com.br" value={form.fromEmail} onChange={(e) => set({ fromEmail: e.currentTarget.value.trim() })} />
          <TextInput label="Responder para (opcional)" placeholder="comercial@seudominio.com.br" value={form.replyTo} onChange={(e) => set({ replyTo: e.currentTarget.value.trim() })} />
        </SimpleGrid>
        <Group justify="space-between" align="flex-end">
          <Group align="flex-end" gap="xs">
            <TextInput label="Enviar teste para" placeholder="Seu e-mail" value={testTo} onChange={(e) => setTestTo(e.currentTarget.value.trim())} w={240} />
            <Button variant="light" leftSection={<IconSend size={16} />} disabled={!data.configured} loading={busy} onClick={test}>Enviar e-mail de teste</Button>
            {data.source === 'tela' && data.passwordHint && (
              <Button variant="subtle" color="red" onClick={() => confirm('Remover a senha salva?') && run(async () => onSaved(await api<SettingsData>('/settings/smtp', { method: 'PUT', body: { ...form, password: undefined, port: Number(form.port), clearPassword: true } })), 'Senha removida')}>Remover senha</Button>
            )}
          </Group>
          <Button onClick={save} loading={busy} disabled={!form.host || !form.fromEmail}>Salvar e-mail</Button>
        </Group>
        {sent && <Alert color="teal" icon={<IconCircleCheck />} title="E-mail de teste enviado">O servidor aceitou a mensagem para <b>{sent}</b>. Confira a caixa de entrada (e o spam).</Alert>}
        {data.source === 'servidor' && <Text size="xs" c="dimmed">Hoje vale a configuração do servidor (variáveis SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM). Salvar aqui passa a valer a desta tela.</Text>}
      </Stack>
    </Section>
  )
}

// Serasa Experian: API paga (contrato). Fica desligada até informar as chaves.
function SerasaSection({ data, onSaved }: { data: SettingsData['serasa']; onSaved: (d: SettingsData) => void }) {
  const [form, setForm] = useState({ enabled: data.enabled, environment: data.environment, clientId: data.clientId ?? '', clientSecret: '' })
  const { busy, run } = useAction()
  const save = () => run(async () => {
    onSaved(await api<SettingsData>('/settings/serasa', { method: 'PUT', body: { enabled: form.enabled, environment: form.environment, clientId: form.clientId, ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}) } }))
    setForm((f) => ({ ...f, clientSecret: '' }))
  }, 'Serasa salvo')
  return (
    <Section icon={IconShieldCheck} title="Consulta de crédito (Serasa Experian)" description="A API da Serasa é paga e depende de contrato. Deixe as chaves aqui; a consulta aparece no cadastro de clientes.">
      <Group mb="md" gap="xs">
        <Badge color={data.enabled ? 'teal' : 'gray'} variant="light" style={{ textTransform: 'none' }}>{data.enabled ? `Ativa (${data.environment})` : 'Em espera'}</Badge>
        {data.secretHint && <Badge variant="light" color="gray" leftSection={<IconKey size={12} />} style={{ textTransform: 'none' }}>Secret {data.secretHint}</Badge>}
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <TextInput label="Client ID" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.currentTarget.value })} autoComplete="off" />
        <PasswordInput label="Client secret" placeholder={data.secretHint ? 'Deixe vazio para manter' : ''} value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.currentTarget.value })} autoComplete="off" />
        <Select label="Ambiente" data={[{ value: 'homologacao', label: 'Homologação (testes)' }, { value: 'producao', label: 'Produção' }]} value={form.environment} onChange={(v) => setForm({ ...form, environment: (v ?? 'homologacao') as 'homologacao' })} allowDeselect={false} />
      </SimpleGrid>
      <Group justify="space-between" mt="md">
        <Switch label="Ativar consulta" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.currentTarget.checked })} />
        <Button onClick={save} loading={busy}>Salvar Serasa</Button>
      </Group>
    </Section>
  )
}
