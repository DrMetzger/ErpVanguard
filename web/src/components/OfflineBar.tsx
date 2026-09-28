import { ActionIcon, Alert, Anchor, Button, Group, Modal, Stack, Table, Text, Tooltip } from '@mantine/core'
import { IconCloudOff, IconCloudUpload, IconDownload, IconRefresh, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { cacheShownAt, discard, flushQueue, isOffline, queued, retry, type QueuedWrite } from '../lib/offline'
import { APK_URL } from './NativeServices'

const time = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

// Faixa no topo: sem internet, gravações esperando envio (com erro, se houver) e versão nova do app.
export function OfflineBar() {
  const [offline, setOffline] = useState(isOffline())
  const [cacheAt, setCacheAt] = useState(cacheShownAt())
  const [pending, setPending] = useState<QueuedWrite[]>([])
  const [open, setOpen] = useState(false)
  const [update, setUpdate] = useState<{ version: string } | null>(null)

  useEffect(() => {
    const sync = () => { setOffline(isOffline()); setCacheAt(cacheShownAt()); void queued().then(setPending) }
    sync()
    window.addEventListener('vanguard:offline-change', sync)
    const onUpdate = (e: Event) => setUpdate((e as CustomEvent).detail)
    window.addEventListener('vanguard:app-update', onUpdate)
    return () => { window.removeEventListener('vanguard:offline-change', sync); window.removeEventListener('vanguard:app-update', onUpdate) }
  }, [])

  const failed = pending.filter((p) => p.error)
  return (
    <>
      {update && (
        <Alert color="blue" variant="light" mb="sm" icon={<IconDownload size={18} />} title="Versão nova do app">
          <Group justify="space-between">
            <Text size="sm">Baixe e instale por cima (os dados continuam).</Text>
            <Button size="xs" component="a" href={APK_URL}>Baixar atualização</Button>
          </Group>
        </Alert>
      )}
      {offline && (
        <Alert color="yellow" variant="light" mb="sm" icon={<IconCloudOff size={18} />} title="Sem internet">
          <Text size="sm">
            Você pode continuar usando: {cacheAt ? `os dados mostrados são de ${time(cacheAt)}` : 'as telas já abertas neste aparelho continuam disponíveis'}.
            {pending.length > 0 && <> {pending.length} gravação(ões) guardada(s) serão enviadas quando a conexão voltar. <Anchor component="button" size="sm" onClick={() => setOpen(true)}>Ver</Anchor></>}
          </Text>
        </Alert>
      )}
      {!offline && pending.length > 0 && (
        <Alert color={failed.length ? 'red' : 'blue'} variant="light" mb="sm" icon={<IconCloudUpload size={18} />}>
          <Group justify="space-between">
            <Text size="sm">{failed.length ? `${failed.length} gravação(ões) feitas sem internet deram erro ao enviar.` : `Enviando ${pending.length} gravação(ões) feitas sem internet…`}</Text>
            <Group gap="xs"><Button size="xs" variant="light" onClick={() => void flushQueue()}>Enviar agora</Button><Button size="xs" variant="default" onClick={() => setOpen(true)}>Ver</Button></Group>
          </Group>
        </Alert>
      )}
      <Modal opened={open} onClose={() => setOpen(false)} title="Gravações feitas sem internet" size="lg">
        <Stack>
          {pending.length === 0 ? <Text size="sm" c="dimmed">Nada esperando envio.</Text> : (
            <Table>
              <Table.Thead><Table.Tr><Table.Th>Quando</Table.Th><Table.Th>O quê</Table.Th><Table.Th>Situação</Table.Th><Table.Th w={70} /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {pending.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{time(p.at)}</Table.Td>
                    <Table.Td><Text size="sm">{p.label}</Text></Table.Td>
                    <Table.Td>{p.error ? <Text size="sm" c="red">{p.error}</Text> : <Text size="sm" c="dimmed">aguardando</Text>}</Table.Td>
                    <Table.Td>
                      <Group gap={2} wrap="nowrap">
                        {p.error && <Tooltip label="Tentar de novo"><ActionIcon variant="subtle" onClick={() => void retry(p.id!)} aria-label="Tentar de novo"><IconRefresh size={16} /></ActionIcon></Tooltip>}
                        <Tooltip label="Descartar"><ActionIcon variant="subtle" color="red" onClick={() => confirm('Descartar esta gravação? Ela não será enviada.') && void discard(p.id!)} aria-label="Descartar"><IconTrash size={16} /></ActionIcon></Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Modal>
    </>
  )
}
