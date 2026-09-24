import { Avatar, type AvatarProps } from '@mantine/core'
import { createAvatar } from '@dicebear/core'
import { avataaars, bottts, lorelei, notionists, openPeeps, pixelArt, thumbs } from './avatarStyles'
import { useMemo } from 'react'
import { initials } from '../lib/format'

// Estilos gratuitos do DiceBear (uso comercial sem atribuição), gerados localmente.
export const AVATAR_STYLES = {
  notionists: { label: 'Notion', style: notionists },
  lorelei: { label: 'Lorelei', style: lorelei },
  'open-peeps': { label: 'Open Peeps', style: openPeeps },
  avataaars: { label: 'Avataaars', style: avataaars },
  thumbs: { label: 'Thumbs', style: thumbs },
  bottts: { label: 'Robôs', style: bottts },
  'pixel-art': { label: 'Pixel art', style: pixelArt },
} as const
export type AvatarStyle = keyof typeof AVATAR_STYLES

export function avatarUri(value: string) {
  const [style, seed] = value.split(':') as [AvatarStyle, string]
  const def = AVATAR_STYLES[style]
  if (!def || !seed) return null
  return createAvatar(def.style as never, { seed, radius: 50, backgroundColor: ['ffe29b', 'b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'c7f0d8'] }).toDataUri()
}

// Avatar do usuário: desenho escolhido ou as iniciais em degradê.
export function UserAvatar({ name, avatar, ...props }: { name: string; avatar?: string | null } & AvatarProps) {
  const src = useMemo(() => (avatar ? avatarUri(avatar) : null), [avatar])
  return src
    ? <Avatar src={src} alt={name} radius="xl" variant="light" {...props} />
    : <Avatar variant="gradient" radius="xl" {...props}>{initials(name)}</Avatar>
}
