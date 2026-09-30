import { Button, Menu, Text, Tooltip } from '@mantine/core'
import { IconBuildingStore, IconCheck, IconChevronDown } from '@tabler/icons-react'
import { useAuth, useUser } from '../lib/auth'
import { branchLabel } from '../lib/types'

// Filial em que o usuário está trabalhando (topo da tela). Com mais de uma liberada, troca aqui.
export function BranchSwitcher({ compact = false }: { compact?: boolean }) {
  const user = useUser()
  const { switchBranch } = useAuth()
  const branches = user.branches ?? []
  const current = branches.find((b) => b.id === user.branchId)
  if (!current) return null
  const label = (
    <>
      <Text span size="sm" fw={700}>{current.code}</Text>
      <Text span size="sm" visibleFrom="md" ml={6} maw={180} truncate="end">{current.tradeName || current.name}</Text>
    </>
  )
  if (branches.length < 2) {
    return (
      <Tooltip label={`Filial: ${branchLabel(current)}`}>
        <Button variant="default" radius="xl" size={compact ? 'compact-sm' : 'compact-md'} leftSection={compact ? null : <IconBuildingStore size={16} />} aria-label={`Filial ${branchLabel(current)}`} style={{ cursor: 'default' }}>{label}</Button>
      </Tooltip>
    )
  }
  return (
    <Menu position="bottom-end" withinPortal shadow="md">
      <Menu.Target>
        <Button variant="default" radius="xl" size={compact ? 'compact-sm' : 'compact-md'} leftSection={compact ? null : <IconBuildingStore size={16} />} rightSection={<IconChevronDown size={14} />} aria-label={`Filial ${branchLabel(current)}: trocar`}>
          {label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Trabalhar na filial</Menu.Label>
        {branches.map((b) => (
          <Menu.Item key={b.id} onClick={() => b.id !== current.id && switchBranch(b.id)} rightSection={b.id === current.id ? <IconCheck size={16} /> : b.isHead ? <Text size="xs" c="dimmed">matriz</Text> : null}>
            {branchLabel(b)} <Text span size="xs" c="dimmed">· {b.uf}</Text>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
