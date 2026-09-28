import { ActionIcon, AspectRatio, Box, Button, Group, Progress, SimpleGrid, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { Dropzone } from '@mantine/dropzone'
import { IconLink, IconTrash, IconVideoPlus } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { api, API_URL, ApiError, getToken } from '../lib/api'
import { useAction } from '../lib/hooks'

export interface Video { id: string; kind: 'link' | 'file'; provider: string | null; title: string | null; url: string | null; fileName: string | null; size: number | null; src: string }
const MAX = 3
const MAX_MB = 100
const ACCEPT = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']

// Envia o arquivo com XMLHttpRequest para mostrar o progresso.
function uploadVideo(productId: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<Video[]>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_URL}/api/products/${productId}/videos/upload`)
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      let data: any = null
      try { data = JSON.parse(xhr.responseText) } catch { /* sem corpo */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new ApiError(xhr.status, (Array.isArray(data?.message) ? data.message.join('\n') : data?.message) || 'Falha ao enviar o vídeo'))
    }
    xhr.onerror = () => reject(new Error('Falha de conexão ao enviar o vídeo'))
    const body = new FormData()
    body.append('file', file)
    xhr.send(body)
  })
}

function Player({ v }: { v: Video }) {
  if (v.provider === 'youtube' || v.provider === 'vimeo')
    return <AspectRatio ratio={16 / 9}><iframe src={v.src} title={v.title ?? 'Vídeo do produto'} allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen style={{ border: 0, borderRadius: 8 }} /></AspectRatio>
  return <AspectRatio ratio={16 / 9}><video src={v.src.startsWith('/') ? `${API_URL}${v.src}` : v.src} controls preload="metadata" style={{ borderRadius: 8, background: '#000' }} /></AspectRatio>
}

// Vídeos do produto: link do YouTube/Vimeo ou arquivo enviado. Só para produto já salvo.
export function ProductVideos({ productId }: { productId?: string }) {
  const [videos, setVideos] = useState<Video[]>([])
  const [link, setLink] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const { busy, run } = useAction()
  useEffect(() => { if (productId) api<Video[]>(`/products/${productId}/videos`).then(setVideos).catch(() => setVideos([])) }, [productId])

  if (!productId) return (
    <Stack gap={4}><Text size="sm" fw={500}>Vídeos</Text><Text size="xs" c="dimmed">Salve o produto para adicionar vídeos.</Text></Stack>
  )
  const full = videos.length >= MAX

  const addLink = () => run(async () => {
    setVideos(await api<Video[]>(`/products/${productId}/videos/link`, { method: 'POST', body: { url: link.trim() } }))
    setLink('')
  }, 'Vídeo adicionado')
  const upload = (files: File[]) => files[0] && run(async () => {
    setProgress(0)
    try { setVideos(await uploadVideo(productId, files[0], setProgress)) } finally { setProgress(null) }
  }, 'Vídeo enviado')
  const remove = (v: Video) => confirm('Excluir este vídeo?') && run(async () => setVideos(await api<Video[]>(`/products/${productId}/videos/${v.id}`, { method: 'DELETE' })))

  return (
    <Stack gap="xs">
      <Group justify="space-between"><Text size="sm" fw={500}>Vídeos</Text><Text size="xs" c="dimmed">{videos.length} de {MAX}</Text></Group>
      {videos.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          {videos.map((v) => (
            <Box key={v.id} className="video-tile">
              <Player v={v} />
              <Group justify="space-between" gap={4} mt={4} wrap="nowrap">
                <Text size="xs" c="dimmed" truncate>{v.kind === 'file' ? `${v.fileName} · ${((v.size ?? 0) / 1048576).toFixed(1)} MB` : v.url}</Text>
                <Tooltip label="Excluir"><ActionIcon size="sm" variant="subtle" color="red" onClick={() => remove(v)} aria-label="Excluir vídeo"><IconTrash size={14} /></ActionIcon></Tooltip>
              </Group>
            </Box>
          ))}
        </SimpleGrid>
      )}
      {!full && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <TextInput style={{ flex: 1 }} leftSection={<IconLink size={16} />} placeholder="Link do YouTube, Vimeo ou .mp4" aria-label="Link do vídeo" value={link}
              onChange={(e) => setLink(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (link.trim()) addLink() } }} />
            <Button variant="light" onClick={addLink} disabled={!link.trim()} loading={busy && progress === null}>Adicionar</Button>
          </Group>
          <Dropzone onDrop={upload} accept={ACCEPT} maxFiles={1} multiple={false} maxSize={MAX_MB * 1024 * 1024} loading={busy && progress === null} radius="md" p={0} h={36} aria-label="Enviar arquivo de vídeo"
            onReject={() => run(async () => { throw new Error(`Envie um vídeo MP4, WebM ou MOV de até ${MAX_MB} MB`) })}>
            <Group justify="center" h={34} gap={6} style={{ pointerEvents: 'none' }}>
              <IconVideoPlus size={18} stroke={1.5} />
              <Text size="xs" c="dimmed">Enviar arquivo (até {MAX_MB} MB)</Text>
            </Group>
          </Dropzone>
        </SimpleGrid>
      )}
      {progress !== null && <Progress value={progress} animated aria-label="Progresso do envio" />}
    </Stack>
  )
}
