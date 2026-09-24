import { Avatar, type AvatarProps } from '@mantine/core'
import { createAvatar } from '@dicebear/core'
import { useMemo } from 'react'
import { initials } from '../lib/format'
import { avataaars } from './avatarStyles'
import { animalSvg, profileSvg } from './avatars/vanguard'

const svgUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

// "Pessoas" (Avataaars, uso comercial livre) só com expressões alegres, cores naturais e estampas neutras.
const people = (seed: string) =>
  createAvatar(avataaars, {
    seed,
    backgroundColor: ['ff5f6d', '2193b0', '8e2de2', 'f7971e', '11998e', 'fc466b', '4776e6', 'ee0979'],
    backgroundType: ['gradientLinear'],
    eyes: ['default', 'happy', 'wink', 'squint'],
    eyebrows: ['default', 'defaultNatural', 'raisedExcited', 'raisedExcitedNatural'],
    mouth: ['smile', 'default', 'twinkle'],
    skinColor: ['614335', 'd08b5b', 'ae5d29', 'edb98a', 'ffdbb4'],
    hairColor: ['a55728', '2c1b18', 'b58143', 'd6b370', '724133', '4a312c', 'ecdcbf', 'c93305', 'e8e1e1'],
    accessories: ['prescription01', 'prescription02', 'round', 'wayfarers'],
    clothingGraphic: ['bear', 'deer', 'diamond', 'pizza', 'hola', 'cumbia'],
    accessoriesProbability: 20,
    facialHairProbability: 25,
  }).toDataUri()

export const AVATAR_STYLES = {
  perfis: { label: 'Perfis', render: (seed: string) => svgUri(profileSvg(seed)) },
  bichos: { label: 'Bichos', render: (seed: string) => svgUri(animalSvg(seed)) },
  pessoas: { label: 'Pessoas', render: people },
} as const
export type AvatarStyle = keyof typeof AVATAR_STYLES

export function avatarUri(value: string) {
  const [style, seed] = value.split(':') as [AvatarStyle, string]
  const def = AVATAR_STYLES[style]
  return def && seed ? def.render(seed) : null
}

// Avatar do usuário: desenho escolhido ou as iniciais em degradê.
export function UserAvatar({ name, avatar, ...props }: { name: string; avatar?: string | null } & AvatarProps) {
  const src = useMemo(() => (avatar ? avatarUri(avatar) : null), [avatar])
  return src
    ? <Avatar src={src} alt={name} radius="md" {...props} />
    : <Avatar variant="gradient" radius="md" {...props}>{initials(name)}</Avatar>
}
