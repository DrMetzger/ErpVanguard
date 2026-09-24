import { Avatar, type AvatarProps } from '@mantine/core'
import { createAvatar } from '@dicebear/core'
import { useMemo } from 'react'
import { initials } from '../lib/format'
import { avataaars } from './avatarStyles'
import { animalSvg } from './avatars/vanguard'

const svgUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

// Tons de pele que a pessoa escolhe na tela (da mais clara para a mais escura).
export const SKIN_TONES = [
  { value: 'ffdbb4', label: 'Clara' }, { value: 'edb98a', label: 'Média' }, { value: 'd08b5b', label: 'Morena' },
  { value: 'ae5d29', label: 'Morena escura' }, { value: '614335', label: 'Escura' },
] as const

const MEN_HAIR = ['shortCurly', 'shortFlat', 'shortRound', 'shortWaved', 'sides', 'theCaesar', 'theCaesarAndSidePart', 'shavedSides', 'dreads01', 'frizzle', 'shaggy', 'hat', 'turban'] as const
const WOMEN_HAIR = ['bob', 'bun', 'curly', 'curvy', 'bigHair', 'frida', 'fro', 'froBand', 'longButNotTooLong', 'miaWallace', 'straight01', 'straight02', 'straightAndStrand', 'dreads', 'hijab'] as const
export const GENDERS = [{ value: 'm', label: 'Homem' }, { value: 'f', label: 'Mulher' }] as const

// "Pessoas" (Avataaars, uso comercial livre) só com expressões alegres e estampas neutras.
// A semente "t2-gf-..." fixa o tom de pele (índice em SKIN_TONES; "tx" = qualquer) e homem/mulher.
const people = (seed: string) => {
  const tone = SKIN_TONES[Number(seed.match(/^t(\d)-/)?.[1] ?? -1)]
  const gender = seed.match(/^t[\dx]-g([mf])-/)?.[1]
  return createAvatar(avataaars, {
    seed,
    ...(gender && { top: [...(gender === 'm' ? MEN_HAIR : WOMEN_HAIR)], topProbability: 100 }),
    backgroundColor: ['ff5f6d', '2193b0', '8e2de2', 'f7971e', '11998e', 'fc466b', '4776e6', 'ee0979'],
    backgroundType: ['gradientLinear'],
    eyes: ['default', 'happy', 'wink', 'squint'],
    eyebrows: ['default', 'defaultNatural', 'raisedExcited', 'raisedExcitedNatural'],
    mouth: ['smile', 'default', 'twinkle'],
    skinColor: tone ? [tone.value] : SKIN_TONES.map((t) => t.value),
    hairColor: ['a55728', '2c1b18', 'b58143', 'd6b370', '724133', '4a312c', 'ecdcbf', 'c93305', 'e8e1e1'],
    accessories: ['prescription01', 'prescription02', 'round', 'wayfarers'],
    clothingGraphic: ['bear', 'deer', 'diamond', 'pizza', 'hola', 'cumbia'],
    accessoriesProbability: 20,
    facialHairProbability: gender === 'f' ? 0 : 30,
  }).toDataUri()
}

export const AVATAR_STYLES = {
  pessoas: { label: 'Pessoas', render: people },
  bichos: { label: 'Bichos', render: (seed: string) => svgUri(animalSvg(seed)) },
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
