import { ActionIcon, Tooltip } from '@mantine/core'
import { IconSparkles } from '@tabler/icons-react'
import { api } from '../../lib/api'
import { clearOptions } from '../../lib/catalog'
import { useAction } from '../../lib/hooks'

// NCM cadastrado sozinho (descrição pendente): pede a descrição oficial ao Gemini.
export function NcmAiButton({ id, code, onDone }: { id: string; code: string; onDone: () => void }) {
  const { busy, run } = useAction()
  const go = () => run(async () => {
    await api(`/catalog/ncm/${id}/describe`, { method: 'POST' })
    clearOptions()
    onDone()
  }, `Descrição do NCM ${code} preenchida pela IA`)
  return (
    <Tooltip label="Buscar descrição com IA">
      <ActionIcon variant="subtle" color="violet" onClick={go} loading={busy} aria-label={`Buscar descrição do NCM ${code} com IA`}><IconSparkles size={17} /></ActionIcon>
    </Tooltip>
  )
}
