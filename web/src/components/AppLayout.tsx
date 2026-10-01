import { Capacitor } from '@capacitor/core'
import {
  ActionIcon, AppShell, Box, Burger, Divider, Group, NavLink, ScrollArea, Stack, Text, Tooltip, UnstyledButton, useComputedColorScheme, useMantineColorScheme,
} from '@mantine/core'
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks'
import { IconAdjustments, IconBrandAndroid, IconBuilding, IconDeviceMobile, IconDoorExit, IconForms, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconMailCog, IconMoon, IconPlugConnected, IconSettings, IconSun, IconUsers, type Icon } from '@tabler/icons-react'
import { NavLink as RouterLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ScreenGuard } from './ScreenGuard'
import { OfflineBar } from './OfflineBar'
import { NativeServices } from './NativeServices'
import { ResponsiveTables } from './ResponsiveTables'
import { useAuth, useUser } from '../lib/auth'
import { home, modules } from '../modules'
import { CADASTRO_GROUPS } from '../pages/cadastros/groups'
import { Logo } from './Logo'
import { NotificationsBell } from './NotificationsBell'
import { BranchSwitcher } from './BranchSwitcher'
import { UserAvatar } from './UserAvatar'

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
    // Cadastros abre os grupos logo abaixo (com o menu recolhido vira um ícone só).
    if (item.path === '/cadastros' && !mini) {
      return (
        <NavLink
          key={item.path}
          component="button"
          aria-label={item.title}
          label={item.title}
          leftSection={<item.icon size={20} stroke={1.6} />}
          active={isActive(item.path)}
          defaultOpened={isActive(item.path)}
          variant="light"
          styles={{ root: { borderRadius: 10 } }}
          childrenOffset={14}
        >
          {CADASTRO_GROUPS.map((g) => (
            <NavLink
              key={g.path}
              component={RouterLink}
              to={`/cadastros/${g.path}`}
              label={g.label}
              leftSection={<g.icon size={17} stroke={1.6} />}
              active={isActive(`/cadastros/${g.path}`)}
              onClick={mobile.close}
              variant="subtle"
              styles={{ root: { borderRadius: 8 } }}
            />
          ))}
        </NavLink>
      )
    }
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

          <Group gap={isMobile ? 6 : 'sm'} wrap="nowrap">
            <BranchSwitcher compact={!!isMobile} />
            <Tooltip label={scheme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
              <ActionIcon variant="default" size="lg" radius="xl" onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')} aria-label="Trocar tema">
                {scheme === 'dark' ? <IconSun size={18} stroke={1.7} /> : <IconMoon size={18} stroke={1.7} />}
              </ActionIcon>
            </Tooltip>
            {!Capacitor.isNativePlatform() && !isMobile && (
              <Tooltip label="Baixar o app Android">
                <ActionIcon component="a" href="/download/" target="_blank" variant="default" size="lg" radius="xl" aria-label="Baixar o app Android">
                  <IconBrandAndroid size={18} stroke={1.7} />
                </ActionIcon>
              </Tooltip>
            )}
            <NotificationsBell />
            <Divider orientation="vertical" my={14} visibleFrom="xs" />
            <Tooltip label="Meu perfil">
              <UnstyledButton onClick={() => navigate('/minha-conta')} aria-label="Meu perfil" className="profile-btn">
                <Group gap={10} wrap="nowrap">
                  <UserAvatar name={user.name} avatar={user.avatar} size={38} />
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
                {link({ path: '/empresas', icon: IconBuilding, title: 'Empresas' })}
                {link({ path: '/usuarios', icon: IconUsers, title: 'Usuários' })}
                {link({ path: '/personalizar', icon: IconForms, title: 'Personalizar cadastros' })}
                {link({ path: '/parametros', icon: IconAdjustments, title: 'Parâmetros' })}
                {link({ path: '/modelos-email', icon: IconMailCog, title: 'Modelos de e-mail' })}
                {link({ path: '/dispositivos', icon: IconDeviceMobile, title: 'Dispositivos' })}
                {link({ path: '/integracoes', icon: IconPlugConnected, title: 'Integrações' })}
                {link({ path: '/configuracoes', icon: IconSettings, title: 'Configurações' })}
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
          <OfflineBar />
          <NativeServices />
          <ResponsiveTables />
          <ScreenGuard resetKey={location.pathname}><Outlet /></ScreenGuard>
        </Box>
      </AppShell.Main>
    </AppShell>
  )
}
