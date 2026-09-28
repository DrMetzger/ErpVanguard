// Conferência dos dígitos de CPF e CNPJ (o servidor confere de novo).
export function validCpf(d: string) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false
  const dv = (n: number) => { const s = d.slice(0, n).split('').reduce((a, c, i) => a + Number(c) * (n + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}
export function validCnpj(d: string) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false
  const dv = (n: number) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = d.slice(0, n).split('').reduce((a, c, i) => a + Number(c) * w[i]!, 0) % 11; return r < 2 ? 0 : 11 - r }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}
