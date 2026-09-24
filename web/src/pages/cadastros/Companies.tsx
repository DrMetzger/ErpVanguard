import { ActionIcon, Button, Center, Group, Image, Modal, Stack, Text, Tooltip } from '@mantine/core'
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone'
import { IconPhoto, IconTrash, IconUpload } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { CatalogPage } from '../../components/CatalogPage'
import { api } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { useAction } from '../../lib/hooks'
import type { CatalogRow } from '../../lib/types'

// Reduz a imagem (máx. 600×240) e devolve PNG/JPG em base64, pronto para o DANFE e relatórios.
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => {
      const scale = Math.min(1, 600 / img.width, 240 / img.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(img.src)
      resolve(canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9))
    }
    img.onerror = () => reject(new Error('Não consegui abrir esta imagem'))
    img.src = URL.createObjectURL(file)
  })
}

function LogoModal({ company, onClose }: { company: CatalogRow; onClose: () => void }) {
  const [logo, setLogo] = useState<string | null | undefined>(undefined)
  const { busy, run } = useAction()
  useEffect(() => {
    api<{ logo: string | null }>(`/companies/${company.id}/logo`).then((r) => setLogo(r.logo)).catch(() => setLogo(null))
  }, [company.id])
  const save = (value: string | null) => run(async () => setLogo((await api<{ logo: string | null }>(`/companies/${company.id}/logo`, { method: 'PUT', body: { logo: value } })).logo), value ? 'Logo salvo' : 'Logo removido')

  return (
    <Modal opened onClose={onClose} title={`Logo · ${String(company.tradeName || company.name)}`} size="lg">
      <Text size="sm" c="dimmed" mb="md">Sai no cabeçalho do DANFE, do pedido de compra impresso e dos relatórios. PNG ou JPG; imagens grandes são reduzidas automaticamente.</Text>
      <Stack>
        <Center p="md" bg="var(--mantine-color-default-hover)" style={{ borderRadius: 12, minHeight: 140 }}>
          {logo ? <Image src={logo} alt="Logo atual" mah={120} maw="100%" fit="contain" w="auto" /> : <Text c="dimmed" size="sm">{logo === undefined ? 'Carregando…' : 'Sem logo'}</Text>}
        </Center>
        <Dropzone onDrop={(files) => files[0] && run(async () => save(await shrink(files[0]!)))} accept={IMAGE_MIME_TYPE.filter((t) => t === 'image/png' || t === 'image/jpeg')} maxSize={5 * 1024 * 1024} loading={busy} radius="lg">
          <Group justify="center" gap="md" mih={90} style={{ pointerEvents: 'none' }}>
            <IconUpload size={32} stroke={1.4} />
            <div><Text fw={600}>Arraste o logo aqui ou clique</Text><Text size="sm" c="dimmed">PNG com fundo transparente fica melhor</Text></div>
          </Group>
        </Dropzone>
        <Group justify="space-between">
          <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} disabled={!logo || busy} onClick={() => save(null)}>Remover logo</Button>
          <Button variant="default" onClick={onClose}>Fechar</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

export default function Companies() {
  const user = useUser()
  const [logoOf, setLogoOf] = useState<CatalogRow | null>(null)
  return (
    <>
      <CatalogPage
        name="companies"
        rowActions={(row) => user.role === 'admin' && (
          <Tooltip label="Logo (DANFE e relatórios)"><ActionIcon variant="subtle" onClick={() => setLogoOf(row)} aria-label="Logo"><IconPhoto size={17} /></ActionIcon></Tooltip>
        )}
      />
      {logoOf && <LogoModal company={logoOf} onClose={() => setLogoOf(null)} />}
    </>
  )
}
