import {
  ActionIcon, AppShell, Avatar, Box, Burger, Divider, Group, NavLink, ScrollArea, Stack, Text, Tooltip, UnstyledButton, useComputedColorScheme, useMantineColorScheme,
} from '@mantine/core'
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks'
import { IconDoorExit, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconMoon, IconSun, IconUsers, type Icon } from '@tabler/icons-react'
import { NavLink as RouterLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useUser } from '../lib/auth'
import { initials } from '../lib/format'
import { home, modules } from '../modules'
import { Logo } from './Logo'
import { NotificationsBell } from './NotificationsBell'

const ROLE_LABEL = (role: string, permissions: string[]) =>
  role === 'admin' ? 'Administrador' : permissions.length ? permissions.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(' · ') : 'Usuário'

export default function AppLayout() {
  const user = useUser()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpened, mobile] = useDisclosure()
  const [collapsed, setCollapsed] = useLocalStorage({ key: 'vanguard.sidebar-collapsed', defaultValue: false })
  const isMobile = useMediaQuery('(max-width: 48em)')
  const mini = collapsed && !isMobile
  const { setColorScheme } = useMantineColorScheme()
  const scheme = useComputedColorScheme('dark')

  const items: { path: string; icon: Icon; title: string }[] = [home, ...modules]
  const isActive = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path))

  const link = (item: { path: string; icon: Icon; title: string }) => {
    const navLink = (
      <NavLink
        key={item.path}
        component={RouterLink}
        to={item.path}
        label={mini ? null : item.title}
        leftSection={<item.icon size={20} stroke={1.6} />}
        active={isActive(item.path)}
        onClick={mobile.close}
        variant="light"
        styles={{ root: { borderRadius: 10, justifyContent: mini ? 'center' : undefined }, section: { marginInlineEnd: mini ? 0 : undefined } }}
        aria-label={item.title}
      />
    )
    return mini ? <Tooltip key={item.path} label={item.title} position="right">{navLink}</Tooltip> : navLink
  }

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: mini ? 76 : 260, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      padding="lg"
      transitionDuration={200}
    >
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={mobileOpened} onClick={mobile.toggle} hiddenFrom="sm" size="sm" aria-label="Abrir menu" />
            <UnstyledButton onClick={() => navigate('/')} aria-label="Início"><Logo withText={!isMobile} /></UnstyledButton>
          </Group>

          <Group gap="sm" wrap="nowrap">
            <Tooltip label={scheme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
              <ActionIcon variant="default" size="lg" radius="xl" onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')} aria-label="Trocar tema">
                {scheme === 'dark' ? <IconSun size={18} stroke={1.7} /> : <IconMoon size={18} stroke={1.7} />}
              </ActionIcon>
            </Tooltip>
            <NotificationsBell />
            <Divider orientation="vertical" my={14} visibleFrom="xs" />
            <Tooltip label="Meu perfil">
              <UnstyledButton onClick={() => navigate('/minha-conta')} aria-label="Meu perfil" className="profile-btn">
                <Group gap={10} wrap="nowrap">
                  <Avatar variant="gradient" radius="xl" size={38}>
                    {initials(user.name)}
                  </Avatar>
                  <Box visibleFrom="md" style={{ lineHeight: 1.2 }}>
                    <Text size="sm" fw={600}>{user.name}</Text>
                    <Text size="xs" c="dimmed">{ROLE_LABEL(user.role, user.permissions)}</Text>
                  </Box>
                </Group>
              </UnstyledButton>
            </Tooltip>
            <Tooltip label="Sair">
              <ActionIcon variant="light" color="red" size="lg" radius="xl" onClick={logout} aria-label="Sair">
                <IconDoorExit size={19} stroke={1.7} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <AppShell.Section grow component={ScrollArea}>
          <Stack gap={4}>
            {items.map(link)}
            {user.role === 'admin' && (
              <>
                {!mini && <Text size="xs" fw={700} c="dimmed" tt="uppercase" mt="md" mb={4} px="sm">Administração</Text>}
                {mini && <Divider my="sm" />}
                {link({ path: '/usuarios', icon: IconUsers, title: 'Usuários' })}
              </>
            )}
          </Stack>
        </AppShell.Section>
        <AppShell.Section visibleFrom="sm">
          <Divider mb="sm" />
          <Tooltip label={collapsed ? 'Expandir menu' : 'Recolher menu'} position="right">
            <NavLink
              component="button"
              onClick={() => setCollapsed((c) => !c)}
              label={mini ? null : 'Recolher menu'}
              leftSection={collapsed ? <IconLayoutSidebarLeftExpand size={20} stroke={1.6} /> : <IconLayoutSidebarLeftCollapse size={20} stroke={1.6} />}
              styles={{ root: { borderRadius: 10, justifyContent: mini ? 'center' : undefined }, section: { marginInlineEnd: mini ? 0 : undefined } }}
              aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            />
          </Tooltip>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box maw={1280} mx="auto">
          <Outlet />
        </Box>
      </AppShell.Main>
    </AppShell>
  )
}
