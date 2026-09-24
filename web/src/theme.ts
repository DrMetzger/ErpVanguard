import { createTheme, type MantineColorsTuple } from '@mantine/core'

// Azul Vanguard (do logo), do mais claro ao mais escuro.
const vanguard: MantineColorsTuple = [
  '#e6f3ff', '#cfe3ff', '#9dc4fd', '#67a4fb', '#3b82f6', '#2a74f5', '#1b6bf6', '#0b5adb', '#0050c5', '#0045ae',
]

// Tema escuro azul-marinho, como o site institucional.
const dark: MantineColorsTuple = [
  '#c9d1e0', '#a6b0c3', '#7f8aa3', '#5b6781', '#3a4660', '#27324a', '#1a2338', '#131c31', '#0f172a', '#0b1120',
]

export const theme = createTheme({
  primaryColor: 'vanguard',
  primaryShade: { light: 5, dark: 4 },
  colors: { vanguard, dark },
  fontFamily: 'Inter, system-ui, sans-serif',
  headings: { fontFamily: 'Inter, system-ui, sans-serif', fontWeight: '700' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  defaultGradient: { from: 'vanguard.5', to: 'cyan.5', deg: 90 },
  components: {
    Button: { defaultProps: { radius: 'md' } },
    Card: { defaultProps: { withBorder: true, radius: 'lg', padding: 'lg' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Modal: { defaultProps: { radius: 'lg', centered: true, overlayProps: { blur: 3, backgroundOpacity: 0.55 } } },
    Tooltip: { defaultProps: { withArrow: true } },
    Table: { defaultProps: { highlightOnHover: true, verticalSpacing: 'sm' } },
  },
})
