import { Alert, Badge, Button, Group, Modal, ScrollArea, Stack, Table, Text } from '@mantine/core'
import { Dropzone } from '@mantine/dropzone'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconCloudDownload, IconUpload } from '@tabler/icons-react'
import { useState } from 'react'
import { CatalogPage } from '../../components/CatalogPage'
import { api } from '../../lib/api'
import { useAction, useApi } from '../../lib/hooks'

interface Info { total: number; active: number; sourceDate: string | null; updatedAt: string | null }
interface Result {
  committed: boolean; total: number; create: number; update: number; same: number; missing: string[]; sourceDate: string | null; errors: string[]
  rows: { code: string; cst: string; name: string; action: 'incluir' | 'alterar'; changes: string[] }[]
}

const br = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')
const toBase64 = (file: File) => file.arrayBuffer().then((buf) => {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
})

// Tabela cClassTrib (IBS/CBS): o cadastro comum mais a atualização pelo CSV oficial.
export function ClassTribPage() {
  const [open, setOpen] = useState(false)
  const info = useApi<Info>('/catalog/class-trib/official')
  return (
    <>
      {info.data && (
        <Text size="sm" c="dimmed" mb="xs">
          Tabela oficial carregada: <b>{info.data.total}</b> classificações (versão de {br(info.data.sourceDate)}). A TES define a classificação padrão da operação; o produto pode ter uma própria.
        </Text>
      )}
      <CatalogPage name="class-trib" headerActions={(canWrite, reload) => canWrite && (
        <>
          <Button variant="light" leftSection={<IconCloudDownload size={18} />} onClick={() => setOpen(true)}>Importar tabela oficial</Button>
          {open && <ImportOfficial onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); info.reload() }} />}
        </>
      )} />
    </>
  )
}

function ImportOfficial({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<{ name: string; data: string } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { busy, run } = useAction()
  const send = (data: string, commit: boolean) => api<Result>('/catalog/class-trib/official/import', { method: 'POST', body: { file: data, commit } })
  const check = (f: File) => run(async () => {
    const data = await toBase64(f)
    setFile({ name: f.name, data })
    try { setResult(await send(data, false)) } finally { setAttempt((n) => n + 1) }
  })
  const commit = () => run(async () => {
    const r = await send(file!.data, true)
    if (!r.committed) { setResult(r); throw new Error('O arquivo tem linhas com erro: nada foi gravado') }
    notifications.show({ color: 'teal', message: `cClassTrib: ${r.create} incluída(s), ${r.update} atualizada(s)` })
    onDone()
  })

  return (
    <Modal opened onClose={onClose} title="Importar tabela oficial cClassTrib" size="xl">
      <Stack>
        <Text size="sm">Baixe o CSV da tabela cClassTrib publicada pela Receita (Portal Nacional da NF-e, reforma tributária) e envie aqui como veio (separado por ponto e vírgula). Códigos novos são incluídos e os existentes, atualizados; nada é apagado.</Text>
        <Dropzone key={attempt} onDrop={(f) => f[0] && check(f[0])} accept={['text/csv', 'application/vnd.ms-excel', 'text/plain', '.csv']} maxFiles={1} maxSize={4 * 1024 * 1024} loading={busy && !result} radius="md"
          onReject={() => notifications.show({ color: 'red', message: 'Envie o arquivo .csv da tabela (até 4 MB)' })}>
          <Group justify="center" mih={70} gap="sm" style={{ pointerEvents: 'none' }}>
            <IconUpload size={26} stroke={1.5} />
            <Text fw={600}>{file ? file.name : 'Arraste o CSV cClassTrib aqui ou clique para escolher'}</Text>
          </Group>
        </Dropzone>
        {result && (
          <>
            <Group gap="xs">
              <Badge variant="light" size="lg">{result.total} no arquivo</Badge>
              <Badge variant="light" color="teal" size="lg">{result.create} novas</Badge>
              <Badge variant="light" color="blue" size="lg">{result.update} alteradas</Badge>
              <Badge variant="light" color="gray" size="lg">{result.same} iguais</Badge>
              <Badge variant="light" size="lg">versão {br(result.sourceDate)}</Badge>
            </Group>
            {result.errors.length > 0
              ? <Alert color="red" variant="light">{result.errors.slice(0, 10).map((e) => <Text key={e} size="sm">{e}</Text>)}</Alert>
              : <Alert color="teal" variant="light" icon={<IconCheck size={18} />}>Arquivo conferido. Clique em Gravar para atualizar a tabela.</Alert>}
            {result.missing.length > 0 && <Alert color="yellow" variant="light">Não estão no arquivo (continuam cadastradas; desative se a Receita extinguiu): {result.missing.join(', ')}</Alert>}
            {result.rows.length > 0 && (
              <ScrollArea.Autosize mah={320}>
                <Table striped>
                  <Table.Thead><Table.Tr><Table.Th w={90}>cClassTrib</Table.Th><Table.Th w={60}>CST</Table.Th><Table.Th>Nome</Table.Th><Table.Th>O que muda</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {result.rows.map((r) => (
                      <Table.Tr key={r.code}>
                        <Table.Td>{r.code}</Table.Td><Table.Td>{r.cst}</Table.Td>
                        <Table.Td><Text size="sm" lineClamp={1}>{r.name}</Text></Table.Td>
                        <Table.Td>{r.action === 'incluir' ? <Badge size="sm" color="teal" variant="dot">nova</Badge> : <Text size="sm">{r.changes.join('; ')}</Text>}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Fechar</Button>
          <Button onClick={commit} loading={busy && !!result} disabled={!result || result.errors.length > 0 || (result.create + result.update) === 0}>Gravar</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
