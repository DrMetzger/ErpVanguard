import { Group, Text } from '@mantine/core'
import { useId } from 'react'

// Escudo da Vanguard nas cores do tema (dourado no escuro, azul no claro).
export function Shield({ size = 30 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--mantine-color-brand-4)" />
          <stop offset="1" stopColor="var(--mantine-color-accent-6)" />
        </linearGradient>
      </defs>
      <path d="M32 3 8 12v18c0 15 10.2 26.6 24 31 13.8-4.4 24-16 24-31V12L32 3Z" fill={`url(#${id})`} />
      <path d="m19 20 13 25 13-25h-7l-6 12.5L26 20h-7Z" fill="light-dark(#fff, #111)" />
    </svg>
  )
}

export function Logo({ size = 30, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <Group gap={10} wrap="nowrap">
      <Shield size={size} />
      {withText && (
        <Text fw={500} size="lg" style={{ whiteSpace: 'nowrap' }}>
          ERP <Text span fw={800} inherit>Vanguard</Text>
        </Text>
      )}
    </Group>
  )
}
