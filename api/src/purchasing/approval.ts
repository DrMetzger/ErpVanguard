export interface ApprovalLevel {
  level: number
  limitAmount: number | null // null = sem limite
}

// Níveis que precisam aprovar um pedido: sobe nível a nível até chegar num
// limite que cubra o valor. Se nenhum cobrir, todos os níveis aprovam.
export function requiredLevels(levels: ApprovalLevel[], total: number): number[] {
  const result: number[] = []
  for (const l of [...levels].sort((a, b) => a.level - b.level)) {
    result.push(l.level)
    if (l.limitAmount === null || l.limitAmount >= total) break
  }
  return result
}

// Próximo nível a aprovar, considerando as aprovações já feitas.
export function nextLevel(required: number[], approvedLevels: number[]): number | null {
  return required.find((level) => !approvedLevels.includes(level)) ?? null
}
