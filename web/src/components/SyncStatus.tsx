import { Button, Card, Group, Loader, Progress, Text } from '@mantine/core'
import { IconCloudDownload, IconDatabase } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { loadSyncState, syncAll, syncState } from '../lib/localdb'

const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const n = (v?: number) => (v ?? 0).toLocaleString('pt-BR')

// Base do celular para trabalhar sem internet: quando sincronizou, quanto tem e botão para atualizar.
export function SyncStatus() {
  const [s, setS] = useState(syncState())
  useEffect(() => {
    const on = () => setS(syncState())
    window.addEventListener('vanguard:sync', on)
    void loadSyncState()
    return () => window.removeEventListener('vanguard:sync', on)
  }, [])
  return (
    <Card withBorder mb="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm" wrap="nowrap">
          {s.running ? <Loader size="sm" /> : <IconDatabase size={22} />}
          <div>
            <Text fw={600} size="sm">Dados no aparelho (uso sem internet)</Text>
            <Text size="xs" c={s.error ? 'red' : 'dimmed'}>
              {s.running ? 'Sincronizando… (só o que mudou desde a última vez)'
                : s.error ? `Não sincronizou: ${s.error}`
                : s.lastSync ? `Sincronizado em ${when(s.lastSync)} · ${n(s.counts.products)} produtos · ${n(s.counts.customers)} clientes · ${n(s.counts.suppliers)} fornecedores`
                : 'Ainda não sincronizado: toque em Sincronizar com internet'}
            </Text>
          </div>
        </Group>
        <Button size="xs" variant="light" leftSection={<IconCloudDownload size={16} />} loading={s.running} onClick={() => void syncAll((p) => api(p))}>Sincronizar agora</Button>
      </Group>
      {s.running && <Progress value={100} animated mt="xs" size="xs" />}
    </Card>
  )
}
