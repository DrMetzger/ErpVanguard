import { ActionIcon, Badge, Box, Group, Image, Modal, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core'
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone'
import { IconPhotoPlus, IconStar, IconStarFilled, IconTrash, IconZoomIn } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAction } from '../lib/hooks'
import { photoPair } from '../lib/image'

export interface Photo { id: string; position: number; url: string }
export interface PendingPhoto { key: number; image: string; thumb: string }
const MAX = 6
const ACCEPT = IMAGE_MIME_TYPE.filter((t) => ['image/png', 'image/jpeg', 'image/webp'].includes(t))
let seq = 0

// Fotos do produto. Produto novo: as fotos ficam guardadas e sobem ao salvar (onPending).
export function ProductPhotos({ productId, pending, onPending, onChanged }: { productId?: string; pending: PendingPhoto[]; onPending: (p: PendingPhoto[]) => void; onChanged?: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [zoom, setZoom] = useState<string | null>(null)
  const { busy, run } = useAction()
  useEffect(() => { if (productId) api<Photo[]>(`/products/${productId}/photos`).then(setPhotos).catch(() => setPhotos([])) }, [productId])
  const total = productId ? photos.length : pending.length
  const done = (list: Photo[]) => { setPhotos(list); onChanged?.() }

  const add = (files: File[]) => run(async () => {
    const room = MAX - total
    if (room <= 0) throw new Error(`No máximo ${MAX} fotos por produto`)
    const added: PendingPhoto[] = []
    for (const file of files.slice(0, room)) {
      const pair = await photoPair(file)
      if (productId) done(await api<Photo[]>(`/products/${productId}/photos`, { method: 'POST', body: pair }))
      else added.push({ key: ++seq, ...pair })
    }
    if (added.length) onPending([...pending, ...added])
    if (files.length > room) throw new Error(`Só cabem mais ${room} foto(s)`)
  })
  const main = (p: Photo) => run(async () => done(await api<Photo[]>(`/products/${productId}/photos/${p.id}/main`, { method: 'POST' })), 'Foto principal alterada')
  const remove = (p: Photo) => confirm('Excluir esta foto?') && run(async () => done(await api<Photo[]>(`/products/${productId}/photos/${p.id}`, { method: 'DELETE' })))

  const tiles = productId
    ? photos.map((p, i) => ({ key: p.id, url: p.url, isMain: i === 0, onMain: () => main(p), onRemove: () => remove(p) }))
    : pending.map((p, i) => ({ key: String(p.key), url: p.image, isMain: i === 0,
        onMain: () => onPending([p, ...pending.filter((x) => x.key !== p.key)]), onRemove: () => onPending(pending.filter((x) => x.key !== p.key)) }))

  return (
    <Stack gap="xs">
      <Group justify="space-between"><Text size="sm" fw={500}>Fotos</Text><Text size="xs" c="dimmed">{total} de {MAX} · a primeira é a principal</Text></Group>
      <SimpleGrid cols={{ base: 3, sm: 6 }} spacing="xs">
        {tiles.map((t) => (
          <Box key={t.key} pos="relative" className={`photo-tile ${t.isMain ? 'main' : ''}`}>
            <Image src={t.url} alt="Foto do produto" h={96} fit="cover" radius="md" onClick={() => setZoom(t.url)} style={{ cursor: 'zoom-in' }} />
            {t.isMain && <Badge size="xs" pos="absolute" top={4} left={4} radius="sm">Principal</Badge>}
            <Group gap={2} pos="absolute" bottom={4} right={4} className="photo-actions">
              {!t.isMain && <Tooltip label="Tornar principal"><ActionIcon size="sm" variant="filled" color="dark" onClick={t.onMain} aria-label="Tornar principal"><IconStar size={13} /></ActionIcon></Tooltip>}
              {t.isMain && <ActionIcon size="sm" variant="filled" color="yellow" aria-label="É a principal" style={{ pointerEvents: 'none' }}><IconStarFilled size={13} /></ActionIcon>}
              <Tooltip label="Ampliar"><ActionIcon size="sm" variant="filled" color="dark" onClick={() => setZoom(t.url)} aria-label="Ampliar foto"><IconZoomIn size={13} /></ActionIcon></Tooltip>
              <Tooltip label="Excluir"><ActionIcon size="sm" variant="filled" color="red" onClick={t.onRemove} aria-label="Excluir foto"><IconTrash size={13} /></ActionIcon></Tooltip>
            </Group>
          </Box>
        ))}
        {total < MAX && (
          <Dropzone onDrop={add} accept={ACCEPT} maxSize={20 * 1024 * 1024} loading={busy} radius="md" p={0} h={96} aria-label="Adicionar fotos">
            <Stack align="center" justify="center" h={94} gap={2} style={{ pointerEvents: 'none' }}>
              <IconPhotoPlus size={24} stroke={1.5} />
              <Text size="xs" c="dimmed">Adicionar</Text>
            </Stack>
          </Dropzone>
        )}
      </SimpleGrid>
      <Modal opened={!!zoom} onClose={() => setZoom(null)} size="xl" withCloseButton={false} centered padding={0}>
        {zoom && <Image src={zoom} alt="Foto ampliada" fit="contain" mah="80vh" />}
      </Modal>
    </Stack>
  )
}

// Envia as fotos guardadas de um produto recém-criado.
export async function uploadPending(productId: string, pending: PendingPhoto[]) {
  for (const p of pending) await api(`/products/${productId}/photos`, { method: 'POST', body: { image: p.image, thumb: p.thumb } })
}
