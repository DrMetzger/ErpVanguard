import { Alert, Badge, Button, Card, Group, PasswordInput, Select, SimpleGrid, Stack, Switch, TagsInput, Text, TextInput, ThemeIcon, Title } from '@mantine/core'
import { IconBrain, IconBuilding, IconCircleCheck, IconFileCode, IconKey, IconPlugConnected } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { Loading } from '../components/ui'
import { api } from '../lib/api'
import { cnpj } from '../lib/format'
import { useAction, useApi } from '../lib/hooks'

interface SettingsData {
  gemini: { configured: boolean; source: 'tela' | 'servidor' | 'nenhuma'; apiKeyHint: string | null; model: string; fallbackModels: string[] }
  nfe: { autoAi: boolean }
  company: { name: string; cnpj: string; uf: string }
}
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ')
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
  const [company, setCompany] = useState({ name: '', cnpj: '', uf: 'SP' })
  const [test, setTest] = useState<{ ok: boolean; model: string | null; seconds: number; answer: string | null } | null>(null)
  const { busy, run } = useAction()

  useEffect(() => {
    if (!data) return
    setModel(data.gemini.model)
    setFallbacks(data.gemini.fallbackModels)
    setCompany({ ...data.company, cnpj: cnpj(data.company.cnpj) })
  }, [data])

  if (!data) return <Loading />
  const put = (path: string, body: unknown, msg: string) => run(async () => setData(await api<SettingsData>(`/settings/${path}`, { method: 'PUT', body })), msg)

  return (
    <>
      <Title order={2} mb={4}>Configurações</Title>
      <Text c="dimmed" mb="lg">Só administradores veem esta tela.</Text>
      <Stack gap="lg" maw={900}>
        <Section icon={IconBuilding} title="Empresa" description="A UF da empresa define se a operação é dentro ou fora do estado (CFOP 5xxx ou 6xxx).">
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <TextInput label="Razão social" value={company.name} onChange={(e) => setCompany({ ...company, name: e.currentTarget.value })} />
            <TextInput label="CNPJ" value={company.cnpj} onChange={(e) => setCompany({ ...company, cnpj: e.currentTarget.value })} inputMode="numeric" />
            <Select label="UF" data={UFS} value={company.uf} onChange={(v) => setCompany({ ...company, uf: v ?? 'SP' })} searchable allowDeselect={false} />
          </SimpleGrid>
          <Group justify="flex-end" mt="md"><Button onClick={() => put('company', company, 'Dados da empresa salvos')} loading={busy}>Salvar empresa</Button></Group>
        </Section>

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
