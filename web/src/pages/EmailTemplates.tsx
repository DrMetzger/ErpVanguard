import { Alert, Badge, Button, Card, CopyButton, Group, Loader, SegmentedControl, SimpleGrid, Stack, Switch, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconInfoCircle, IconSettings } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading } from '../components/ui'
import { api } from '../lib/api'
import { date } from '../lib/format'
import { useAction, useApi } from '../lib/hooks'

interface Template { key: string; name: string; subject: string; header: string; body: string; signature: string; footer: string; showLogo: boolean; updatedAt: string }
interface Data { templates: Template[]; variables: { name: string; label: string }[] }
type Form = Pick<Template, 'subject' | 'header' | 'body' | 'signature' | 'footer' | 'showLogo'>
const pick = (t: Template): Form => ({ subject: t.subject, header: t.header, body: t.body, signature: t.signature, footer: t.footer, showLogo: t.showLogo })

// Modelos dos e-mails enviados ao cliente (orçamento, pedido). Só administradores.
export default function EmailTemplates() {
  const { data, setData } = useApi<Data>('/email-templates')
  const [key, setKey] = useState('quote')
  const [form, setForm] = useState<Form | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const { busy, run } = useAction()
  const current = data?.templates.find((t) => t.key === key)

  useEffect(() => { if (current) setForm(pick(current)) }, [current])

  // Prévia ao vivo: o servidor monta o e-mail com dados de exemplo.
  const [draft] = useDebouncedValue(form, 350)
  useEffect(() => {
    if (!draft || !draft.subject.trim() || !draft.body.trim()) return
    let alive = true
    setPreviewing(true)
    api<{ subject: string; html: string }>(`/email-templates/${key}/preview`, { method: 'POST', body: draft })
      .then((p) => alive && setPreview(p)).catch(() => undefined).finally(() => alive && setPreviewing(false))
    return () => { alive = false }
  }, [draft, key])

  if (!data || !form || !current) return <Loading />
  const dirty = JSON.stringify(form) !== JSON.stringify(pick(current))
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch })
  const save = () => run(async () => {
    const saved = await api<Template>(`/email-templates/${key}`, { method: 'PUT', body: form })
    setData({ ...data, templates: data.templates.map((t) => (t.key === key ? saved : t)) })
  }, 'Modelo salvo')

  return (
    <>
      <Group justify="space-between" mb="lg" align="flex-end">
        <div>
          <Title order={2}>Modelos de e-mail</Title>
          <Text c="dimmed">Texto dos e-mails enviados ao cliente. O servidor de envio (SMTP) fica em Configurações.</Text>
        </div>
        <Group>
          <Button component={Link} to="/configuracoes" variant="subtle" leftSection={<IconSettings size={16} />}>Servidor de e-mail</Button>
          <Button onClick={save} loading={busy} disabled={!dirty || !form.subject.trim() || !form.body.trim()}>Salvar modelo</Button>
        </Group>
      </Group>

      <SegmentedControl mb="md" value={key} onChange={(v) => { if (!dirty || confirm('Descartar as alterações deste modelo?')) { setKey(v); setPreview(null) } }}
        data={data.templates.map((t) => ({ value: t.key, label: t.name }))} />

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Stack>
          <Card>
            <Stack>
              <TextInput label="Assunto" value={form.subject} onChange={(e) => set({ subject: e.currentTarget.value })} required maxLength={200} />
              <Textarea label="Cabeçalho" description="Aparece no topo, ao lado do logo" value={form.header} onChange={(e) => set({ header: e.currentTarget.value })} autosize minRows={1} maxLength={2000} />
              <Textarea label="Corpo" description="{{itens}} é onde entra a tabela de itens e totais; sem ela, a tabela vai no fim" value={form.body} onChange={(e) => set({ body: e.currentTarget.value })} autosize minRows={6} maxLength={10000} required />
              <Textarea label="Assinatura" value={form.signature} onChange={(e) => set({ signature: e.currentTarget.value })} autosize minRows={2} maxLength={2000} />
              <Textarea label="Rodapé" description="Letra pequena, no fim do e-mail" value={form.footer} onChange={(e) => set({ footer: e.currentTarget.value })} autosize minRows={1} maxLength={2000} />
              <Switch label="Mostrar o logo da empresa" description="O logo de cada empresa/filial fica em Administração › Empresas" checked={form.showLogo} onChange={(e) => set({ showLogo: e.currentTarget.checked })} />
              <Text size="xs" c="dimmed">Atualizado em {date(current.updatedAt)}</Text>
            </Stack>
          </Card>
          <Card>
            <Text fw={700} mb={4}>Variáveis</Text>
            <Text size="xs" c="dimmed" mb="sm">Clique para copiar. Os dados do cliente são sempre tratados como texto (sem HTML).</Text>
            <Group gap={6}>
              {data.variables.map((v) => (
                <CopyButton key={v.name} value={`{{${v.name}}}`}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? 'Copiado' : v.label}>
                      <Badge variant={copied ? 'filled' : 'light'} style={{ cursor: 'pointer', textTransform: 'none' }} onClick={copy} ff="monospace">{`{{${v.name}}}`}</Badge>
                    </Tooltip>
                  )}
                </CopyButton>
              ))}
            </Group>
            <Alert mt="md" variant="light" icon={<IconInfoCircle size={18} />} p="xs">
              <Text size="xs">Formatação permitida: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;small&gt;, &lt;h2&gt;, &lt;p&gt;, &lt;hr&gt;. Quebras de linha são mantidas.</Text>
            </Alert>
          </Card>
        </Stack>

        <Card p={0} style={{ overflow: 'hidden' }}>
          <Group justify="space-between" p="md" pb="xs">
            <div>
              <Text size="xs" c="dimmed">Prévia com dados de exemplo</Text>
              <Text fw={600} size="sm">{preview?.subject ?? '…'}</Text>
            </div>
            {previewing && <Loader size="xs" />}
          </Group>
          {preview && <iframe title="Prévia do e-mail" srcDoc={preview.html} sandbox="" style={{ width: '100%', height: 720, border: 0, display: 'block' }} />}
        </Card>
      </SimpleGrid>
    </>
  )
}
