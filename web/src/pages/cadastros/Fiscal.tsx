import { Alert, Badge, Button, Card, Group, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconWand } from '@tabler/icons-react'
import { useState } from 'react'
import { CatalogPage } from '../../components/CatalogPage'
import { ProductSelect } from '../../components/ui'
import { api } from '../../lib/api'
import { useOptions } from '../../lib/catalog'
import type { Product } from '../../lib/types'

const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ')
const TAXPAYER = [{ value: '1', label: 'Contribuinte de ICMS' }, { value: '2', label: 'Contribuinte isento' }, { value: '9', label: 'Não contribuinte' }]

interface Resolved { tes: { code: string; description: string }; cfop: string; interstate: boolean; updatesStock: boolean; generatesFinancial: boolean; rule: string | null; companyUf: string }

// Simula qual TES/CFOP a matriz escolhe para uma situação.
function Simulator() {
  const operations = useOptions('operation-types')
  const companies = useOptions('companies')
  const [company, setCompany] = useState<string | null>(null)
  const [op, setOp] = useState<string | null>(null)
  const [uf, setUf] = useState<string | null>('SP')
  const [taxpayer, setTaxpayer] = useState<string | null>('1')
  const [product, setProduct] = useState<Product | null>(null)
  const [result, setResult] = useState<Resolved | null>(null)
  const [error, setError] = useState('')

  const simulate = async () => {
    setError('')
    setResult(null)
    try {
      setResult(await api<Resolved>('/fiscal/resolve', { method: 'POST', body: { operationTypeId: op, companyId: company || undefined, uf: uf || undefined, taxpayer: taxpayer || undefined, productId: product?.id } }))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Card mb="lg">
      <Group mb="sm" gap="xs"><IconWand size={18} /><Title order={5}>Simular a matriz fiscal</Title></Group>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 5 }}>
        <Select label="Empresa/filial" placeholder="Matriz" data={companies} value={company} onChange={setCompany} clearable searchable />
        <Select label="Tipo de operação" data={operations} value={op} onChange={setOp} searchable />
        <Select label="UF do cliente/fornecedor" data={UFS} value={uf} onChange={setUf} searchable clearable />
        <Select label="Contribuinte" data={TAXPAYER} value={taxpayer} onChange={setTaxpayer} clearable />
        <ProductSelect label="Produto (opcional)" value={product} onChange={setProduct} />
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
      {error && <Alert color="red" mt="md">{error}</Alert>}
    </Card>
  )
}

// Aba "Matriz fiscal": simulador em cima, regras embaixo.
export function FiscalMatrix() {
  return <Stack gap={0}><Simulator /><CatalogPage name="fiscal-matrix" /></Stack>
}
