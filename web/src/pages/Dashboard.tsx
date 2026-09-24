import { Badge, Card, Group, SimpleGrid, Skeleton, Text, ThemeIcon, Title, UnstyledButton } from '@mantine/core'
import { IconAlertTriangle, IconBox, IconCash } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '../lib/auth'
import { money } from '../lib/format'
import { useApi } from '../lib/hooks'
import type { Product } from '../lib/types'
import { modules } from '../modules'

export default function Dashboard() {
  const user = useUser()
  const navigate = useNavigate()
  const { data: products } = useApi<Product[]>('/products')

  const low = products?.filter((p) => p.active && p.stock <= p.minStock).length
  const value = products?.reduce((sum, p) => sum + p.stock * p.costPrice, 0)
  const stats = [
    { label: 'Produtos cadastrados', value: products?.length, icon: IconBox, color: 'brand' },
    { label: 'Abaixo do estoque mínimo', value: low, icon: IconAlertTriangle, color: 'yellow' },
    { label: 'Valor do estoque (custo)', value: value === undefined ? undefined : money(value), icon: IconCash, color: 'teal' },
  ]

  return (
    <>
      <Title order={2}>Olá, {user.name.split(' ')[0]} 👋</Title>
      <Text c="dimmed" mb="xl">Visão geral da sua operação.</Text>

      <SimpleGrid cols={{ base: 1, sm: 3 }} mb={36}>
        {stats.map((s) => (
          <Card key={s.label}>
            <Group justify="space-between" align="flex-start">
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{s.label}</Text>
                {s.value === undefined ? <Skeleton h={30} w={90} mt={8} /> : <Text fw={800} fz={28} mt={4}>{s.value}</Text>}
              </div>
              <ThemeIcon variant="light" color={s.color} size={44} radius="md"><s.icon size={24} stroke={1.6} /></ThemeIcon>
            </Group>
          </Card>
        ))}
      </SimpleGrid>

      <Title order={4} mb="md">Módulos</Title>
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
        {modules.map((m) => (
          <UnstyledButton key={m.path} onClick={() => navigate(m.path)}>
            <Card className="module-card" h="100%">
              <ThemeIcon variant="light" size={46} radius="md" mb="md"><m.icon size={24} stroke={1.6} /></ThemeIcon>
              <Text fw={700}>{m.title}</Text>
              <Badge mt={6} variant="dot" color={m.soon ? 'gray' : 'teal'} style={{ textTransform: 'none' }}>{m.soon ? 'Em construção' : 'Disponível'}</Badge>
            </Card>
          </UnstyledButton>
        ))}
      </SimpleGrid>
    </>
  )
}
