import { Button, Card, Group, NumberInput, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { Loading } from '../components/ui'
import { api } from '../lib/api'
import { useAction, useApi } from '../lib/hooks'
import InvoiceNumbering from './InvoiceNumbering'

interface Param { key: string; group: string; label: string; type: 'bool' | 'int' | 'decimal' | 'text'; default: boolean | number | string; help: string; value: boolean | number | string; min?: number; max?: number }

// Parâmetros do sistema (como os MV_ do Protheus). Só administradores.
export default function Parameters() {
  const { data, setData } = useApi<Param[]>('/parameters')
  const [values, setValues] = useState<Record<string, boolean | number | string>>({})
  const { busy, run } = useAction()
  const [version, setVersion] = useState(0) // recarrega a numeração depois de salvar (MV_ESPECIE pode ter mudado)
  useEffect(() => { if (data) setValues(Object.fromEntries(data.map((p) => [p.key, p.value]))) }, [data])
  if (!data) return <Loading />
  const changed = data.filter((p) => values[p.key] !== p.value)
  const save = () => run(async () => { setData(await api<Param[]>('/parameters', { method: 'PUT', body: Object.fromEntries(changed.map((p) => [p.key, values[p.key]])) })); setVersion((v) => v + 1) }, 'Parâmetros salvos')
  const groups = [...new Set(data.map((p) => p.group))]

  return (
    <>
      <Group justify="space-between" mb="lg">
        <div><Title order={2}>Parâmetros</Title><Text c="dimmed">Ajustes de comportamento do sistema. O valor padrão vale até alguém mudar.</Text></div>
        <Button onClick={save} loading={busy} disabled={!changed.length}>Salvar{changed.length ? ` (${changed.length})` : ''}</Button>
      </Group>
      <Stack>
        {groups.map((g) => (
          <Card key={g} p={0}>
            <Text fw={700} p="md" pb={0}>{g}</Text>
            <Table verticalSpacing="sm">
              <Table.Thead><Table.Tr><Table.Th w={130}>Parâmetro</Table.Th><Table.Th>Descrição</Table.Th><Table.Th w={180}>Valor</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {data.filter((p) => p.group === g).map((p) => (
                  <Table.Tr key={p.key}>
                    <Table.Td ff="monospace" fz="sm">{p.key}</Table.Td>
                    <Table.Td><Text size="sm" fw={600}>{p.label}</Text><Text size="xs" c="dimmed">{p.help} Padrão: {typeof p.default === 'boolean' ? (p.default ? 'sim' : 'não') : String(p.default).replace('.', ',')}.</Text></Table.Td>
                    <Table.Td>
                      {p.type === 'bool'
                        ? <Switch checked={!!values[p.key]} onChange={(e) => setValues({ ...values, [p.key]: e.currentTarget.checked })} label={values[p.key] ? 'Sim' : 'Não'} aria-label={p.label} />
                        : p.type === 'text'
                        ? <TextInput value={String(values[p.key] ?? '')} onChange={(e) => setValues({ ...values, [p.key]: e.currentTarget.value })} size="xs" ff="monospace" aria-label={p.label} />
                        : <NumberInput value={values[p.key] as number} onChange={(v) => setValues({ ...values, [p.key]: Number(v) })} min={p.min} max={p.max} decimalScale={p.type === 'int' ? 0 : 2} decimalSeparator="," size="xs" aria-label={p.label} />}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        ))}
        <InvoiceNumbering key={version} />
      </Stack>
    </>
  )
}
