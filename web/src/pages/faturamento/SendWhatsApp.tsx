import { Alert, Anchor, Badge, Button, Group, Loader, Modal, Stack, Table, Text, Textarea, TextInput } from '@mantine/core'
import { IconAlertTriangle, IconBrandWhatsapp, IconSend } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { useAction } from '../../lib/hooks'

interface WaLog { id: string; status: string; target: string | null; error: string | null; createdAt: string; userName: string | null; kind: string }
interface Draft { to: string; message: string; configured: boolean; template: string | null; history: WaLog[] }
const when = (v: string) => new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const STATUS: Record<string, { color: string; label: string }> = {
  enviado: { color: 'blue', label: 'enviado' }, entregue: { color: 'teal', label: 'entregue' }, lido: { color: 'green', label: 'lido' }, erro: { color: 'red', label: 'erro' },
}
// 5517988887777 → +55 (17) 98888-7777
export const showPhone = (d: string | null) => {
  const m = String(d ?? '').match(/^55(\d{2})(\d{4,5})(\d{4})$/)
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : d ?? ''
}

// Botão + modal "Enviar pelo WhatsApp": PDF do documento (ou DANFE da NF) para o celular do cliente.
export function WhatsAppButton({ base, id, code, disabled, label = 'WhatsApp' }: { base: string; id: string; code: string; disabled?: boolean; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="light" color="green" leftSection={<IconBrandWhatsapp size={16} />} onClick={() => setOpen(true)} disabled={disabled}>{label}</Button>
      {open && <SendWhatsAppModal base={base} id={id} code={code} onClose={() => setOpen(false)} />}
    </>
  )
}

function SendWhatsAppModal({ base, id, code, onClose }: { base: string; id: string; code: string; onClose: () => void }) {
  const user = useUser()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [to, setTo] = useState('')
  const [message, setMessage] = useState('')
  const { busy, run } = useAction()
  const load = () => api<Draft>(`${base}/${id}/whatsapp`).then((d) => { setDraft(d); return d })

  useEffect(() => {
    load().then((d) => { setTo(d.to ? showPhone(d.to) : ''); setMessage(d.message) }).catch((e) => setError(e.message))
  }, [base, id])

  const digits = to.replace(/\D/g, '')
  const send = () => run(async () => {
    try {
      await api(`${base}/${id}/whatsapp`, { method: 'POST', body: { to: digits, message } })
      await load()
    } catch (err) {
      void load().catch(() => undefined) // a falha também entra no histórico
      throw err
    }
  }, `${code} enviado pelo WhatsApp`)

  return (
    <Modal opened onClose={onClose} title={`Enviar ${code} pelo WhatsApp`} size="lg">
      {error && <Alert color="red">{error}</Alert>}
      {!draft && !error && <Group justify="center" p="lg"><Loader size="sm" /></Group>}
      {draft && !draft.configured && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="WhatsApp ainda não configurado">
          Preencha o número e o token da Meta em Administração › Integrações.{' '}
          {user.role === 'admin' ? <Anchor component={Link} to="/integracoes">Abrir Integrações</Anchor> : 'Peça a um administrador.'}
        </Alert>
      )}
      {draft && draft.configured && (
        <Stack>
          <TextInput label="Celular do cliente" description={draft.to ? 'Do cadastro do cliente (pode mudar)' : 'O cliente não tem celular no cadastro: digite com DDD'} value={to}
            onChange={(e) => setTo(e.currentTarget.value)} inputMode="tel" placeholder="(17) 99999-0000" data-autofocus error={digits && digits.length < 10 ? 'Número incompleto' : undefined} />
          <Textarea label="Texto" description={draft.template ? `Vai no modelo aprovado "${draft.template}" com o PDF anexado. Este texto entra no lugar do {{1}} (sem quebra de linha).` : 'Vai como documento com este texto. Sem modelo aprovado, o cliente só recebe se falou com você nas últimas 24 horas.'}
            value={message} onChange={(e) => setMessage(e.currentTarget.value)} autosize minRows={2} maxRows={6} maxLength={900} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Fechar</Button>
            <Button color="green" leftSection={<IconSend size={16} />} loading={busy} disabled={digits.length < 10 || !message.trim()} onClick={send}>Enviar</Button>
          </Group>
          {draft.history.length > 0 && (
            <>
              <Text fw={600} size="sm">Envios</Text>
              <Table.ScrollContainer minWidth={420}>
                <Table striped>
                  <Table.Tbody>
                    {draft.history.map((h) => (
                      <Table.Tr key={h.id}>
                        <Table.Td><Text size="sm">{when(h.createdAt)}</Text></Table.Td>
                        <Table.Td><Text size="sm">{showPhone(h.target)}</Text></Table.Td>
                        <Table.Td><Badge size="sm" variant="light" color={STATUS[h.status]?.color ?? 'gray'}>{STATUS[h.status]?.label ?? h.status}</Badge>{h.error && <Text size="xs" c="red">{h.error}</Text>}</Table.Td>
                        <Table.Td><Text size="sm" c="dimmed">{h.userName}</Text></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </>
          )}
        </Stack>
      )}
    </Modal>
  )
}
