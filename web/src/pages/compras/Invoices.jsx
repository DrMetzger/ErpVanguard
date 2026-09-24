import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api.js'
import { date, money, Status, useApi } from '../../ui.jsx'

export default function Invoices() {
  const { data, error, reload } = useApi('/invoices')
  const [drag, setDrag] = useState(false)
  const [log, setLog] = useState([])
  const input = useRef(null)
  const navigate = useNavigate()

  // Importa cada XML; se for um só, já abre a conferência.
  const importFiles = async (files) => {
    const xmls = [...files].filter((f) => f.name.toLowerCase().endsWith('.xml') || f.type.includes('xml'))
    if (!xmls.length) return setLog([{ name: 'Arquivo', ok: false, message: 'Envie arquivos .xml da NF-e' }])
    const results = []
    for (const file of xmls) {
      try {
        const nf = await api('/invoices/import', { method: 'POST', body: { xml: await file.text() } })
        results.push({ name: file.name, ok: true, id: nf.id, message: `NF ${nf.number} · ${nf.supplierName}` })
      } catch (err) {
        results.push({ name: file.name, ok: false, message: err.message })
      }
      setLog([...results])
    }
    reload()
    if (results.length === 1 && results[0].ok) navigate(results[0].id)
  }

  return (
    <>
      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); importFiles(e.dataTransfer.files) }}
        onClick={() => input.current.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && input.current.click()}
      >
        <strong>Arraste os XMLs da NF-e aqui</strong>
        <span className="muted">ou clique para escolher. Pode mandar vários de uma vez.</span>
        <input ref={input} type="file" accept=".xml,text/xml,application/xml" multiple hidden onChange={(e) => { importFiles(e.target.files); e.target.value = '' }} />
      </div>
      {log.length > 0 && (
        <ul className="plain import-log">
          {log.map((l, i) => <li key={i} className={l.ok ? 'success' : 'error'}>{l.ok ? '✔' : '✖'} {l.name}: {l.message}</li>)}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Nota</th><th>Fornecedor</th><th>Emissão</th><th>Pedido</th><th className="num">Total</th><th>Situação</th></tr></thead>
          <tbody>
            {data?.map((n) => (
              <tr key={n.id} className="clickable" onClick={() => navigate(n.id)}>
                <td data-label="Nota"><strong>{n.number}</strong>{n.series && `/${n.series}`}</td>
                <td data-label="Fornecedor">{n.supplierName}</td>
                <td data-label="Emissão">{date(n.issueDate)}</td>
                <td data-label="Pedido">{n.orderCode ?? '—'}</td>
                <td data-label="Total" className="num">{money(n.total)}</td>
                <td data-label="Situação"><Status value={n.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <p className="empty">Nenhuma nota importada ainda.</p>}
      </div>
    </>
  )
}
