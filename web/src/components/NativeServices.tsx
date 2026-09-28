import { Button, Modal, Stack, Text } from '@mantine/core'
import { IconMapPin } from '@tabler/icons-react'
import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, API_URL } from '../lib/api'
import { flushQueue, setOffline } from '../lib/offline'

const CONSENT = 'vanguard.location-consent'
const POINTS = 'vanguard.pending-locations'
const SEEN = 'vanguard.seen-notifications'
const HEARTBEAT_MS = 2 * 60_000
const NOTIFY_MS = 30_000
export const APK_URL = 'https://app.erpvanguard.com.br/download/'

const read = <T,>(k: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T } catch { return fallback } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* cheio */ } }

interface Point { lat: number; lng: number; accuracy?: number; at: string }

// Serviços do app do celular: localização, avisos do sistema como notificação, fila offline e versão nova.
// No navegador do computador não faz nada.
export function NativeServices() {
  const [ask, setAsk] = useState(false)
  const navigate = useNavigate()
  const native = Capacitor.isNativePlatform()

  useEffect(() => {
    if (!native) return
    let stop = false
    const cleanups: (() => void)[] = []

    void (async () => {
      const [{ Device }, { Network }, { LocalNotifications }, { App }] = await Promise.all([
        import('@capacitor/device'), import('@capacitor/network'), import('@capacitor/local-notifications'), import('@capacitor/app'),
      ])
      const id = (await Device.getId()).identifier
      const info = await Device.getInfo()
      const appVersion = (await App.getInfo().catch(() => null))?.version ?? 'web'

      // Conexão: volta a internet → envia a fila e as posições guardadas.
      const status = await Network.getStatus()
      setOffline(!status.connected)
      const net = await Network.addListener('networkStatusChange', (s) => { setOffline(!s.connected); if (s.connected) { void flushQueue(); void beat() } })
      cleanups.push(() => void net.remove())
      const resume = await App.addListener('resume', () => { void flushQueue(); void beat(); void notify() })
      cleanups.push(() => void resume.remove())

      // Batida de "estou ativo" com as posições acumuladas (vão todas quando houver internet).
      const beat = async () => {
        const locations = read<Point[]>(POINTS, [])
        const battery = await Device.getBatteryInfo().catch(() => null)
        try {
          await api('/devices/heartbeat', { method: 'POST', body: { deviceId: id, platform: info.platform, model: `${info.manufacturer} ${info.model}`.trim(), osVersion: info.osVersion, appVersion, battery: battery?.batteryLevel ?? undefined, online: true, locations: locations.slice(-500) } })
          write(POINTS, read<Point[]>(POINTS, []).slice(locations.length))
        } catch { /* sem internet: tenta na próxima */ }
      }

      // Localização: só com o aceite do usuário (aviso de privacidade) e a permissão do Android.
      if (read<string | null>(CONSENT, null) === null) setAsk(true)
      if (read<string | null>(CONSENT, null) === 'sim') {
        const { Geolocation } = await import('@capacitor/geolocation')
        try {
          const perm = await Geolocation.requestPermissions()
          if (perm.location === 'granted' || perm.coarseLocation === 'granted') {
            let lastAt = 0
            const watchId = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 30_000, maximumAge: 60_000 }, (pos) => {
              if (!pos || Date.now() - lastAt < 60_000) return // no máximo um ponto por minuto
              lastAt = Date.now()
              const points = read<Point[]>(POINTS, [])
              points.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: new Date(pos.timestamp).toISOString() })
              write(POINTS, points.slice(-2000))
            })
            cleanups.push(() => void Geolocation.clearWatch({ id: watchId }))
          }
        } catch { /* GPS desligado ou recusado */ }
      }

      // Avisos do sistema (sino) viram notificação do celular.
      await LocalNotifications.requestPermissions().catch(() => null)
      const tap = await LocalNotifications.addListener('localNotificationActionPerformed', (a) => { const link = a.notification.extra?.link; if (typeof link === 'string') navigate(link) })
      cleanups.push(() => void tap.remove())
      const notify = async () => {
        let list: { id: string; title: string; description: string; link: string }[]
        try { list = await api('/notifications') } catch { return }
        const seen = new Set(read<string[]>(SEEN, []))
        const fresh = list.filter((n) => !seen.has(`${n.id}|${n.title}`))
        if (fresh.length && seen.size) { // na primeira vez só registra o que já existia
          await LocalNotifications.schedule({
            notifications: fresh.slice(0, 5).map((n, i) => ({ id: (Date.now() % 1_000_000_000) + i, title: n.title, body: n.description, extra: { link: n.link } })),
          }).catch(() => null)
        }
        write(SEEN, [...new Set([...seen, ...list.map((n) => `${n.id}|${n.title}`)])].slice(-500))
      }

      // Versão nova do app publicada no servidor.
      const checkUpdate = async () => {
        try {
          const remote = await fetch(`${API_URL || 'https://app.erpvanguard.com.br'}/download/version.json`, { cache: 'no-store' }).then((r) => r.json())
          const local = await fetch('/version.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ version: '' }))
          if (remote?.version && local?.version && remote.version !== local.version) window.dispatchEvent(new CustomEvent('vanguard:app-update', { detail: remote }))
        } catch { /* sem internet */ }
      }

      if (stop) return
      void beat(); void notify(); void checkUpdate(); void flushQueue()
      const t1 = setInterval(() => void beat(), HEARTBEAT_MS)
      const t2 = setInterval(() => void notify(), NOTIFY_MS)
      const t3 = setInterval(() => void flushQueue(), 60_000)
      const t4 = setInterval(() => void checkUpdate(), 30 * 60_000)
      cleanups.push(() => { clearInterval(t1); clearInterval(t2); clearInterval(t3); clearInterval(t4) })
    })()

    return () => { stop = true; cleanups.forEach((c) => c()) }
  }, [native, navigate])

  if (!native) return null
  const answer = (v: 'sim' | 'nao') => { write(CONSENT, v); setAsk(false); if (v === 'sim') window.location.reload() }
  return (
    <Modal opened={ask} onClose={() => answer('nao')} title="Localização do aparelho" centered closeOnClickOutside={false}>
      <Stack>
        <IconMapPin size={36} />
        <Text size="sm">Este aplicativo envia a localização deste celular para a empresa enquanto está em uso (controle de equipes externas e entregas). Você pode mudar isso depois nas permissões do Android.</Text>
        <Text size="xs" c="dimmed">Os dados ficam no ERP da empresa e só administradores veem o mapa (LGPD).</Text>
        <Button onClick={() => answer('sim')}>Permitir localização</Button>
        <Button variant="default" onClick={() => answer('nao')}>Agora não</Button>
      </Stack>
    </Modal>
  )
}
