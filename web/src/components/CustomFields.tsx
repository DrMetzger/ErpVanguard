import { Badge, Select, SimpleGrid, Switch, Text, TextInput } from '@mantine/core'
import type { CustomField } from '../lib/custom'
import { date, qty } from '../lib/format'
import { BrNumber } from './inputs'

// Campos personalizados dentro de um formulário de cadastro.
export function CustomFieldsInputs({ fields, values, onChange, labels }: { fields: CustomField[]; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; labels?: Record<string, string> }) {
  if (!fields.length) return null
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v })
  return (
    <>
      <Text size="xs" fw={700} c="dimmed" tt="uppercase" mt="xs">Campos personalizados</Text>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        {fields.map((f) => {
          const common = { label: labels?.[`custom.${f.key}`] || f.label, description: f.help ?? undefined, required: f.required }
          const v = values[f.key]
          switch (f.type) {
            case 'bool': return <Switch key={f.key} label={common.label} checked={!!v} onChange={(e) => set(f.key, e.currentTarget.checked)} mt="lg" />
            case 'number': return <BrNumber key={f.key} {...common} decimalScale={4} allowNegative value={(v as number) ?? ''} onChange={(n) => set(f.key, n === '' ? null : Number(n))} />
            case 'date': return <TextInput key={f.key} {...common} type="date" value={(v as string) ?? ''} onChange={(e) => set(f.key, e.currentTarget.value || null)} />
            case 'select': return <Select key={f.key} {...common} data={f.options} value={(v as string) ?? null} onChange={(o) => set(f.key, o)} clearable={!f.required} />
            default: return <TextInput key={f.key} {...common} maxLength={500} value={(v as string) ?? ''} onChange={(e) => set(f.key, e.currentTarget.value)} />
          }
        })}
      </SimpleGrid>
    </>
  )
}

export function customDisplay(f: CustomField, v: unknown) {
  if (v === null || v === undefined || v === '') return <Text c="dimmed" span>—</Text>
  if (f.type === 'bool') return <Badge variant="dot" color={v ? 'teal' : 'gray'}>{v ? 'Sim' : 'Não'}</Badge>
  if (f.type === 'number') return qty(Number(v))
  if (f.type === 'date') return date(String(v))
  return String(v)
}

// Corpo a enviar: só os campos com valor ou apagados.
export const customBody = (fields: CustomField[], values: Record<string, unknown>) =>
  Object.fromEntries(fields.map((f) => [f.key, values[f.key] === '' || values[f.key] === undefined ? null : values[f.key]]))
