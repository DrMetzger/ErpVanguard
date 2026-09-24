import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../api.js'
import { date, money, parseNumber, price, qty, Status, Tabs, toInput, useAction, useApi } from '../../ui.jsx'

export default function QuotationDetail() {
  const { id } = useParams()
  const { data: q, error, setData } = useApi(`/quotations/${id}`)
  const [tab, setTab] = useState('precos')
  const [form, setForm] = useState(null)
  const [choices, setChoices] = useState({})
  const [result, setResult] = useState(null)
  const [addId, setAddId] = useState('')
  const suppliers = useApi('/suppliers')
  const action = useAction()

  // Estado editável a partir da cotação carregada.
  useEffect(() => {
    if (!q) return
    setForm(Object.fromEntries(q.suppliers.map((s) => [s.id, {
      paymentTerms: s.paymentTerms ?? '', deliveryDays: s.deliveryDays ?? '', freight: toInput(s.freight || ''),
      prices: Object.fromEntries(q.items.map((i) => [i.id, toInput(i.prices.find((p) => p.quotationSupplierId === s.id)?.unitPrice)])),
    }])))
  }, [q])

  const open = q?.status === 'aberta'
  const num = (v) => { const n = parseNumber(v); return n === undefined || Number.isNaN(n) ? null : n }

  // Mapa comparativo calculado com o que está digitado na tela.
  const analysis = useMemo(() => {
    if (!q || !form) return null
    const items = q.items.map((i) => {
      const prices = q.suppliers.map((s) => ({ sid: s.id, value: num(form[s.id]?.prices[i.id]) }))
      const quoted = prices.filter((p) => p.value !== null)
      const best = quoted.length ? Math.min(...quoted.map((p) => p.value)) : null
      return { ...i, cells: prices, best, bestIds: prices.filter((p) => p.value === best && best !== null).map((p) => p.sid) }
    })
    const totals = q.suppliers.map((s) => {
      const lines = items.map((i) => (i.cells.find((c) => c.sid === s.id).value ?? 0) * i.quantity)
      const freight = num(form[s.id]?.freight) ?? 0
      return { sid: s.id, items: lines.reduce((a, b) => a + b, 0), freight, quoted: items.filter((i) => i.cells.find((c) => c.sid === s.id).value !== null).length }
    })
    return { items, totals }
  }, [q, form])

  // Vencedor: o escolhido pelo comprador (se ainda tiver preço) ou o menor preço do item.
  const winners = useMemo(() => {
    if (!analysis) return {}
    return Object.fromEntries(analysis.items.map((i) => {
      const manual = choices[i.id]
      const valid = manual && i.cells.some((c) => c.sid === manual && c.value !== null)
      return [i.id, valid ? manual : i.bestIds[0] ?? null]
    }))
  }, [analysis, choices])

  if (error) return <p className="error">{error}</p>
  if (!q || !form) return <p className="muted">Carregando…</p>

  const setSup = (sid, patch) => setForm({ ...form, [sid]: { ...form[sid], ...patch } })
  const setPrice = (sid, iid, value) => setSup(sid, { prices: { ...form[sid].prices, [iid]: value } })

  const body = () => ({
    suppliers: q.suppliers.map((s) => ({
      quotationSupplierId: s.id,
      paymentTerms: form[s.id].paymentTerms || undefined,
      deliveryDays: form[s.id].deliveryDays === '' ? null : Number(form[s.id].deliveryDays),
      freight: num(form[s.id].freight) ?? 0,
      prices: q.items.map((i) => ({ quotationItemId: i.id, unitPrice: num(form[s.id].prices[i.id]) })),
    })),
  })
  const save = () => action.run(async () => setData(await api(`/quotations/${id}/responses`, { method: 'PUT', body: body() })))
  const addSupplier = () => addId && action.run(async () => { await api(`/quotations/${id}/responses`, { method: 'PUT', body: body() }); setData(await api(`/quotations/${id}/suppliers`, { method: 'POST', body: { supplierId: addId } })); setAddId('') })
  const close = () => {
    const list = Object.entries(winners).filter(([, sid]) => sid).map(([quotationItemId, quotationSupplierId]) => ({ quotationItemId, quotationSupplierId }))
    if (!list.length) return action.setError('Escolha o vencedor de pelo menos um item')
    if (!confirm(`Gerar ${new Set(list.map((w) => w.quotationSupplierId)).size} pedido(s) de compra?`)) return
    action.run(async () => {
      await api(`/quotations/${id}/responses`, { method: 'PUT', body: body() })
      const res = await api(`/quotations/${id}/close`, { method: 'POST', body: { winners: list } })
      setData(res.quotation)
      setResult(res.orders)
    })
  }
  const cancel = () => confirm('Cancelar esta cotação? Os itens voltam para "pendente".') && action.run(async () => setData(await api(`/quotations/${id}/cancel`, { method: 'POST' })))

  // Pedidos que serão gerados com os vencedores escolhidos.
  const preview = q.suppliers.map((s) => {
    const won = analysis.items.filter((i) => winners[i.id] === s.id)
    const value = won.reduce((sum, i) => sum + i.cells.find((c) => c.sid === s.id).value * i.quantity, 0)
    return { s, count: won.length, total: won.length ? value + (num(form[s.id].freight) ?? 0) : 0 }
  }).filter((p) => p.count)

  return (
    <>
      <div className="page-head">
        <div>
          <Link to=".." relative="path" className="back">← Cotações</Link>
          <h2 className="title">{q.code} <Status value={q.status} /></h2>
          <p className="muted small">{q.purchaseGroupName} · comprador {q.buyerName} · prazo {date(q.deadline)}</p>
        </div>
        {open && <div className="row-gap"><button className="btn btn-ghost danger-text" onClick={cancel} disabled={action.busy}>Cancelar cotação</button><button className="btn btn-ghost" onClick={save} disabled={action.busy}>Salvar preços</button></div>}
      </div>

      {result && (
        <div className="card pad success-box">
          <strong>Pedidos gerados:</strong>
          <ul>{result.map((o) => <li key={o.id}><Link to={`../../pedidos/${o.id}`} relative="path">{o.code}</Link> · {o.supplierName} · {money(o.total)} · <Status value={o.status} /></li>)}</ul>
        </div>
      )}

      <Tabs tabs={[['precos', '1. Preços dos fornecedores'], ['analise', '2. Análise e pedido']]} value={tab} onChange={setTab} />
      {action.error && <p className="error">{action.error}</p>}

      {tab === 'precos' && (
        <div className="card table-wrap keep-table">
          <table className="grid-table">
            <thead>
              <tr><th>Item</th><th className="num">Qtd.</th>{q.suppliers.map((s) => <th key={s.id} className="num supplier-col">{s.name}</th>)}</tr>
            </thead>
            <tbody>
              {q.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.sku && <strong>{i.sku} · </strong>}{i.description}<small className="muted block">{i.requestCode}</small></td>
                  <td className="num">{qty(i.quantity)} {i.unit}</td>
                  {q.suppliers.map((s) => (
                    <td key={s.id} className="num">
                      <input className="cell" inputMode="decimal" disabled={!open} placeholder="não cotou" value={form[s.id].prices[i.id]} onChange={(e) => setPrice(s.id, i.id, e.target.value)} aria-label={`Preço unitário ${s.name} ${i.description}`} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="sub"><td colSpan={2}>Frete (R$)</td>{q.suppliers.map((s) => <td key={s.id}><input className="cell" inputMode="decimal" disabled={!open} value={form[s.id].freight} onChange={(e) => setSup(s.id, { freight: e.target.value })} placeholder="0,00" /></td>)}</tr>
              <tr className="sub"><td colSpan={2}>Prazo de entrega (dias)</td>{q.suppliers.map((s) => <td key={s.id}><input className="cell" inputMode="numeric" disabled={!open} value={form[s.id].deliveryDays} onChange={(e) => setSup(s.id, { deliveryDays: e.target.value.replace(/\D/g, '') })} /></td>)}</tr>
              <tr className="sub"><td colSpan={2}>Condição de pagamento</td>{q.suppliers.map((s) => <td key={s.id}><input className="cell text" disabled={!open} value={form[s.id].paymentTerms} onChange={(e) => setSup(s.id, { paymentTerms: e.target.value })} placeholder="28 dias" /></td>)}</tr>
            </tbody>
          </table>
          {open && (
            <div className="row-gap pad">
              <select value={addId} onChange={(e) => setAddId(e.target.value)} className="filter">
                <option value="">Adicionar fornecedor…</option>
                {suppliers.data?.filter((s) => s.active && !q.suppliers.some((x) => x.supplierId === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="btn btn-ghost" onClick={addSupplier} disabled={!addId || action.busy}>Adicionar</button>
              <button className="btn btn-primary push" onClick={() => { save(); setTab('analise') }} disabled={action.busy}>Salvar e analisar →</button>
            </div>
          )}
        </div>
      )}

      {tab === 'analise' && (
        <>
          <div className="card table-wrap keep-table">
            <table className="grid-table">
              <thead>
                <tr><th>Item</th><th className="num">Qtd.</th>{q.suppliers.map((s) => <th key={s.id} className="num supplier-col">{s.name}</th>)}</tr>
              </thead>
              <tbody>
                {analysis.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.description}</td>
                    <td className="num">{qty(i.quantity)} {i.unit}</td>
                    {i.cells.map((c) => (
                      <td key={c.sid} className={`num pick ${i.bestIds.includes(c.sid) ? 'best' : ''} ${winners[i.id] === c.sid ? 'chosen' : ''}`}>
                        {c.value === null ? <span className="muted">—</span> : (
                          <label>
                            <input type="radio" name={`w-${i.id}`} disabled={!open} checked={winners[i.id] === c.sid} onChange={() => setChoices({ ...choices, [i.id]: c.sid })} />
                            <span>{price(c.value)}<small className="block muted">{money(c.value * i.quantity)}</small></span>
                          </label>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="sub"><td colSpan={2}>Itens cotados</td>{analysis.totals.map((t) => <td key={t.sid} className="num">{t.quoted}/{q.items.length}</td>)}</tr>
                <tr className="sub"><td colSpan={2}>Frete</td>{analysis.totals.map((t) => <td key={t.sid} className="num">{money(t.freight)}</td>)}</tr>
                <tr className="sub"><td colSpan={2}>Prazo · pagamento</td>{q.suppliers.map((s) => <td key={s.id} className="num small">{form[s.id].deliveryDays !== '' ? `${form[s.id].deliveryDays} dias` : '—'} · {form[s.id].paymentTerms || '—'}</td>)}</tr>
                <tr className="total"><td colSpan={2}>Total se comprar tudo</td>{analysis.totals.map((t) => <td key={t.sid} className="num">{t.quoted === q.items.length ? money(t.items + t.freight) : <span className="muted">incompleto</span>}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">Verde = menor preço do item. O vencedor já vem marcado no menor preço; troque se preferir outro fornecedor (prazo, condição de pagamento, qualidade).</p>
          {open && (
            <div className="card pad">
              <h3>Pedidos que serão gerados</h3>
              {preview.length ? (
                <ul className="plain">{preview.map((p) => <li key={p.s.id}><strong>{p.s.name}</strong> · {p.count} item(ns) · {money(p.total)}</li>)}</ul>
              ) : <p className="muted">Nenhum vencedor escolhido.</p>}
              {analysis.items.some((i) => !winners[i.id]) && <p className="muted small">Itens sem vencedor voltam para "pendente" e podem entrar em outra cotação.</p>}
              <button className="btn btn-primary" onClick={close} disabled={action.busy || !preview.length}>{action.busy ? 'Gerando…' : 'Gerar pedidos de compra'}</button>
            </div>
          )}
        </>
      )}
    </>
  )
}
