// Teste de ponta a ponta de Faturamento, Financeiro e BI contra uma API rodando.
// Uso: API=http://localhost:3000/api ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/sales-finance-flow.mjs
import assert from 'node:assert/strict'

const API = process.env.API ?? 'http://localhost:3000/api'
const run = Date.now().toString(36).slice(-5).toUpperCase()
let passed = 0
const ok = (msg) => { passed++; console.log('  ✓', msg) }
async function call(token, method, path, body, expect) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (expect) assert.equal(res.status, expect, `${method} ${path}: esperado ${expect}, veio ${res.status} ${JSON.stringify(data)}`)
  else assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`)
  return data
}
const cnpj = (b) => { const dv = (s, w) => { const r = s.split('').reduce((a, d, i) => a + d * w[i], 0) % 11; return r < 2 ? 0 : 11 - r }; const d1 = dv(b, [5,4,3,2,9,8,7,6,5,4,3,2]); return b + d1 + dv(b + d1, [6,5,4,3,2,9,8,7,6,5,4,3,2]) }
const r12 = () => String(Math.floor(Math.random() * 1e12)).padStart(12, '4')
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const plus = (days) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }

const IE = { ES: '082560013', AM: '043413412', MS: '283115947', AC: '0100482300112', AL: '240000048', AP: '030123459', BA: '12345663', CE: '060000015', DF: '0730000100109', GO: '109876547', MA: '120000385', MT: '00130000019', MG: '0623079040081', PA: '159999995', PB: '060000015', PR: '1234567850', PE: '032141840', PI: '012345679', RJ: '99999993', RN: '200400401', RS: '2243658792', RO: '00000000625213', RR: '240066281', SC: '251040852', SP: '110042490114', SE: '271234563', TO: '29010227836' } // exemplos válidos das SEFAZ
console.log('Faturamento, Financeiro e BI')
const admin = (await call(null, 'POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token
const pass = 'Senha-forte-123'
const user = async (name, permissions) => {
  const u = await call(admin, 'POST', '/users', { name: `${name} ${run}`, email: `${name.toLowerCase()}.${run}@t.com`.toLowerCase(), password: pass, permissions })
  return (await call(null, 'POST', '/auth/login', { email: u.email, password: pass })).token
}
const tVend = await user('Vendedor', ['vendedor'])
const tVend2 = await user('Vendedora', ['vendedor'])
const tFat = await user('Faturista', ['faturamento'])
const tFin = await user('Financeiro', ['financeiro'])
const tBi = await user('Diretor', ['bi'])

// Empresa matriz em SP (se ainda não houver)
let companies = (await call(admin, 'GET', '/catalog/companies')).filter((c) => c.active)
if (!companies.some((c) => c.isHead)) {
  await call(admin, 'POST', '/catalog/companies', { code: String(1000 + Math.floor(Math.random() * 9000)), isHead: true, document: cnpj(r12()), name: 'Matriz ' + run, uf: 'SP' })
}
const head = (await call(admin, 'GET', '/companies/branding'))
const custSP = await call(admin, 'POST', '/catalog/customers', { document: cnpj(r12()), name: 'Cliente SP ' + run, uf: head.uf, taxpayer: '1', ie: IE[head.uf], city: head.uf === 'SP' ? 'Campinas' : undefined })
const custRJ = await call(admin, 'POST', '/catalog/customers', { document: cnpj(r12()), name: 'Cliente RJ ' + run, uf: head.uf === 'RJ' ? 'MG' : 'RJ', taxpayer: '1', ie: head.uf === 'RJ' ? IE.MG : IE.RJ })
const prodA = await call(admin, 'POST', '/products', { sku: `VA-${run}`, name: 'Furadeira 500W', unit: 'UN', costPrice: 120, salePrice: 199.9, stock: 10, minStock: 2 })
const prodB = await call(admin, 'POST', '/products', { sku: `VB-${run}`, name: 'Broca 8mm', unit: 'UN', costPrice: 4, salePrice: 9.5, stock: 100 })
const terms = await call(admin, 'GET', '/catalog/payment-terms')
const t306090 = terms.find((t) => t.days === '30/60/90')
const vista = terms.find((t) => t.days === '0')
const table = await call(admin, 'POST', '/catalog/price-tables', { code: 'AT' + run.slice(-4), name: 'Atacado ' + run })
await call(admin, 'PUT', `/catalog/price-tables/${table.id}/items`, { items: [{ productId: prodA.id, price: 180 }] })
ok('carga: condições de pagamento, plano de contas e caixa já vêm prontos; clientes, produtos e tabela de preço criados')

// Orçamento com preço da tabela e do produto
await call(tFin, 'GET', '/sales-quotes', undefined, 403)
const quoteBody = (qty) => ({
  customerId: custRJ.id, paymentTermId: t306090.id, priceTableId: table.id, freight: 30, discount: 10,
  items: [{ productId: prodA.id, quantity: qty }, { productId: prodB.id, quantity: 10, discountPct: 10 }],
})
let quote = await call(tVend, 'POST', '/sales-quotes', quoteBody(2))
assert.equal(quote.status, 'aberto'); assert.ok(quote.code.startsWith('ORC-'))
assert.equal(quote.validUntil, plus(15), 'validade padrão MV_ORCVAL = 15 dias')
assert.equal(quote.items[0].unitPrice, 180, 'preço da tabela')
assert.equal(quote.items[1].unitPrice, 9.5, 'preço de venda do produto')
assert.equal(quote.items[1].total, 85.5)
assert.equal(quote.total, 2 * 180 + 85.5 + 30 - 10)
assert.equal(quote.items[0].cfop, '6102', 'venda interestadual')
assert.ok(quote.taxes.icms > 0 && quote.taxes.pis > 0 && quote.items[0].taxes.icms.cst === '00', 'impostos calculados no orçamento (Lucro Presumido)')
ok(`orçamento ${quote.code}: preço da tabela e do produto, descontos, frete, CFOP ${quote.items[0].cfop} e impostos (ICMS ${quote.taxes.icms}, PIS ${quote.taxes.pis}, COFINS ${quote.taxes.cofins})`)

await call(tVend2, 'GET', `/sales-quotes/${quote.id}`, undefined, 404)
assert.ok(!(await call(tVend2, 'GET', '/sales-quotes')).some((o) => o.id === quote.id))
await call(tVend, 'POST', `/sales-quotes/${quote.id}/lose`, { reason: 'x' }, 400)
quote = await call(tVend, 'POST', `/sales-quotes/${quote.id}/lose`, { reason: 'Preço acima do concorrente' })
assert.equal(quote.status, 'perdido'); assert.equal(quote.lostReason, 'Preço acima do concorrente')
await call(tVend, 'PUT', `/sales-quotes/${quote.id}`, quoteBody(2), 400)
quote = await call(tVend, 'POST', `/sales-quotes/${quote.id}/reopen`)
assert.equal(quote.status, 'aberto')
ok('vendedor só vê os próprios orçamentos; perdido guarda o motivo e não é alterado; pode ser reaberto')

// Ganho → pedido de venda; estoque insuficiente bloqueia o faturamento
quote = await call(tVend, 'PUT', `/sales-quotes/${quote.id}`, quoteBody(12))
let order = await call(tVend, 'POST', `/sales-quotes/${quote.id}/win`)
assert.equal(order.status, 'aberto'); assert.ok(order.code.startsWith('PV-')); assert.equal(order.quoteCode, quote.code)
assert.equal((await call(tVend, 'GET', `/sales-quotes/${quote.id}`)).status, 'ganho')
await call(tVend, 'POST', `/sales-quotes/${quote.id}/win`, undefined, 400)
assert.ok(order.warnings.some((w) => w.includes('estoque')))
await call(tVend, 'POST', `/sales-orders/${order.id}/invoice`, undefined, 403)
await call(tFat, 'POST', `/sales-orders/${order.id}/invoice`, undefined, 400)
order = await call(tVend, 'PUT', `/sales-orders/${order.id}`, quoteBody(2))
ok(`orçamento ganho gerou o pedido ${order.code}; só o faturamento fatura; estoque insuficiente bloqueia`)

// Faturar
const nf = await call(tFat, 'POST', `/sales-orders/${order.id}/invoice`)
assert.equal(nf.total, 465.5)
assert.equal(nf.items.length, 2)
assert.equal(nf.items[0].cfop, '6102')
assert.equal(nf.titles.length, 3)
assert.deepEqual(nf.titles.map((t) => t.dueDate), [plus(30), plus(60), plus(90)])
assert.equal(Math.round(nf.titles.reduce((s, t) => s + t.amount, 0) * 100) / 100, 465.5)
const stockA = (await call(admin, 'GET', `/products/${prodA.id}`)).stock
assert.equal(Number(stockA), 8)
ok(`faturado NF ${nf.number}: R$ 465,50 em 3 parcelas (30/60/90, centavos na última), estoque baixou 10 → 8`)

// Financeiro: baixa parcial, total, estorno
await call(tVend, 'GET', '/finance/titles?kind=R', undefined, 403)
const open = await call(tFin, 'GET', `/finance/titles?kind=R&q=${encodeURIComponent('Cliente RJ ' + run)}`)
assert.equal(open.length, 3)
const bank = await call(tFin, 'POST', '/catalog/bank-accounts', { code: 'IT' + run.slice(-3), name: 'Itaú ' + run, kind: 'banco', bankCode: '341', agency: '1234', account: '56789', accountDigit: '0', openingBalance: 1000, cnabLayout: '400', wallet: '109', finePct: 2, interestMonthPct: 1 })
const first = open[0]
let t = await call(tFin, 'POST', `/finance/titles/${first.id}/pay`, { bankAccountId: bank.id, paidAt: today, amount: 100 })
assert.equal(t.status, 'parcial'); assert.equal(t.balance, Math.round((first.amount - 100) * 100) / 100)
await call(tFin, 'POST', `/finance/titles/${first.id}/pay`, { bankAccountId: bank.id, paidAt: today, amount: first.amount }, 400)
t = await call(tFin, 'POST', `/finance/titles/${first.id}/pay`, { bankAccountId: bank.id, paidAt: today, amount: Math.round((first.amount - 100 - 5 + 2) * 100) / 100, discount: 5, interest: 2 })
assert.equal(t.status, 'pago'); assert.equal(t.payments.length, 2)
let balances = await call(tFin, 'GET', '/finance/bank-balances')
const itau = balances.find((b) => b.id === bank.id)
assert.equal(itau.balance, Math.round((1000 + 100 + first.amount - 100 - 3) * 100) / 100)
ok('baixa parcial e depois total com desconto e juros; baixa acima do saldo recusada; saldo do banco atualizado')

await call(tFat, 'POST', `/sales-invoices/${nf.id}/cancel`, { reason: 'Cliente desistiu da compra toda' }, 400)
t = await call(tFin, 'DELETE', `/finance/payments/${t.payments[1].id}`)
assert.equal(t.status, 'parcial')
await call(tFin, 'DELETE', `/finance/payments/${t.payments[0].id}`)
await call(tFat, 'POST', `/sales-invoices/${nf.id}/cancel`, { reason: 'curta' }, 400)
const canceled = await call(tFat, 'POST', `/sales-invoices/${nf.id}/cancel`, { reason: 'Cliente desistiu da compra toda' })
assert.equal(canceled.status, 'cancelada')
assert.ok(canceled.titles.every((x) => x.status === 'cancelado'))
assert.equal(Number((await call(admin, 'GET', `/products/${prodA.id}`)).stock), 10)
assert.equal((await call(tVend, 'GET', `/sales-orders/${order.id}`)).status, 'aberto')
ok('nota com recebimento não cancela; estornadas as baixas, o cancelamento devolve o estoque, cancela os títulos e o pedido volta a aberto')

// Refatura à vista, dentro do estado
const order2 = await call(tVend, 'POST', '/sales-orders', { customerId: custSP.id, paymentTermId: vista.id, items: [{ productId: prodA.id, quantity: 1, unitPrice: 210 }] })
assert.equal(order2.items[0].cfop, '5102')
const nf2 = await call(tFat, 'POST', `/sales-orders/${order2.id}/invoice`)
assert.equal(nf2.titles.length, 1); assert.equal(nf2.titles[0].dueDate, today)
const nf3 = await call(tFat, 'POST', `/sales-orders/${order.id}/invoice`)
assert.equal(nf3.number, nf2.number + 1, 'numeração sequencial por empresa')
ok(`venda à vista dentro do estado (CFOP 5102); numeração das notas segue (NF ${nf2.number}, ${nf3.number})`)

// Contas a pagar manual, parcelada
const sup = await call(admin, 'POST', '/suppliers', { cnpj: cnpj(r12()), name: 'Imobiliária ' + run, uf: 'SP' })
const cats = await call(tFin, 'GET', '/catalog/finance-categories')
const rent = await call(tFin, 'POST', '/finance/titles', { kind: 'P', supplierId: sup.id, categoryId: cats.find((c) => c.code === '2.05').id, description: 'Aluguel ' + run, dueDate: plus(5), amount: 2500, installments: 3, mode: 'repetir' })
assert.equal(rent.installments, 3)
const rents = await call(tFin, 'GET', `/finance/titles?kind=P&q=${encodeURIComponent('Aluguel ' + run)}`)
assert.equal(rents.length, 3); assert.ok(rents.every((r) => r.amount === 2500))
await call(tFin, 'POST', '/finance/titles', { kind: 'P', customerId: custSP.id, description: 'x errado', dueDate: today, amount: 10 }, 400)
await call(tFin, 'PATCH', `/finance/titles/${rents[2].id}`, { dueDate: plus(100) })
await call(tFin, 'POST', `/finance/titles/${rents[2].id}/cancel`)
ok('contas a pagar manual: aluguel repetido 3 meses, vencimento alterado, parcela cancelada')

// Fluxo de caixa
const flow = await call(tFin, 'GET', `/finance/cash-flow?from=${today}&to=${plus(95)}`)
assert.equal(flow.days.length, 96)
const d5 = flow.days.find((d) => d.date === plus(5))
assert.ok(d5.outProjected >= 2500)
assert.ok(flow.days.find((d) => d.date === plus(90)).inProjected > 0)
const summary = await call(tFin, 'GET', '/finance/summary')
assert.ok(summary.receivable > 0 && summary.payable >= 5000)
ok(`fluxo de caixa de 96 dias: saldo inicial R$ ${flow.opening.toFixed(2)} → final R$ ${flow.closing.toFixed(2)}`)

// NF-e de compra lançada gera contas a pagar pelas duplicatas
const tComp = admin
const supNf = await call(admin, 'POST', '/suppliers', { cnpj: cnpj(r12()), name: 'Distribuidora ' + run, uf: 'SP' })
const key = ('3526' + '09' + supNf.cnpj + '55001' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0') + '1' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')).slice(0, 44).padEnd(44, '0')
const xml = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${key}" versao="4.00">
<ide><mod>55</mod><serie>1</serie><nNF>7788</nNF><dhEmi>${today}T09:00:00-03:00</dhEmi></ide>
<emit><CNPJ>${supNf.cnpj}</CNPJ><xNome>${supNf.name}</xNome></emit><dest><CNPJ>${head.document}</CNPJ></dest>
<det nItem="1"><prod><cProd>BR8</cProd><cEAN>SEM GTIN</cEAN><xProd>BROCA 8MM</xProd><NCM>82075011</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>50.0000</qCom><vUnCom>4.0000000000</vUnCom><vProd>200.00</vProd></prod></det>
<total><ICMSTot><vNF>200.00</vNF></ICMSTot></total>
<cobr><fat><nFat>7788</nFat><vOrig>200.00</vOrig><vLiq>200.00</vLiq></fat><dup><nDup>001</nDup><dVenc>${plus(28)}</dVenc><vDup>100.00</vDup></dup><dup><nDup>002</nDup><dVenc>${plus(56)}</dVenc><vDup>100.00</vDup></dup></cobr>
</infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe></infProt></protNFe></nfeProc>`
const imported = await call(tComp, 'POST', '/invoices/import', { xml })
await call(tComp, 'PUT', `/invoices/${imported.id}`, { items: [{ id: imported.items[0].id, productId: prodB.id }] })
await call(tComp, 'POST', `/invoices/${imported.id}/classify`)
const payables = await call(tFin, 'GET', `/finance/titles?kind=P&q=${encodeURIComponent('Distribuidora ' + run)}`)
assert.deepEqual(payables.map((p) => [p.dueDate, p.amount]), [[plus(28), 100], [plus(56), 100]])
ok('NF-e de compra lançada virou contas a pagar pelas duplicatas do XML (2 × R$ 100)')

