import { Alert, Badge, Button, Group, Menu, Modal, ScrollArea, Stack, Table, Text } from '@mantine/core'
import { Dropzone } from '@mantine/dropzone'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconDownload, IconFileSpreadsheet, IconTableExport, IconTableImport, IconUpload } from '@tabler/icons-react'
import { useState } from 'react'
import { api, apiFile } from '../lib/api'
import { useAction } from '../lib/hooks'

interface ImportRow { line: number; action: 'incluir' | 'atualizar'; label: string; errors: string[] }
interface ImportResult { committed: boolean; total: number; create: number; update: number; errors: number; rows: ImportRow[] }

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const save = ({ blob, name }: { blob: Blob; name: string }) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
const toBase64 = (file: File) => file.arrayBuffer().then((buf) => {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
})

// Planilha do cadastro: modelo para preencher, importação (com conferência) e exportação.
export function SheetMenu({ name, title, canWrite, onImported }: { name: string; title: string; canWrite: boolean; onImported: () => void }) {
  const [importing, setImporting] = useState(false)
  const { busy, run } = useAction()
  const download = (kind: 'template' | 'export') => run(async () => save(await apiFile(`/catalog/${name}/sheet/${kind}`)))
  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button variant="default" leftSection={<IconFileSpreadsheet size={18} />} loading={busy}>Planilha</Button>
        </Menu.Target>
        <Menu.Dropdown>
          {canWrite && <Menu.Item leftSection={<IconDownload size={16} />} onClick={() => download('template')}>Baixar modelo para preencher</Menu.Item>}
          {canWrite && <Menu.Item leftSection={<IconTableImport size={16} />} onClick={() => setImporting(true)}>Importar planilha…</Menu.Item>}
          <Menu.Item leftSection={<IconTableExport size={16} />} onClick={() => download('export')}>Exportar todos (Excel)</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {importing && <ImportModal name={name} title={title} onClose={() => setImporting(false)} onDone={() => { setImporting(false); onImported() }} />}
    </>
  )
}

function ImportModal({ name, title, onClose, onDone }: { name: string; title: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<{ name: string; data: string } | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [attempt, setAttempt] = useState(0) // recria o campo de arquivo: dá para reenviar a mesma planilha corrigida
  const { busy, run } = useAction()
  const send = (data: string, commit: boolean) => api<ImportResult>(`/catalog/${name}/sheet/import`, { method: 'POST', body: { file: data, commit } })
  const check = (f: File) => run(async () => {
    const data = await toBase64(f)
    setFile({ name: f.name, data })
    try { setResult(await send(data, false)) } finally { setAttempt((n) => n + 1) }
  })
  const commit = () => run(async () => {
    const r = await send(file!.data, true)
    if (!r.committed) { setResult(r); throw new Error('Algumas linhas deram erro: nada foi gravado') }
    notifications.show({ color: 'teal', message: `${title}: ${r.create} incluído(s), ${r.update} atualizado(s)` })
    onDone()
  })
  const rows = result ? [...result.rows].sort((a, b) => (b.errors.length ? 1 : 0) - (a.errors.length ? 1 : 0) || a.line - b.line) : []

  return (
    <Modal opened onClose={onClose} title={`Importar ${title}`} size="xl">
      <Stack>
        <Dropzone key={attempt} onDrop={(f) => f[0] && check(f[0])} accept={[XLSX]} maxFiles={1} maxSize={3.5 * 1024 * 1024} loading={busy && !result} radius="md"
          onReject={() => notifications.show({ color: 'red', message: 'Envie a planilha .xlsx (até 3,5 MB)' })}>
          <Group justify="center" mih={70} gap="sm" style={{ pointerEvents: 'none' }}>
            <IconUpload size={26} stroke={1.5} />
            <div>
              <Text fw={600}>{file ? file.name : 'Arraste a planilha .xlsx aqui ou clique para escolher'}</Text>
              <Text size="xs" c="dimmed">Use o modelo do menu Planilha. Registros com o mesmo código/documento são atualizados; os outros, incluídos.</Text>
            </div>
          </Group>
        </Dropzone>
        {result && (
          <>
            <Group gap="xs">
              <Badge variant="light" size="lg">{result.total} linha(s)</Badge>
              <Badge variant="light" color="teal" size="lg">{result.create} a incluir</Badge>
              <Badge variant="light" color="blue" size="lg">{result.update} a atualizar</Badge>
              <Badge variant="light" color={result.errors ? 'red' : 'gray'} size="lg">{result.errors} com erro</Badge>
            </Group>
            {result.errors > 0
              ? <Alert color="red" variant="light">Corrija as linhas com erro na planilha e envie de novo. Nada é gravado enquanto houver erro.</Alert>
              : <Alert color="teal" variant="light" icon={<IconCheck size={18} />}>Tudo conferido. Clique em Gravar para salvar.</Alert>}
            <ScrollArea.Autosize mah={360}>
              <Table striped>
                <Table.Thead><Table.Tr><Table.Th w={70}>Linha</Table.Th><Table.Th>Registro</Table.Th><Table.Th w={100}>Ação</Table.Th><Table.Th>Conferência</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {rows.map((r) => (
                    <Table.Tr key={r.line}>
                      <Table.Td>{r.line}</Table.Td>
                      <Table.Td><Text size="sm" lineClamp={1}>{r.label}</Text></Table.Td>
                      <Table.Td><Badge size="sm" variant="dot" color={r.action === 'incluir' ? 'teal' : 'blue'}>{r.action}</Badge></Table.Td>
                      <Table.Td>{r.errors.length ? r.errors.map((e) => <Text key={e} size="sm" c="red">{e}</Text>) : <Text size="sm" c="teal">ok</Text>}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Fechar</Button>
          <Button onClick={commit} loading={busy && !!result} disabled={!result || result.errors > 0 || result.total === 0}>Gravar {result ? result.total : ''} linha(s)</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
