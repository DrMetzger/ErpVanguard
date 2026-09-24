import { createTheme, virtualColor, type MantineColorsTuple } from '@mantine/core'

// Azul Vanguard (tema claro).
const vanguard: MantineColorsTuple = [
  '#e6f3ff', '#cfe3ff', '#9dc4fd', '#67a4fb', '#3b82f6', '#2a74f5', '#1b6bf6', '#0b5adb', '#0050c5', '#0045ae',
]

// Amarelo dourado (tema escuro).
const gold: MantineColorsTuple = [
  '#fff8e1', '#ffefc7', '#fcdc90', '#f9c855', '#f6b826', '#f4ad0a', '#f3a800', '#d89300', '#c08200', '#a66f00',
]

// Preto (fundos e superfícies do tema escuro).
const dark: MantineColorsTuple = [
  '#d6d6d6', '#b5b5b5', '#8f8f8f', '#6b6b6b', '#3f3f3f', '#2c2c2c', '#1d1d1d', '#131313', '#0d0d0d', '#080808',
]

export const theme = createTheme({
  colors: {
    vanguard,
    gold,
    dark,
    // Cor da marca: dourado no escuro, azul no claro.
    brand: virtualColor({ name: 'brand', dark: 'gold', light: 'vanguard' }),
    // Segunda cor dos degradês: laranja no escuro, ciano no claro.
    accent: virtualColor({ name: 'accent', dark: 'orange', light: 'cyan' }),
  },
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 5 },
  autoContrast: true, // texto escuro sobre o dourado, branco sobre o azul
  luminanceThreshold: 0.45,
  fontFamily: 'Inter, system-ui, sans-serif',
  headings: { fontFamily: 'Inter, system-ui, sans-serif', fontWeight: '700' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  defaultGradient: { from: 'brand.5', to: 'accent.5', deg: 90 },
  components: {
    Button: { defaultProps: { radius: 'md' } },
    Card: { defaultProps: { withBorder: true, radius: 'lg', padding: 'lg' } },
    Paper: { defaultProps: { radius: 'lg' } },
    Modal: { defaultProps: { radius: 'lg', centered: true, overlayProps: { blur: 3, backgroundOpacity: 0.6 } } },
    Tooltip: { defaultProps: { withArrow: true } },
    Table: { defaultProps: { highlightOnHover: true, verticalSpacing: 'sm' } },
  },
})
