import { Alert, Badge, Card, Group, SegmentedControl, Stack, Table, Text } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { Loading } from '../../components/ui'
import { api } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { useAction, useApi } from '../../lib/hooks'

interface Mode { table: string; label: string; mode: 'C' | 'E'; defaultMode: 'C' | 'E'; rows: number }

// Compartilhamento dos cadastros entre as filiais (como o modo da tabela no Protheus).
export default function BranchModes() {
  const user = useUser()
  const { data, loading, reload } = useApi<Mode[]>('/branch-modes')
  const { run } = useAction()
  const admin = user.role === 'admin'
  if (loading || !data) return <Loading />
  const set = (m: Mode, mode: 'C' | 'E') => run(() => api(`/branch-modes/${m.table}`, { method: 'PUT', body: { mode } }).then(reload), `${m.label}: ${mode === 'C' ? 'compartilhado' : 'exclusivo por filial'}`)
  return (
    <Stack>
      <div>
        <Text fw={700} size="lg">Compartilhamento dos cadastros</Text>
        <Text size="sm" c="dimmed">Compartilhado: todas as filiais usam os mesmos registros. Exclusivo: cada filial tem os seus.</Text>
      </div>
      <Alert variant="light" icon={<IconInfoCircle size={18} />}>
        O modo só muda enquanto o cadastro está vazio. Pedidos, notas, financeiro, estoque e certificado são sempre da filial que os fez.
        NCM, CFOP, ICMS por UF, cClassTrib, TES, tipos de operação, matrizes fiscais, unidades e tipos de produto são sempre compartilhados.
      </Alert>
      <Card p={0}>
        <Table.ScrollContainer minWidth={560}>
          <Table verticalSpacing="sm">
            <Table.Thead><Table.Tr><Table.Th>Cadastro</Table.Th><Table.Th>Registros</Table.Th><Table.Th>Modo</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {data.map((m) => (
                <Table.Tr key={m.table}>
                  <Table.Td><Text fw={600} size="sm">{m.label}</Text></Table.Td>
                  <Table.Td>{m.rows}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <SegmentedControl size="xs" value={m.mode} disabled={!admin || m.rows > 0} onChange={(v) => set(m, v as 'C' | 'E')}
                        data={[{ value: 'C', label: 'Compartilhado' }, { value: 'E', label: 'Exclusivo' }]} aria-label={`Modo de ${m.label}`} />
                      {m.rows > 0 && <Badge variant="light" color="gray" size="sm">em uso</Badge>}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  )
}
