import { NumberInput, type NumberInputProps } from '@mantine/core'
import { useState } from 'react'

// Número no formato brasileiro: 1.234,56.
// Enquanto digita, o campo guarda o texto (senão "12," virava 12 e o "50" seguinte dava 1.250 — era assim
// que valores errados iam parar no frete) e o ponto vale como vírgula ("12.50" = 12,50).
export function BrNumber(props: NumberInputProps) {
  const [draft, setDraft] = useState<string | number | null>(null)
  return (
    <NumberInput decimalSeparator="," thousandSeparator={draft !== null ? undefined : '.'} allowedDecimalSeparators={[',', '.']} hideControls allowNegative={false} {...props}
      value={draft !== null ? draft : props.value}
      onChange={(v) => { setDraft(v); props.onChange?.(v) }}
      onFocus={(e) => { setDraft(props.value ?? ''); props.onFocus?.(e) }}
      onBlur={(e) => { setDraft(null); props.onBlur?.(e) }} />
  )
}

export function Money(props: NumberInputProps) {
  return <BrNumber prefix="R$ " decimalScale={4} {...props} />
}
