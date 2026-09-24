import { NumberInput, type NumberInputProps } from '@mantine/core'

// Número no formato brasileiro: 1.234,56
export function BrNumber(props: NumberInputProps) {
  return <NumberInput decimalSeparator="," thousandSeparator="." hideControls allowNegative={false} {...props} />
}

export function Money(props: NumberInputProps) {
  return <BrNumber prefix="R$ " decimalScale={4} {...props} />
}
