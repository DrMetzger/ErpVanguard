// Avatares próprios do ERP Vanguard (desenho nosso, sem licença de terceiros).
// Sempre alegres: só olhos e bocas felizes. Gerados a partir de uma "semente" (sempre o mesmo desenho).

function rng(seed: string) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}
const pick = <T,>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)]!

// Degradês vivos, estilo perfis de streaming.
const TILES = [
  ['#ff5f6d', '#ffc371'], ['#2193b0', '#6dd5ed'], ['#8e2de2', '#4a00e0'], ['#f7971e', '#ffd200'], ['#11998e', '#38ef7d'],
  ['#fc466b', '#3f5efb'], ['#00b09b', '#96c93d'], ['#e96443', '#904e95'], ['#1d976c', '#93f9b9'], ['#ee0979', '#ff6a00'],
  ['#4776e6', '#8e54e9'], ['#f953c6', '#b91d73'], ['#0f2027', '#2c5364'], ['#c31432', '#240b36'], ['#ffb347', '#ffcc33'], ['#00c6ff', '#0072ff'],
] as const

const tile = (id: string, [a, b]: readonly [string, string], body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#${id})"/>${body}</svg>`

// ---- Perfis: carinha simples e grande, como os ícones de perfil da Netflix
const EYES = {
  dots: '<circle cx="36" cy="42" r="6" fill="#fff"/><circle cx="64" cy="42" r="6" fill="#fff"/>',
  happy: '<path d="M29 44q7-9 14 0M57 44q7-9 14 0" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>',
  wink: '<circle cx="36" cy="42" r="6" fill="#fff"/><path d="M57 43h14" stroke="#fff" stroke-width="5" stroke-linecap="round"/>',
  tall: '<rect x="31" y="32" width="10" height="18" rx="5" fill="#fff"/><rect x="59" y="32" width="10" height="18" rx="5" fill="#fff"/>',
  shades: '<path d="M24 37h52v3c0 9-6 13-12 13s-10-4-11-10h-6c-1 6-5 10-11 10s-12-4-12-13z" fill="#111"/><path d="M30 41h8" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".6"/>',
  stars: '<path d="M36 34l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8zM64 34l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="#fff"/>',
} as const
const MOUTHS = {
  smile: '<path d="M33 62q17 16 34 0" stroke="#fff" stroke-width="5.5" fill="none" stroke-linecap="round"/>',
  grin: '<path d="M31 60h38q-2 18-19 18T31 60z" fill="#fff"/>',
  small: '<path d="M41 64q9 8 18 0" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>',
  open: '<path d="M36 60h28q0 16-14 16T36 60z" fill="#fff"/><path d="M42 70q8 5 16 0" fill="#ff8fa3"/>',
  wide: '<path d="M27 60q23 22 46 0" stroke="#fff" stroke-width="5.5" fill="none" stroke-linecap="round"/>',
} as const

export function profileSvg(seed: string) {
  const r = rng(seed)
  const eyes = pick(r, Object.keys(EYES) as (keyof typeof EYES)[])
  const mouth = pick(r, Object.keys(MOUTHS) as (keyof typeof MOUTHS)[])
  const cheeks = r() < 0.45 ? '<circle cx="24" cy="58" r="6" fill="#fff" opacity=".25"/><circle cx="76" cy="58" r="6" fill="#fff" opacity=".25"/>' : ''
  return tile(`g${Math.floor(r() * 1e9)}`, pick(r, TILES), EYES[eyes] + MOUTHS[mouth] + cheeks)
}

// ---- Bichos: carinhas de animais em formas simples
const eyes = (y = 50, gap = 14, r = 4.2) => `<circle cx="${50 - gap}" cy="${y}" r="${r}" fill="#1f1f2e"/><circle cx="${50 + gap}" cy="${y}" r="${r}" fill="#1f1f2e"/><circle cx="${51.5 - gap}" cy="${y - 1.5}" r="1.4" fill="#fff"/><circle cx="${51.5 + gap}" cy="${y - 1.5}" r="1.4" fill="#fff"/>`
const smile = (y = 64, w = 6) => `<path d="M${50 - w} ${y}q${w} ${w * 0.9} ${w * 2} 0" stroke="#1f1f2e" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
const blush = (y = 60, gap = 22) => `<ellipse cx="${50 - gap}" cy="${y}" rx="5" ry="3" fill="#ff7b9c" opacity=".55"/><ellipse cx="${50 + gap}" cy="${y}" rx="5" ry="3" fill="#ff7b9c" opacity=".55"/>`

const ANIMALS: Record<string, (c: { fur: string; light: string }) => string> = {
  gato: ({ fur, light }) =>
    `<path d="M22 44 26 16 44 32zM78 44 74 16 56 32z" fill="${fur}"/><path d="M27 36 29 23 38 31zM73 36 71 23 62 31z" fill="#ffb3c6"/>
     <ellipse cx="50" cy="56" rx="31" ry="27" fill="${fur}"/><ellipse cx="50" cy="64" rx="15" ry="11" fill="${light}"/>
     ${eyes(52, 13)}<path d="M47 60h6l-3 3.5z" fill="#ff7b9c"/>${smile(64, 4)}
     <path d="M18 58h14M18 64l14-3M82 58H68M82 64l-14-3" stroke="#1f1f2e" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>`,
  raposa: ({ fur, light }) =>
    `<path d="M18 46 24 12 46 34zM82 46 76 12 54 34z" fill="${fur}"/><path d="M25 36 27 21 38 32zM75 36 73 21 62 32z" fill="#3a2a2a"/>
     <path d="M16 46q34-22 68 0-4 30-34 40Q20 76 16 46z" fill="${fur}"/><path d="M16 50q16 4 26 16 8 12 8 20-30-10-34-36zM84 50q-16 4-26 16-8 12-8 20 30-10 34-36z" fill="${light}"/>
     ${eyes(52, 13)}<ellipse cx="50" cy="72" rx="5" ry="4" fill="#1f1f2e"/>`,
  panda: () =>
    `<circle cx="25" cy="28" r="11" fill="#1f1f2e"/><circle cx="75" cy="28" r="11" fill="#1f1f2e"/><circle cx="50" cy="55" r="32" fill="#fff"/>
     <ellipse cx="36" cy="52" rx="9" ry="11" transform="rotate(-25 36 52)" fill="#1f1f2e"/><ellipse cx="64" cy="52" rx="9" ry="11" transform="rotate(25 64 52)" fill="#1f1f2e"/>
     <circle cx="37" cy="51" r="3.6" fill="#fff"/><circle cx="63" cy="51" r="3.6" fill="#fff"/><ellipse cx="50" cy="64" rx="5" ry="3.6" fill="#1f1f2e"/>${smile(68, 4)}${blush(64, 22)}`,
  urso: ({ fur, light }) =>
    `<circle cx="24" cy="28" r="12" fill="${fur}"/><circle cx="76" cy="28" r="12" fill="${fur}"/><circle cx="24" cy="28" r="6" fill="${light}"/><circle cx="76" cy="28" r="6" fill="${light}"/>
     <circle cx="50" cy="55" r="32" fill="${fur}"/><ellipse cx="50" cy="66" rx="14" ry="11" fill="${light}"/>${eyes(50, 13)}
     <ellipse cx="50" cy="61" rx="5.5" ry="4" fill="#1f1f2e"/>${smile(66, 4)}`,
  coelho: ({ fur }) =>
    `<ellipse cx="36" cy="22" rx="8" ry="22" fill="${fur}"/><ellipse cx="64" cy="22" rx="8" ry="22" fill="${fur}"/><ellipse cx="36" cy="22" rx="4" ry="16" fill="#ffb3c6"/><ellipse cx="64" cy="22" rx="4" ry="16" fill="#ffb3c6"/>
     <ellipse cx="50" cy="62" rx="29" ry="26" fill="${fur}"/>${eyes(58, 12)}<path d="M47 66h6l-3 3z" fill="#ff7b9c"/>${smile(70, 4)}${blush(68, 19)}`,
  coruja: ({ fur, light }) =>
    `<path d="M22 30 30 14 42 26zM78 30 70 14 58 26z" fill="${fur}"/><ellipse cx="50" cy="56" rx="32" ry="32" fill="${fur}"/><ellipse cx="50" cy="66" rx="18" ry="20" fill="${light}" opacity=".7"/>
     <circle cx="36" cy="46" r="12" fill="#fff"/><circle cx="64" cy="46" r="12" fill="#fff"/><circle cx="36" cy="46" r="6" fill="#1f1f2e"/><circle cx="64" cy="46" r="6" fill="#1f1f2e"/>
     <circle cx="38" cy="44" r="2" fill="#fff"/><circle cx="66" cy="44" r="2" fill="#fff"/><path d="M45 56h10l-5 8z" fill="#ffb238"/>`,
  pinguim: () =>
    `<ellipse cx="50" cy="58" rx="32" ry="32" fill="#1f2a44"/><path d="M50 36c-10-6-24 2-22 18 1 14 10 24 22 24s21-10 22-24c2-16-12-24-22-18z" fill="#fff"/>
     ${eyes(52, 10)}<path d="M43 60h14l-7 7z" fill="#ffb238"/>${blush(62, 17)}`,
  coala: () =>
    `<circle cx="22" cy="38" r="16" fill="#9aa5b1"/><circle cx="78" cy="38" r="16" fill="#9aa5b1"/><circle cx="22" cy="38" r="9" fill="#e8ecf1"/><circle cx="78" cy="38" r="9" fill="#e8ecf1"/>
     <ellipse cx="50" cy="56" rx="30" ry="29" fill="#b4bec9"/>${eyes(50, 13)}<ellipse cx="50" cy="62" rx="7" ry="9" fill="#2d2d3a"/>${smile(73, 4)}`,
  leao: ({ fur, light }) =>
    `<circle cx="50" cy="54" r="38" fill="${fur}"/><circle cx="50" cy="56" r="26" fill="${light}"/><circle cx="30" cy="34" r="6" fill="${light}"/><circle cx="70" cy="34" r="6" fill="${light}"/>
     ${eyes(52, 11)}<path d="M45 60h10l-5 5z" fill="#7a4b2a"/>${smile(66, 4)}`,
  sapo: () =>
    `<circle cx="32" cy="34" r="13" fill="#5ccf6a"/><circle cx="68" cy="34" r="13" fill="#5ccf6a"/><ellipse cx="50" cy="60" rx="34" ry="24" fill="#5ccf6a"/>
     <circle cx="32" cy="33" r="8" fill="#fff"/><circle cx="68" cy="33" r="8" fill="#fff"/><circle cx="33" cy="34" r="4.5" fill="#1f1f2e"/><circle cx="67" cy="34" r="4.5" fill="#1f1f2e"/>
     <path d="M32 62q18 14 36 0" stroke="#1f1f2e" stroke-width="3" fill="none" stroke-linecap="round"/>${blush(58, 26)}`,
  cachorro: ({ fur, light }) =>
    `<ellipse cx="22" cy="46" rx="11" ry="22" transform="rotate(15 22 46)" fill="#6b4a36"/><ellipse cx="78" cy="46" rx="11" ry="22" transform="rotate(-15 78 46)" fill="#6b4a36"/>
     <ellipse cx="50" cy="54" rx="28" ry="30" fill="${fur}"/><ellipse cx="50" cy="68" rx="15" ry="12" fill="${light}"/>${eyes(50, 12)}
     <ellipse cx="50" cy="62" rx="6" ry="4.5" fill="#1f1f2e"/><path d="M46 70q4 8 8 0" fill="#ff7b9c"/>`,
  tigre: ({ fur, light }) =>
    `<circle cx="26" cy="28" r="10" fill="${fur}"/><circle cx="74" cy="28" r="10" fill="${fur}"/><circle cx="50" cy="55" r="31" fill="${fur}"/>
     <path d="M50 24v10M40 26l3 9M60 26l-3 9M19 50h10M19 58h9M81 50H71M81 58h-9" stroke="#2d2d3a" stroke-width="3.5" stroke-linecap="round"/>
     <ellipse cx="50" cy="66" rx="14" ry="11" fill="${light}"/>${eyes(50, 12)}<path d="M46 60h8l-4 4z" fill="#ff7b9c"/>${smile(66, 4)}`,
}
const FURS: Record<string, { fur: string; light: string }[]> = {
  gato: [{ fur: '#f4a261', light: '#fde8d0' }, { fur: '#8d99ae', light: '#edf2f4' }, { fur: '#3d3d4e', light: '#9a9ab0' }],
  raposa: [{ fur: '#f3722c', light: '#fff4e6' }],
  urso: [{ fur: '#8b5e3c', light: '#e3c4a8' }, { fur: '#c9a27a', light: '#f3e2cf' }],
  coelho: [{ fur: '#f8f9fa', light: '#fff' }, { fur: '#d9c2a7', light: '#fff' }],
  coruja: [{ fur: '#8e6c4a', light: '#f2dcc1' }, { fur: '#6c757d', light: '#e9ecef' }],
  leao: [{ fur: '#c86b25', light: '#f6c177' }],
  cachorro: [{ fur: '#e0b48a', light: '#fff4e6' }, { fur: '#f5f0e6', light: '#fff' }],
  tigre: [{ fur: '#f18701', light: '#fff4e6' }],
}
export const ANIMAL_NAMES = Object.keys(ANIMALS)

export function animalSvg(seed: string) {
  const r = rng(seed)
  // semente "gato-3" escolhe o bicho; qualquer outra sorteia
  const name = ANIMALS[seed.split('-')[0]!] ? seed.split('-')[0]! : pick(r, ANIMAL_NAMES)
  const colors = pick(r, FURS[name] ?? [{ fur: '#999', light: '#eee' }])
  return tile(`g${Math.floor(r() * 1e9)}`, pick(r, TILES), ANIMALS[name]!(colors))
}
