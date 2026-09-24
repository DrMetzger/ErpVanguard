import { Card, List, Text, ThemeIcon, Title } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import type { ModuleDef } from '../modules'

export default function ModuleSoon({ module }: { module: ModuleDef }) {
  return (
    <>
      <Title order={2} mb="lg">{module.title}</Title>
      <Card maw={560}>
        <ThemeIcon variant="light" size={48} radius="md" mb="md"><module.icon size={26} /></ThemeIcon>
        <Title order={4}>Em construção</Title>
        <Text c="dimmed" size="sm" mb="md">Este módulo está sendo desenvolvido. O que vem por aí:</Text>
        <List spacing="xs" icon={<ThemeIcon size={20} radius="xl" color="teal" variant="light"><IconCheck size={13} /></ThemeIcon>}>
          {module.soon?.map((item) => <List.Item key={item}>{item}</List.Item>)}
        </List>
      </Card>
    </>
  )
}
