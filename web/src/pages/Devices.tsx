import { Badge, Card, Grid, Group, Stack, Table, Text, TextInput } from '@mantine/core'
import { IconBattery2, IconDeviceMobile, IconMapPin } from '@tabler/icons-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { Empty, Loading, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { useApi } from '../lib/hooks'

interface Device {
  id: string; userName: string; userEmail: string; platform: string | null; model: string | null; osVersion: string | null; appVersion: string | null
  lastSeen: string; lat: number | null; lng: number | null; accuracy: number | null; locationAt: string | null; battery: number | null
}
interface Point { lat: number; lng: number; accuracy: number | null; at: string }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dia(s)` }
const onlineNow = (d: Device) => Date.now() - Date.parse(d.lastSeen) < 5 * 60_000
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const pin = (color: string) => L.divIcon({ className: '', html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 4px #0008"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] })

// Onde estão os celulares com o app: última posição no mapa e o trajeto do dia de cada aparelho.
export default function Devices() {
  const { data, loading, reload } = useApi<Device[]>('/devices')
  const [selected, setSelected] = useState<string | null>(null)
  const [date, setDate] = useState(today())
  const [track, setTrack] = useState<Point[]>([])
  const mapEl = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)

  useEffect(() => { const t = setInterval(reload, 60_000); return () => clearInterval(t) }, [reload])
  useEffect(() => {
    if (!mapEl.current || map.current) return
    map.current = L.map(mapEl.current, { zoomControl: true }).setView([-15.8, -47.9], 4)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => { map.current?.remove(); map.current = null }
  }, [])
  useEffect(() => {
    if (!selected) { setTrack([]); return }
    api<Point[]>(`/devices/${encodeURIComponent(selected)}/locations?date=${date}`).then(setTrack).catch(() => setTrack([]))
  }, [selected, date])

  // Desenha: todos os aparelhos (último ponto) e, se um estiver escolhido, o trajeto dele no dia.
  useEffect(() => {
    const g = layer.current
    if (!g || !map.current) return
    g.clearLayers()
    const withPos = (data ?? []).filter((d) => d.lat !== null && d.lng !== null)
    for (const d of withPos) {
      L.marker([d.lat!, d.lng!], { icon: pin(d.id === selected ? '#f59e0b' : onlineNow(d) ? '#10b981' : '#64748b') })
        .bindPopup(`<b>${d.userName}</b><br>${d.model ?? ''}<br>${when(d.locationAt)}${d.accuracy ? ` · ±${Math.round(d.accuracy)} m` : ''}`)
        .on('click', () => setSelected(d.id)).addTo(g)
    }
    if (track.length) {
      const line = L.polyline(track.map((p) => [p.lat, p.lng] as [number, number]), { color: '#f59e0b', weight: 4, opacity: 0.8 }).addTo(g)
      L.circleMarker([track[0]!.lat, track[0]!.lng], { radius: 6, color: '#3b82f6' }).bindTooltip(`Início ${when(track[0]!.at)}`).addTo(g)
      map.current.fitBounds(line.getBounds(), { padding: [30, 30], maxZoom: 17 })
    } else if (withPos.length) {
      const sel = withPos.find((d) => d.id === selected)
      if (sel) map.current.setView([sel.lat!, sel.lng!], 16)
      else map.current.fitBounds(L.latLngBounds(withPos.map((d) => [d.lat!, d.lng!] as [number, number])), { padding: [40, 40], maxZoom: 15 })
    }
  }, [data, track, selected])

  return (
    <>
      <PageHeader title={<Text fw={700} size="lg">Dispositivos</Text>} description="Celulares com o app do ERP: onde estão, quando apareceram pela última vez e o trajeto do dia." />
      <Grid>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card p={0}>
            {loading && !data ? <Loading /> : (
              <Table highlightOnHover>
                <Table.Thead><Table.Tr><Table.Th>Usuário / aparelho</Table.Th><Table.Th>Última vez</Table.Th><Table.Th>Posição</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {data?.map((d) => (
                    <Table.Tr key={d.id} onClick={() => setSelected(d.id === selected ? null : d.id)} style={{ cursor: 'pointer' }} bg={d.id === selected ? 'var(--mantine-primary-color-light)' : undefined}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap"><IconDeviceMobile size={16} /><Stack gap={0}>
                          <Text size="sm" fw={600}>{d.userName}</Text>
                          <Text size="xs" c="dimmed">{[d.model, d.osVersion && `Android ${d.osVersion}`, d.appVersion && `app ${d.appVersion}`].filter(Boolean).join(' · ')}</Text>
                        </Stack></Group>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="dot" color={onlineNow(d) ? 'teal' : 'gray'}>{onlineNow(d) ? 'ativo' : ago(d.lastSeen)}</Badge>
                        {d.battery !== null && <Group gap={2} mt={2}><IconBattery2 size={14} /><Text size="xs">{Math.round(d.battery * 100)}%</Text></Group>}
                      </Table.Td>
                      <Table.Td>{d.lat !== null ? <Group gap={4} wrap="nowrap"><IconMapPin size={14} /><Text size="xs">{when(d.locationAt)}</Text></Group> : <Text size="xs" c="dimmed">sem permissão</Text>}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
            {data?.length === 0 && <Empty>Nenhum celular ainda. Instale o app pelo link app.erpvanguard.com.br/download e entre com um usuário.</Empty>}
          </Card>
          {selected && (
            <Card mt="sm">
              <Group justify="space-between" align="flex-end">
                <TextInput type="date" label="Trajeto do dia" value={date} onChange={(e) => setDate(e.currentTarget.value)} max={today()} />
                <Text size="sm" c="dimmed">{track.length ? `${track.length} ponto(s) · ${when(track[0]!.at)} a ${when(track.at(-1)!.at)}` : 'Sem pontos neste dia'}</Text>
              </Group>
            </Card>
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card p={0} style={{ overflow: 'hidden' }}><div ref={mapEl} style={{ height: 'min(70vh, 640px)', width: '100%' }} /></Card>
        </Grid.Col>
      </Grid>
    </>
  )
}
