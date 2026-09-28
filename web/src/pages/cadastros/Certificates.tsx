import { ActionIcon, Alert, Badge, Button, Card, Group, Modal, PasswordInput, SegmentedControl, Select, Stack, Table, Text, Tooltip } from '@mantine/core'
import { Dropzone } from '@mantine/dropzone'
import { notifications } from '@mantine/notifications'
import { IconCertificate, IconFileCertificate, IconLock, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { Empty, Loading } from '../../components/ui'
import { api } from '../../lib/api'
import { useOptions } from '../../lib/catalog'
import { cnpj, date } from '../../lib/format'
import { useAction, useApi } from '../../lib/hooks'

interface Certificate {
  id: string; companyId: string; companyLabel: string; subject: string; holderDocument: string; issuer: string | null
  validFrom: string; validTo: string; daysLeft: number; active: boolean; createdAt: string; uploadedBy: string | null
  environment: Environment; environmentChangedAt: string | null; environmentChangedBy: string | null
}
type Environment = 'homologacao' | 'producao'
const ENVIRONMENTS = [{ value: 'homologacao', label: 'Homologação' }, { value: 'producao', label: 'Produção' }]

// Ambiente da SEFAZ: homologação para testar (sem valor fiscal), produção para notas valendo.
function EnvironmentSwitch({ value, onChange, disabled }: { value: Environment; onChange: (v: Environment) => void; disabled?: boolean }) {
  return <SegmentedControl size="xs" data={ENVIRONMENTS} value={value} disabled={disabled} color={value === 'producao' ? 'red' : 'blue'}
    onChange={(v) => onChange(v as Environment)} aria-label="Ambiente da SEFAZ" />
}
const confirmProduction = () => confirm('Mudar para PRODUÇÃO?\n\nAs notas transmitidas passam a ter valor fiscal (impostos devidos, aparecem para o destinatário e na SEFAZ). Use só depois de testar em homologação.')

function Validity({ c }: { c: Certificate }) {
  if (!c.active) return <Badge color="gray" variant="light">Substituído</Badge>
  if (c.daysLeft < 0) return <Badge color="red">Vencido</Badge>
  if (c.daysLeft <= 30) return <Badge color="orange">Vence em {c.daysLeft} dia(s)</Badge>
  return <Badge color="teal" variant="light">Válido · {c.daysLeft} dias</Badge>
}

const toBase64 = (file: File) => file.arrayBuffer().then((buf) => {
  let bin = ''
  new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin)
})

function UploadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const companies = useOptions('companies')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [environment, setEnvironment] = useState<Environment>('homologacao')
  const [error, setError] = useState('')
  const { busy, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    run(async () => {
      try {
        await api('/certificates', { method: 'POST', body: { companyId, file: await toBase64(file!), password, environment } })
        notifications.show({ color: 'teal', message: 'Certificado salvo' })
        onSaved()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  return (
    <Modal opened onClose={onClose} title="Enviar certificado A1" size="lg">
      <form onSubmit={submit}>
        <Stack>
          <Select label="Empresa/filial" data={companies} value={companyId} onChange={setCompanyId} searchable required
            description="Filial pode usar o certificado da matriz (mesma raiz de CNPJ)." nothingFoundMessage="Cadastre a empresa na aba ao lado" />
          <Dropzone onDrop={(files) => setFile(files[0] ?? null)} accept={{ 'application/x-pkcs12': ['.pfx', '.p12'] }} maxFiles={1} maxSize={200 * 1024} radius="lg">
            <Group justify="center" gap="md" mih={90} style={{ pointerEvents: 'none' }}>
              <IconFileCertificate size={34} stroke={1.4} />
              <div>
                <Text fw={600}>{file ? file.name : 'Arraste o arquivo .pfx ou .p12 aqui'}</Text>
                <Text size="sm" c="dimmed">{file ? `${Math.round(file.size / 1024)} KB` : 'ou clique para escolher'}</Text>
              </div>
            </Group>
          </Dropzone>
          <PasswordInput label="Senha do certificado" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required autoComplete="off" />
          <Stack gap={4}>
            <Text size="sm" fw={500}>Ambiente da SEFAZ</Text>
            <EnvironmentSwitch value={environment} onChange={(v) => (v === 'homologacao' || confirmProduction()) && setEnvironment(v)} />
            <Text size="xs" c="dimmed">Comece em homologação: as notas vão para o ambiente de testes da SEFAZ, sem valor fiscal.</Text>
          </Stack>
          <Alert variant="light" icon={<IconLock size={18} />}>
            O arquivo e a senha ficam guardados criptografados no servidor e nunca voltam para a tela. Conferimos a senha, o CNPJ e a validade antes de salvar.
          </Alert>
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={busy} disabled={!companyId || !file || !password}>Salvar certificado</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

// Certificado digital A1 (e-CNPJ) de cada empresa/filial, usado para emitir e consultar notas na SEFAZ.
export default function Certificates() {
  const { data, loading, reload } = useApi<Certificate[]>('/certificates')
  const [uploading, setUploading] = useState(false)
  const { run } = useAction()
  const setEnv = (c: Certificate, v: Environment) => (v === 'homologacao' || confirmProduction()) &&
    run(() => api(`/certificates/${c.id}/environment`, { method: 'PATCH', body: { environment: v } }).then(reload), v === 'producao' ? 'Ambiente: PRODUÇÃO' : 'Ambiente: homologação')
  const remove = (c: Certificate) => confirm(`Excluir o certificado de ${c.subject}?`) && run(() => api(`/certificates/${c.id}`, { method: 'DELETE' }).then(reload), 'Certificado excluído')

  return (
    <>
      <Group justify="space-between" align="flex-end" mb="md" gap="sm">
        <div>
          <Text fw={700} size="lg">Certificado digital A1</Text>
          <Text size="sm" c="dimmed">e-CNPJ em arquivo (.pfx) para emitir NF-e e consultar notas na SEFAZ. O sino avisa 30 dias antes de vencer.</Text>
        </div>
        <Button leftSection={<IconPlus size={18} />} onClick={() => setUploading(true)}>Enviar certificado</Button>
      </Group>
      <Card p={0}>
        {loading && !data ? <Loading /> : (
          <Table.ScrollContainer minWidth={1000}>
            <Table>
              <Table.Thead>
                <Table.Tr><Table.Th>Empresa/filial</Table.Th><Table.Th>Titular</Table.Th><Table.Th>Emissor</Table.Th><Table.Th>Validade</Table.Th><Table.Th>Situação</Table.Th><Table.Th>Ambiente da SEFAZ</Table.Th><Table.Th w={60} /></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.map((c) => (
                  <Table.Tr key={c.id} opacity={c.active ? 1 : 0.55}>
                    <Table.Td>{c.companyLabel}</Table.Td>
                    <Table.Td><Text size="sm" fw={600}>{c.subject}</Text><Text size="xs" c="dimmed" ff="monospace">{cnpj(c.holderDocument)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{c.issuer || '—'}</Text></Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{date(c.validFrom)} a {date(c.validTo)}</Table.Td>
                    <Table.Td><Validity c={c} /></Table.Td>
                    <Table.Td>
                      <EnvironmentSwitch value={c.environment} disabled={!c.active} onChange={(v) => setEnv(c, v)} />
                      {c.environmentChangedAt && <Text size="xs" c="dimmed" mt={2}>Alterado em {new Date(c.environmentChangedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}{c.environmentChangedBy ? ` por ${c.environmentChangedBy}` : ''}</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label="Excluir"><ActionIcon variant="subtle" color="red" onClick={() => remove(c)} aria-label="Excluir certificado"><IconTrash size={17} /></ActionIcon></Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {data?.length === 0 && <Empty><Group gap="xs" justify="center"><IconCertificate size={18} />Nenhum certificado enviado.</Group></Empty>}
      </Card>
      {uploading && <UploadModal onClose={() => setUploading(false)} onSaved={() => { setUploading(false); reload() }} />}
    </>
  )
}
