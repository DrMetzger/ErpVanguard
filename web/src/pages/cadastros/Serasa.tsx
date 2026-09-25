import { ActionIcon, Tooltip } from '@mantine/core'
import { IconShieldSearch } from '@tabler/icons-react'
import { api } from '../../lib/api'
import { useAction } from '../../lib/hooks'

// Consulta de crédito do cliente na Serasa (fica em espera até o contrato ser configurado).
export function SerasaButton({ id, name }: { id: string; name: string }) {
  const { busy, run } = useAction()
  return (
    <Tooltip label="Consultar crédito (Serasa)">
      <ActionIcon variant="subtle" loading={busy} onClick={() => run(() => api(`/customers/${id}/serasa`, { method: 'POST' }))} aria-label={`Consultar Serasa de ${name}`}>
        <IconShieldSearch size={17} />
      </ActionIcon>
    </Tooltip>
  )
}
