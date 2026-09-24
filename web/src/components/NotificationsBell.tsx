import { ActionIcon, Box, Divider, Group, Indicator, Popover, ScrollArea, Stack, Text, ThemeIcon, Tooltip, UnstyledButton } from '@mantine/core'
import { IconAlertTriangle, IconBell, IconChecks, IconFileInvoice, IconFileText, IconScale } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import type { Notice } from '../lib/types'

const KIND = {
  aprovacao: { icon: IconChecks, color: 'yellow' },
  cotacao: { icon: IconScale, color: 'brand' },
  nota: { icon: IconFileInvoice, color: 'cyan' },
  solicitacao: { icon: IconFileText, color: 'teal' },
  reprovado: { icon: IconAlertTriangle, color: 'red' },
} as const

// Sino de avisos: recarrega a cada minuto e a cada troca de tela.
export function NotificationsBell() {
  const [notices, setNotices] = useState<Notice[]>([])
  const [opened, setOpened] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    let alive = true
    const load = () => api<Notice[]>('/notifications').then((n) => alive && setNotices(n)).catch(() => {})
    load()
    const timer = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [location.pathname])

  return (
    <Popover opened={opened} onChange={setOpened} width={360} position="bottom-end" shadow="lg" radius="lg">
      <Popover.Target>
        <Tooltip label="Avisos" disabled={opened}>
          <Indicator label={notices.length > 9 ? '9+' : notices.length} size={18} color="red" offset={6} disabled={!notices.length}>
            <ActionIcon variant="default" size="lg" radius="xl" onClick={() => setOpened((o) => !o)} aria-label="Avisos">
              <IconBell size={19} stroke={1.7} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" px="md" py="sm">
          <Text fw={700}>Avisos</Text>
          <Text size="xs" c="dimmed">{notices.length ? `${notices.length} pendente(s)` : ''}</Text>
        </Group>
        <Divider />
        {notices.length ? (
          <ScrollArea.Autosize mah={420}>
            <Stack gap={0}>
              {notices.map((n) => {
                const k = KIND[n.kind]
                return (
                  <UnstyledButton key={n.id} px="md" py="sm" className="notice" onClick={() => { setOpened(false); navigate(n.link) }}>
                    <Group wrap="nowrap" align="flex-start" gap="sm">
                      <ThemeIcon variant="light" color={k.color} radius="xl" size={34}><k.icon size={18} /></ThemeIcon>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={600}>{n.title}</Text>
                        <Text size="xs" c="dimmed" lineClamp={2}>{n.description}</Text>
                      </Box>
                      {n.createdAt && <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{timeAgo(n.createdAt)}</Text>}
                    </Group>
                  </UnstyledButton>
                )
              })}
            </Stack>
          </ScrollArea.Autosize>
        ) : (
          <Stack align="center" gap={4} py="xl">
            <IconChecks size={28} opacity={0.5} />
            <Text size="sm" c="dimmed">Tudo em dia por aqui</Text>
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  )
}