// ---- Pré-nota e classificação fiscal pela TES
const tFis = await user('Fiscal', ['fiscal'])
const ops = await call(admin, 'GET', '/catalog/operation-types')
const opE01 = ops.find((o) => o.code === 'E01'), opE05 = ops.find((o) => o.code === 'E05'), opS03 = ops.find((o) => o.code === 'S03')
assert.equal(opE05.isReturn, true)
const tesNo = await call(tFis, 'POST', '/catalog/tes', { code: String(300 + Math.floor(Math.random() * 99)), kind: 'E', description: 'Remessa para conserto ' + run, cfopInternal: '1915', cfopInterstate: '2915', updatesStock: false, generatesFinancial: false })
const mkXml = (emit, name, nNF, items, dups = '') => {
  const k = ('3526' + '09' + emit + '55001' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0') + '1' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')).slice(0, 44).padEnd(44, '0')
  const tot = items.reduce((a, i) => a + i.qty * i.price, 0).toFixed(2)
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${k}" versao="4.00">
<ide><mod>55</mod><serie>1</serie><nNF>${nNF}</nNF><dhEmi>${today}T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${emit}</CNPJ><xNome>${name}</xNome><enderEmit><UF>${head.uf}</UF></enderEmit></emit><dest><CNPJ>${head.document}</CNPJ></dest>
${items.map((i, n) => `<det nItem="${n + 1}"><prod><cProd>${i.code}</cProd><cEAN>SEM GTIN</cEAN><xProd>${i.desc}</xProd><NCM>84672100</NCM><CFOP>${i.cfop ?? '5102'}</CFOP><uCom>UN</uCom><qCom>${i.qty}</qCom><vUnCom>${i.price}</vUnCom><vProd>${(i.qty * i.price).toFixed(2)}</vProd></prod></det>`).join('')}
<total><ICMSTot><vNF>${tot}</vNF></ICMSTot></total>${dups}</infNFe></NFe><protNFe><infProt><chNFe>${k}</chNFe></infProt></protNFe></nfeProc>`
}
// Remessa para conserto: TES sem estoque e sem financeiro
const supC = await call(admin, 'POST', '/suppliers', { cnpj: cnpj(r12()), name: 'Assistência ' + run, uf: head.uf })
let pre = await call(admin, 'POST', '/invoices/import', { xml: mkXml(supC.cnpj, supC.name, 501, [{ code: 'X1', desc: 'FURADEIRA CONSERTADA', qty: 1, price: 150, cfop: '5916' }]) })
assert.equal(pre.status, 'pre_nota'); assert.equal(pre.operationLabel.slice(0, 3), 'E01')
pre = await call(tFis, 'PUT', `/invoices/${pre.id}`, { items: [{ id: pre.items[0].id, productId: prodA.id, tesId: tesNo.id }] })
assert.equal(pre.items[0].tesId, tesNo.id); assert.equal(pre.items[0].entryCfop, '1915')
assert.equal(pre.preview.stockItems, 0); assert.equal(pre.preview.financialAmount, 0)
const stockBeforeA = Number((await call(admin, 'GET', `/products/${prodA.id}`)).stock)
pre = await call(tFis, 'POST', `/invoices/${pre.id}/classify`)
assert.equal(Number((await call(admin, 'GET', `/products/${prodA.id}`)).stock), stockBeforeA)
assert.equal(pre.titles.length, 0)
ok('pré-nota com TES de remessa (sem estoque e sem financeiro): classificada sem mexer em estoque nem gerar título')

// Devolução de venda: o cliente devolve 1 furadeira → estoque volta e gera NCC no contas a receber
const summaryBefore = await call(tFin, 'GET', '/finance/summary')
await call(admin, 'POST', '/suppliers', { cnpj: custSP.document, name: custSP.name, uf: head.uf }).catch(() => null)
pre = await call(admin, 'POST', '/invoices/import', { xml: mkXml(custSP.document, custSP.name, 77, [{ code: 'VA', desc: 'FURADEIRA 500W DEVOLUCAO', qty: 1, price: 210, cfop: '5202' }]) })
pre = await call(tFis, 'PUT', `/invoices/${pre.id}`, { operationTypeId: opE05.id, items: [{ id: pre.items[0].id, productId: prodA.id }] })
assert.equal(pre.isReturn, true); assert.equal(pre.items[0].tesLabel.slice(0, 3), '004'); assert.equal(pre.items[0].entryCfop, '1202')
assert.equal(pre.preview.financialKind, 'NCC'); assert.equal(pre.preview.financialAmount, 210)
const costA = Number((await call(admin, 'GET', `/products/${prodA.id}`)).costPrice)
pre = await call(tFis, 'POST', `/invoices/${pre.id}/classify`)
const afterA = await call(admin, 'GET', `/products/${prodA.id}`)
assert.equal(Number(afterA.stock), stockBeforeA + 1); assert.equal(Number(afterA.costPrice), costA, 'devolução não muda o custo médio')
assert.equal(pre.titles.length, 1); assert.equal(pre.titles[0].kind, 'R'); assert.equal(pre.titles[0].docType, 'NCC')
const summaryAfter = await call(tFin, 'GET', '/finance/summary')
assert.equal(Math.round((summaryBefore.receivable - summaryAfter.receivable) * 100) / 100, 210, 'NCC abate o contas a receber')
const ncc = (await call(tFin, 'GET', `/finance/titles?kind=R&q=${encodeURIComponent('Crédito de devolução NF 77')}`))[0]
assert.equal(ncc.docType, 'NCC'); assert.equal(ncc.partner, custSP.name)
const bankBefore = (await call(tFin, 'GET', '/finance/bank-balances')).find((b) => b.id === bank.id).balance
await call(tFin, 'POST', `/finance/titles/${ncc.id}/pay`, { bankAccountId: bank.id, paidAt: today, amount: 210 })
assert.equal((await call(tFin, 'GET', '/finance/bank-balances')).find((b) => b.id === bank.id).balance, Math.round((bankBefore - 210) * 100) / 100, 'devolver o dinheiro ao cliente é saída')
ok('devolução de venda (E05/TES 004): estoque volta pelo custo atual, NCC de R$ 210 abate o contas a receber e, ao devolver o dinheiro, sai do banco')

// Devolução de compra: devolvemos 5 brocas ao fornecedor → estoque sai e gera NDF no contas a pagar
const custFromSup = await call(admin, 'POST', '/catalog/customers', { document: supNf.cnpj, name: supNf.name, uf: head.uf, taxpayer: '1', ie: IE[head.uf] })
const payBefore = (await call(tFin, 'GET', '/finance/summary')).payable
const ret = await call(tVend, 'POST', '/sales-orders', { customerId: custFromSup.id, operationTypeId: opS03.id, paymentTermId: vista.id, items: [{ productId: prodB.id, quantity: 5, unitPrice: 4 }] })
assert.equal(ret.items[0].cfop, '5202')
const retNf = await call(tFat, 'POST', `/sales-orders/${ret.id}/invoice`)
assert.equal(retNf.titles.length, 1); assert.equal(retNf.titles[0].kind, 'P'); assert.equal(retNf.titles[0].docType, 'NDF')
assert.equal(Math.round((payBefore - (await call(tFin, 'GET', '/finance/summary')).payable) * 100) / 100, 20, 'NDF abate o contas a pagar')
ok('devolução de compra (S03/TES 503): estoque sai e NDF de R$ 20 abate o contas a pagar do fornecedor')

// Impostos com regra na matriz: IPI + ICMS-ST para um produto específico
const prodST = await call(admin, 'POST', '/products', { sku: `ST-${run}`, name: 'Pneu aro 14', unit: 'UN', ncm: '40111000', costPrice: 200, salePrice: 400, stock: 20 })
const ruleIpi = await call(tFis, 'POST', '/catalog/tax-rules', { tax: 'IPI', name: 'IPI pneu ' + run, productId: prodST.id, cst: '50', rate: 10 })
const ruleIcms = await call(tFis, 'POST', '/catalog/tax-rules', { tax: 'ICMS', name: 'ICMS c/ ST pneu ' + run, productId: prodST.id, cst: '10' })
const ruleSt = await call(tFis, 'POST', '/catalog/tax-rules', { tax: 'ICMS_ST', name: 'ST pneu ' + run, productId: prodST.id, cst: '10', mva: 42 })
await call(tVend, 'POST', '/catalog/tax-rules', { tax: 'IPI', name: 'x', cst: '50' }, 403)
const pv = await call(tVend, 'POST', '/sales/preview', { customerId: custSP.id, paymentTermId: vista.id, items: [{ productId: prodST.id, quantity: 1 }] })
const it = pv.items[0].taxes
const internal = (await call(admin, 'GET', '/catalog/uf-icms')).find((u) => u.uf === head.uf).internalRate
assert.equal(it.ipi.value, 40); assert.equal(it.icms.value, Math.round(400 * internal) / 100)
assert.equal(it.st.base, Math.round(440 * 1.42 * 100) / 100)
assert.equal(it.st.value, Math.round((Math.round(440 * 1.42 * 100) / 100 * internal / 100 - Math.round(400 * internal) / 100) * 100) / 100)
assert.equal(pv.totals.total, Math.round((400 + 40 + it.st.value) * 100) / 100)
const stOrder = await call(tVend, 'POST', '/sales-orders', { customerId: custSP.id, paymentTermId: vista.id, items: [{ productId: prodST.id, quantity: 1 }] })
const stNf = await call(tFat, 'POST', `/sales-orders/${stOrder.id}/invoice`)
assert.equal(stNf.total, pv.totals.total); assert.equal(stNf.titles[0].amount, pv.totals.total, 'cliente paga IPI e ST na duplicata')
assert.equal(stNf.items[0].taxes.st.value, it.st.value)
for (const r of [ruleIpi, ruleIcms, ruleSt]) await call(tFis, 'PATCH', `/catalog/tax-rules/${r.id}`, { active: false })
ok(`matriz de impostos: IPI 10% = 40, ICMS ${internal}%, ST com MVA 42% = ${it.st.value}; total da nota ${stNf.total} (IPI e ST cobrados na duplicata)`)

// Parâmetros: MV_ESTNEG libera faturar sem estoque
await call(tVend, 'GET', '/parameters', undefined, 403)
const paramsList = await call(admin, 'GET', '/parameters')
assert.equal(paramsList.find((x) => x.key === 'MV_ESTNEG').value, false)
await call(admin, 'PUT', '/parameters', { MV_ESTNEG: 'sim' }, 400)
await call(admin, 'PUT', '/parameters', { MV_ESTNEG: true })
const neg = await call(tVend, 'POST', '/sales-orders', { customerId: custSP.id, paymentTermId: vista.id, items: [{ productId: prodST.id, quantity: 999 }] })
await call(tFat, 'POST', `/sales-orders/${neg.id}/invoice`)
await call(admin, 'PUT', '/parameters', { MV_ESTNEG: false })
const neg2 = await call(tVend, 'POST', '/sales-orders', { customerId: custSP.id, paymentTermId: vista.id, items: [{ productId: prodST.id, quantity: 999 }] })
await call(tFat, 'POST', `/sales-orders/${neg2.id}/invoice`, undefined, 400)
ok('parâmetro MV_ESTNEG: ligado fatura sem estoque; desligado bloqueia')

// BI
await call(tFin, 'GET', '/bi/overview', undefined, 403)
const bi = await call(tBi, 'GET', `/bi/overview?from=${today}&to=${today}`)
assert.ok(bi.kpis.revenue >= 675.5, JSON.stringify(bi.kpis))
assert.ok(bi.kpis.grossMarginPct > 0 && bi.kpis.grossMarginPct < 100)
assert.ok(bi.topProducts.some((p) => p.sku === `VA-${run}`))
assert.ok(bi.byUf.length >= 1 && bi.bySeller.some((s) => s.label === `Vendedor ${run}`))
assert.equal(bi.monthly.length, 1)
assert.ok(bi.abc.find((a) => a.curve === 'A').count >= 1)
const year = await call(tBi, 'GET', '/bi/overview')
assert.equal(year.monthly.length, 12)
ok(`BI: faturamento R$ ${bi.kpis.revenue.toFixed(2)}, margem ${bi.kpis.grossMarginPct}%, curva ABC, clientes, UF e vendedores; 12 meses por padrão`)

console.log(`\n${passed} verificações passaram`)
