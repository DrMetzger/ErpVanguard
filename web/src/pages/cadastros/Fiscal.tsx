import { Alert, Badge, Button, Card, Group, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconWand } from '@tabler/icons-react'
import { useState } from 'react'
import { CatalogPage } from '../../components/CatalogPage'
import { ProductSelect } from '../../components/ui'
import { api } from '../../lib/api'
import { useOptions } from '../../lib/catalog'
import type { Product } from '../../lib/types'
import { Money } from '../../components/inputs'
import { ItemTaxBadge, TaxTotalsBlock } from '../faturamento/TaxSummary'
import type { ItemTaxes, TaxTotals } from '../faturamento/types'

const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ')
const TAXPAYER = [{ value: '1', label: 'Contribuinte de ICMS' }, { value: '2', label: 'Contribuinte isento' }, { value: '9', label: 'Não contribuinte' }]

interface Resolved { tes: { code: string; description: string }; cfop: string; interstate: boolean; updatesStock: boolean; generatesFinancial: boolean; rule: string | null; companyUf: string; regime?: string; taxes?: ItemTaxes; totals?: TaxTotals; warnings?: string[] }

// Simula qual TES/CFOP a matriz escolhe para uma situação.
function Simulator() {
  const operations = useOptions('operation-types')
  const companies = useOptions('companies')
  const [company, setCompany] = useState<string | null>(null)
  const [op, setOp] = useState<string | null>(null)
  const [uf, setUf] = useState<string | null>('SP')
  const [taxpayer, setTaxpayer] = useState<string | null>('1')
  const [product, setProduct] = useState<Product | null>(null)
  const [amount, setAmount] = useState<number | string>(1000)
  const [result, setResult] = useState<Resolved | null>(null)
  const [error, setError] = useState('')

  const simulate = async () => {
    setError('')
    setResult(null)
    try {
      setResult(await api<Resolved>('/fiscal/resolve', { method: 'POST', body: { operationTypeId: op, companyId: company || undefined, uf: uf || undefined, taxpayer: taxpayer || undefined, productId: product?.id, amount: product ? Number(amount) || undefined : undefined } }))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Card mb="lg">
      <Group mb="sm" gap="xs"><IconWand size={18} /><Title order={5}>Simular a matriz fiscal</Title></Group>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 6 }}>
        <Select label="Empresa/filial" placeholder="Matriz" data={companies} value={company} onChange={setCompany} clearable searchable />
        <Select label="Tipo de operação" data={operations} value={op} onChange={setOp} searchable />
        <Select label="UF do cliente/fornecedor" data={UFS} value={uf} onChange={setUf} searchable clearable />
        <Select label="Contribuinte" data={TAXPAYER} value={taxpayer} onChange={setTaxpayer} clearable />
        <ProductSelect label="Produto (para ver os impostos)" value={product} onChange={setProduct} />
        <Money label="Valor do item" value={amount} onChange={setAmount} decimalScale={2} disabled={!product} />
      </SimpleGrid>
      <Group mt="md">
        <Button onClick={simulate} disabled={!op} leftSection={<IconWand size={16} />}>Simular</Button>
        {result && (
          <Group gap="sm">
            <Badge size="lg" variant="light">TES {result.tes.code} · {result.tes.description}</Badge>
            <Badge size="lg" color="teal" variant="light">CFOP {result.cfop}</Badge>
            <Text size="sm" c="dimmed">{result.companyUf} → {uf ?? result.companyUf}: {result.interstate ? 'interestadual' : 'dentro do estado'} · {result.updatesStock ? 'movimenta estoque' : 'não movimenta estoque'} · {result.generatesFinancial ? 'gera financeiro' : 'sem financeiro'}{result.rule && ` · regra "${result.rule}"`}</Text>
          </Group>
        )}
      </Group>
      {result?.taxes && result.totals && (
        <SimpleGrid cols={{ base: 1, md: 2 }} mt="md">
          <div>
            <Text size="sm" fw={600} mb={4}>Impostos do item ({{ simples: 'Simples Nacional', simples_excesso: 'Simples (excesso)', mei: 'MEI', presumido: 'Lucro Presumido', real: 'Lucro Real' }[result.regime ?? ''] ?? result.regime})</Text>
            <ItemTaxBadge taxes={result.taxes} />
            <Text size="xs" c="dimmed" mt={4}>Passe o mouse para ver a conta de cada imposto.</Text>
            {result.warnings?.map((w) => <Alert key={w} color="orange" mt="xs" p="xs">{w}</Alert>)}
          </div>
          <TaxTotalsBlock totals={result.totals} />
        </SimpleGrid>
      )}
      {error && <Alert color="red" mt="md">{error}</Alert>}
    </Card>
  )
}

// Aba "Matriz fiscal": simulador em cima, regras embaixo.
export function FiscalMatrix() {
  return <Stack gap={0}><Simulator /><CatalogPage name="fiscal-matrix" /></Stack>
}
