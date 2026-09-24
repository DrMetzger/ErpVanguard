import { Group, Text } from '@mantine/core'

export function Logo({ size = 30, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <Group gap={10} wrap="nowrap">
      <img src="/logo.svg" alt="" width={size} height={size} />
      {withText && (
        <Text fw={500} size="lg" style={{ whiteSpace: 'nowrap' }}>
          ERP <Text span fw={800} inherit>Vanguard</Text>
        </Text>
      )}
    </Group>
  )
}
