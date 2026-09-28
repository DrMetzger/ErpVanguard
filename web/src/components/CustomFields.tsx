import { Badge, Checkbox, Group, Radio, Select, SimpleGrid, Switch, Text, Textarea, TextInput } from '@mantine/core'
import { applyMask, type CustomField } from '../lib/custom'
import { date, money, qty } from '../lib/format'
import { BrNumber, Money } from './inputs'

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
          const wide = { gridColumn: '1 / -1' }
          switch (f.type) {
            case 'bool': return <Switch key={f.key} label={common.label} description={common.description} checked={!!v} onChange={(e) => set(f.key, e.currentTarget.checked)} mt="lg" />
            case 'number': return <BrNumber key={f.key} {...common} decimalScale={4} allowNegative value={(v as number) ?? ''} onChange={(n) => set(f.key, n === '' ? null : Number(n))} />
            case 'integer': return <BrNumber key={f.key} {...common} decimalScale={0} allowNegative value={(v as number) ?? ''} onChange={(n) => set(f.key, n === '' ? null : Number(n))} />
            case 'currency': return <Money key={f.key} {...common} decimalScale={2} value={(v as number) ?? ''} onChange={(n) => set(f.key, n === '' ? null : Number(n))} />
            case 'date': return <TextInput key={f.key} {...common} type="date" value={(v as string) ?? ''} onChange={(e) => set(f.key, e.currentTarget.value || null)} />
            case 'select': return <Select key={f.key} {...common} data={f.options} value={(v as string) ?? null} onChange={(o) => set(f.key, o)} clearable={!f.required} searchable={f.options.length > 8} />
            case 'radio':
              return (
                <Radio.Group key={f.key} {...common} value={(v as string) ?? ''} onChange={(o) => set(f.key, o || null)} style={wide}>
                  <Group mt={6} gap="lg">{f.options.map((o) => <Radio key={o} value={o} label={o} />)}</Group>
                </Radio.Group>
              )
            case 'multiselect':
              return (
                <Checkbox.Group key={f.key} {...common} value={(v as string[]) ?? []} onChange={(o) => set(f.key, o)} style={wide}>
                  <Group mt={6} gap="lg">{f.options.map((o) => <Checkbox key={o} value={o} label={o} />)}</Group>
                </Checkbox.Group>
              )
            case 'memo': return <Textarea key={f.key} {...common} autosize minRows={3} maxRows={12} maxLength={5000} value={(v as string) ?? ''} onChange={(e) => set(f.key, e.currentTarget.value)} style={wide} />
            default:
              return <TextInput key={f.key} {...common} maxLength={500} value={(v as string) ?? ''} placeholder={f.mask ? PLACEHOLDER[f.mask] ?? f.mask : undefined}
                inputMode={f.mask && f.mask !== 'placa' && /^[9.\-/() ]+$/.test(PLACEHOLDER[f.mask] ?? f.mask) ? 'numeric' : undefined}
                onChange={(e) => set(f.key, applyMask(f.mask, e.currentTarget.value))} />
          }
        })}
      </SimpleGrid>
    </>
  )
}

const PLACEHOLDER: Record<string, string> = { cpf: '999.999.999-99', cnpj: '99.999.999/9999-99', cpf_cnpj: 'CPF ou CNPJ', cep: '99999-999', telefone: '(99) 99999-9999', placa: 'AAA-9A99' }

export function customDisplay(f: CustomField, v: unknown) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return <Text c="dimmed" span>—</Text>
  if (f.type === 'bool') return <Badge variant="dot" color={v ? 'teal' : 'gray'}>{v ? 'Sim' : 'Não'}</Badge>
  if (f.type === 'number' || f.type === 'integer') return qty(Number(v))
  if (f.type === 'currency') return money(Number(v))
  if (f.type === 'date') return date(String(v))
  if (f.type === 'multiselect') return (v as string[]).join(', ')
  if (f.type === 'memo') return <Text span size="sm" lineClamp={1} maw={260}>{String(v)}</Text>
  return String(v)
}

// Corpo a enviar: só os campos com valor ou apagados.
export const customBody = (fields: CustomField[], values: Record<string, unknown>) =>
  Object.fromEntries(fields.map((f) => [f.key, values[f.key] === '' || values[f.key] === undefined ? null : values[f.key]]))
