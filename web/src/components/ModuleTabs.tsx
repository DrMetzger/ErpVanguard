import { Button, SimpleGrid, Tabs, Title } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import type { Icon } from '@tabler/icons-react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

export interface ModuleTab { path: string; label: string; icon: Icon; element: ReactNode; hidden?: boolean }

// Módulo com abas; a navegação usa sempre o caminho completo (/base/aba).
export function ModuleTabs({ base, title, tabs, extraRoutes }: { base: string; title: string; tabs: ModuleTab[]; extraRoutes?: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const visible = tabs.filter((t) => !t.hidden)
  const current = location.pathname.slice(base.length + 1).split('/')[0] || visible[0]!.path
  // No celular: todas as funções à vista em botões grandes (nada de rolar para o lado).
  const phone = useMediaQuery('(max-width: 48em)')

  return (
    <>
      <Title order={2} mb="md" className="no-print">{title}</Title>
      {phone ? (
        <SimpleGrid cols={visible.length > 4 ? 3 : 2} spacing={6} mb="lg" className="no-print tab-grid">
          {visible.map((t) => (
            <Button key={t.path} variant={t.path === current ? 'filled' : 'default'} onClick={() => navigate(`${base}/${t.path}`)} h="auto" py={8} px={6}
              styles={{ inner: { flexDirection: 'column', gap: 4 }, label: { whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.15, fontSize: 12 }, section: { margin: 0 } }}
              leftSection={<t.icon size={18} />}>{t.label}</Button>
          ))}
        </SimpleGrid>
      ) : (
      <Tabs value={current} onChange={(v) => v && navigate(`${base}/${v}`)} mb="lg" className="no-print">
        <Tabs.List style={{ flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden' }}>
          {visible.map((t) => <Tabs.Tab key={t.path} value={t.path} leftSection={<t.icon size={16} />} style={{ whiteSpace: 'nowrap' }}>{t.label}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>
      )}
      <Routes>
        <Route index element={<Navigate to={`${base}/${visible[0]!.path}`} replace />} />
        {visible.map((t) => <Route key={t.path} path={t.path} element={t.element} />)}
        {extraRoutes}
        <Route path="*" element={<Navigate to={`${base}/${visible[0]!.path}`} replace />} />
      </Routes>
    </>
  )
}
