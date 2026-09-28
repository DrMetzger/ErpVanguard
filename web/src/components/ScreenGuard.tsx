import { Alert, Button, Center, Code, Group, Loader, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import { Component, Suspense, type ReactNode } from 'react'

const RELOAD_KEY = 'vanguard.reloaded-at'

// Versão nova publicada com a aba aberta: o arquivo da tela antiga não existe mais.
export const isStaleChunk = (error: unknown) =>
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i.test(String((error as Error)?.message ?? error))

// Recarrega a página uma vez (no máximo a cada 30 s, para não entrar em laço).
export function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch { /* sem sessionStorage: recarrega mesmo assim */ }
  window.location.reload()
  return true
}

interface State { error: unknown }

// Se uma tela quebrar, mostra o aviso no lugar dela (o menu continua funcionando) em vez de tela preta.
class Boundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: unknown): State { return { error } }
  componentDidCatch(error: unknown) {
    if (isStaleChunk(error)) reloadForNewVersion()
    else console.error('Erro na tela:', error)
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = isStaleChunk(error)
    return (
      <Center mih="50vh" p="md">
        <Alert color={stale ? 'blue' : 'red'} variant="light" icon={<IconAlertTriangle />} title={stale ? 'O sistema foi atualizado' : 'Esta tela teve um problema'} maw={560}>
          <Stack gap="sm">
            <Text size="sm">{stale ? 'Há uma versão nova do ERP. Recarregue para continuar de onde parou.' : 'Nada foi perdido do que já estava salvo. Recarregue a página; se continuar, mande um print desta mensagem para o suporte.'}</Text>
            {!stale && <Code block>{String((error as Error)?.message ?? error).slice(0, 300)}</Code>}
            <Group>
              <Button leftSection={<IconRefresh size={16} />} onClick={() => window.location.reload()}>Recarregar</Button>
              <Button variant="default" onClick={() => { window.location.href = '/' }}>Ir para o início</Button>
            </Group>
          </Stack>
        </Alert>
      </Center>
    )
  }
}

// Protege cada tela: carregamento com indicador e erro sem derrubar o sistema. `resetKey` limpa o erro ao trocar de tela.
export function ScreenGuard({ children, resetKey }: { children: ReactNode; resetKey?: string }) {
  return (
    <Boundary key={resetKey}>
      <Suspense fallback={<Center h="50vh"><Loader type="dots" /></Center>}>{children}</Suspense>
    </Boundary>
  )
}
