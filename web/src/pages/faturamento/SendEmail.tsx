import { Alert, Anchor, Button, Card, Group, Loader, Modal, Stack, TagsInput, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconCircleCheck, IconMail, IconSend } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { useAction } from '../../lib/hooks'
import type { DocEmail } from './types'

interface Draft { to: string[]; subject: string; message: string; template: string; smtpConfigured: boolean }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const when = (v: string) => new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

// Modal "Enviar por e-mail": destinatário do cadastro, cópia, assunto e mensagem do modelo (editáveis).
export function SendEmailModal({ opened, onClose, api: base, id, code, onSent }: { opened: boolean; onClose: () => void; api: string; id: string; code: string; onSent: (h: DocEmail[]) => void }) {
  const user = useUser()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [to, setTo] = useState<string[]>([])
  const [cc, setCc] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const { busy, run } = useAction()

  useEffect(() => {
    if (!opened) return
    setDraft(null); setError('')
    api<Draft>(`${base}/${id}/email`).then((d) => { setDraft(d); setTo(d.to); setCc([]); setSubject(d.subject); setMessage(d.message) }).catch((e) => setError(e.message))
  }, [opened, base, id])

  const invalid = [...to, ...cc].filter((e) => !EMAIL.test(e))
  const send = () => run(async () => {
    try {
      const r = await api<{ history: DocEmail[] }>(`${base}/${id}/email`, { method: 'POST', body: { to, cc, subject, message } })
      onSent(r.history)
      onClose()
    } catch (err) {
      // A falha também fica no histórico: atualiza a lista.
      api<{ history: DocEmail[] }>(`${base}/${id}/email`).then((d) => onSent(d.history)).catch(() => undefined)
      throw err
    }
  }, `${code} enviado por e-mail`)

  return (
    <Modal opened={opened} onClose={onClose} title={`Enviar ${code} por e-mail`} size="lg">
      {error && <Alert color="red">{error}</Alert>}
      {!draft && !error && <Group justify="center" p="lg"><Loader size="sm" /></Group>}
      {draft && !draft.smtpConfigured && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="E-mail ainda não configurado">
          O servidor de envio (SMTP) precisa ser preenchido em Administração › Configurações.{' '}
          {user.role === 'admin' ? <Anchor component={Link} to="/configuracoes">Abrir Configurações</Anchor> : 'Peça a um administrador.'}
        </Alert>
      )}
      {draft && draft.smtpConfigured && (
        <Stack>
          <TagsInput label="Para" description={draft.to.length ? 'E-mail do cadastro do cliente (pode mudar)' : 'O cliente não tem e-mail no cadastro: digite e tecle Enter'} value={to} onChange={setTo} splitChars={[',', ';', ' ']} required data-autofocus
            error={to.some((e) => !EMAIL.test(e)) ? 'E-mail inválido' : undefined} />
          <TagsInput label="Cópia (CC)" value={cc} onChange={setCc} splitChars={[',', ';', ' ']} error={cc.some((e) => !EMAIL.test(e)) ? 'E-mail inválido' : undefined} />
          <TextInput label="Assunto" value={subject} onChange={(e) => setSubject(e.currentTarget.value)} maxLength={250} />
          <Textarea label="Mensagem" description={`Modelo "${draft.template}". {{itens}} vira a tabela de itens e totais; o logo, a assinatura e o rodapé entram automaticamente.`}
            value={message} onChange={(e) => setMessage(e.currentTarget.value)} autosize minRows={6} maxRows={16} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button leftSection={<IconSend size={16} />} loading={busy} disabled={!to.length || invalid.length > 0 || !subject.trim()} onClick={send}>Enviar</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

// Histórico "Enviado por e-mail em ..." no documento.
export function EmailHistory({ emails }: { emails: DocEmail[] }) {
  if (!emails.length) return null
  return (
    <Card mt="md">
      <Group gap="xs" mb="xs"><IconMail size={18} /><Text fw={700}>Envios por e-mail</Text></Group>
      <Stack gap={6}>
        {emails.map((e) => (
          <Group key={e.id} gap="xs" wrap="nowrap" align="flex-start">
            {e.status === 'enviado' ? <IconCircleCheck size={16} color="var(--mantine-color-teal-6)" style={{ marginTop: 2, flex: 'none' }} /> : <IconAlertTriangle size={16} color="var(--mantine-color-red-6)" style={{ marginTop: 2, flex: 'none' }} />}
            <Text size="sm">
              {e.status === 'enviado' ? 'Enviado por e-mail' : 'Falha ao enviar'} em {when(e.sentAt)} para <b>{e.to}</b>{e.cc && <> (cópia: {e.cc})</>} por {e.userName}
              {e.error && <Tooltip label={e.error} multiline w={360}><Text span c="red" size="xs"> · {e.error.length > 80 ? `${e.error.slice(0, 80)}…` : e.error}</Text></Tooltip>}
            </Text>
          </Group>
        ))}
      </Stack>
    </Card>
  )
}
