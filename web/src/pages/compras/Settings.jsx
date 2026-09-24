import { useState } from 'react'
import { api } from '../../api.js'
import Icon from '../../components/Icon.jsx'
import { Modal, money, parseNumber, toInput, useAction, useApi } from '../../ui.jsx'

// Seleção de vários usuários por checkbox.
function UserChecks({ users, value, onChange, filter }) {
  const list = users?.filter((u) => u.active && (u.role === 'admin' || !filter || u.permissions.includes(filter))) ?? []
  return (
    <div className="checks-grid">
      {list.map((u) => (
        <label key={u.id} className="check">
          <input type="checkbox" checked={value.includes(u.id)} onChange={() => onChange(value.includes(u.id) ? value.filter((x) => x !== u.id) : [...value, u.id])} />
          {u.name}
        </label>
      ))}
      {!list.length && <p className="muted small">Nenhum usuário com o perfil "{filter}". Cadastre em Usuários.</p>}
    </div>
  )
}

export default function Settings() {
  const groups = useApi('/purchase-groups')
  const approvals = useApi('/approval-groups')
  const users = useApi('/users')
  const [editGroup, setEditGroup] = useState(null)
  const [editApproval, setEditApproval] = useState(null)

  return (
    <>
      <section className="section">
        <div className="toolbar">
          <div>
            <h2>Grupos de compras</h2>
            <p className="muted small">Cada solicitação vai para um grupo; os compradores do grupo fazem a cotação e o pedido.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setEditGroup({})}><Icon name="plus" size={18} /> Novo grupo</button>
        </div>
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Grupo</th><th>Compradores</th><th>Aprovação</th><th /></tr></thead>
            <tbody>
              {groups.data?.map((g) => (
                <tr key={g.id} className={g.active ? '' : 'inactive'}>
                  <td data-label="Grupo">{g.name}</td>
                  <td data-label="Compradores">{g.buyers.map((b) => b.name).join(', ') || '—'}</td>
                  <td data-label="Aprovação">{g.approvalGroupName ?? <span className="muted">Sem alçada (pedido já nasce aprovado)</span>}</td>
                  <td className="actions"><button className="icon-btn" onClick={() => setEditGroup(g)} aria-label="Editar"><Icon name="edit" size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {groups.data?.length === 0 && <p className="empty">Crie o primeiro grupo de compras.</p>}
        </div>
      </section>

      <section className="section">
        <div className="toolbar">
          <div>
            <h2>Grupos de aprovação (alçadas)</h2>
            <p className="muted small">O pedido sobe nível a nível até chegar num limite que cubra o valor. Qualquer aprovador do nível pode aprovar.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setEditApproval({})}><Icon name="plus" size={18} /> Nova alçada</button>
        </div>
        <div className="grid-cards">
          {approvals.data?.map((a) => (
            <div key={a.id} className="card pad">
              <div className="row-between">
                <strong>{a.name}</strong>
                <button className="icon-btn" onClick={() => setEditApproval(a)} aria-label="Editar"><Icon name="edit" size={16} /></button>
              </div>
              <ol className="levels">
                {a.levels.map((l) => (
                  <li key={l.level}>
                    <span className="level-num">{l.level}</span>
                    <div>
                      <strong>{l.limitAmount === null ? 'Sem limite' : `Até ${money(l.limitAmount)}`}</strong>
                      <small className="muted">{l.users.map((u) => u.name).join(', ')}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {approvals.data?.length === 0 && <p className="muted">Nenhuma alçada cadastrada.</p>}
        </div>
      </section>

      {editGroup && (
        <GroupForm group={editGroup} users={users.data} approvals={approvals.data} onClose={() => setEditGroup(null)} onSaved={() => { setEditGroup(null); groups.reload() }} />
      )}
      {editApproval && (
        <ApprovalForm group={editApproval} users={users.data} onClose={() => setEditApproval(null)} onSaved={() => { setEditApproval(null); approvals.reload(); groups.reload() }} />
      )}
    </>
  )
}

function GroupForm({ group, users, approvals, onClose, onSaved }) {
  const [name, setName] = useState(group.name ?? '')
  const [approvalGroupId, setApprovalGroupId] = useState(group.approvalGroupId ?? '')
  const [buyerIds, setBuyerIds] = useState(group.buyers?.map((b) => b.id) ?? [])
  const [active, setActive] = useState(group.active ?? true)
  const { busy, error, run } = useAction()

  const submit = (e) => {
    e.preventDefault()
    run(async () => {
      const body = { name, approvalGroupId: approvalGroupId || null, buyerIds, active }
      await api(group.id ? `/purchase-groups/${group.id}` : '/purchase-groups', { method: group.id ? 'PUT' : 'POST', body })
      onSaved()
    })
  }
  return (
    <Modal title={group.id ? 'Editar grupo de compras' : 'Novo grupo de compras'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>Nome<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Materiais de manutenção" autoFocus /></label>
        <label>Alçada de aprovação dos pedidos
          <select value={approvalGroupId} onChange={(e) => setApprovalGroupId(e.target.value)}>
            <option value="">Sem aprovação</option>
            {approvals?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <fieldset className="checks"><legend>Compradores</legend><UserChecks users={users} value={buyerIds} onChange={setBuyerIds} filter="comprador" /></fieldset>
        {group.id && <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Grupo ativo</label>}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  )
}

function ApprovalForm({ group, users, onClose, onSaved }) {
  const [name, setName] = useState(group.name ?? '')
  const [levels, setLevels] = useState(
    group.levels?.map((l) => ({ limit: toInput(l.limitAmount), userIds: l.users.map((u) => u.id) })) ?? [{ limit: '', userIds: [] }],
  )
  const { busy, error, setError, run } = useAction()
  const update = (i, patch) => setLevels(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const submit = (e) => {
    e.preventDefault()
    const body = { name, levels: levels.map((l, i) => ({ level: i + 1, limitAmount: l.limit.trim() ? parseNumber(l.limit) : null, userIds: l.userIds })) }
    if (body.levels.some((l) => Number.isNaN(l.limitAmount))) return setError('Limite inválido')
    run(async () => {
      await api(group.id ? `/approval-groups/${group.id}` : '/approval-groups', { method: group.id ? 'PUT' : 'POST', body })
      onSaved()
    })
  }
  const remove = () => run(async () => { await api(`/approval-groups/${group.id}`, { method: 'DELETE' }); onSaved() })

  return (
    <Modal title={group.id ? 'Editar alçada' : 'Nova alçada'} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <label>Nome<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Alçada padrão" autoFocus /></label>
        {levels.map((l, i) => (
          <fieldset key={i} className="level-box">
            <legend>Nível {i + 1}</legend>
            <div className="row-between">
              <label className="grow">Aprova pedidos até (R$) — vazio = sem limite
                <input value={l.limit} onChange={(e) => update(i, { limit: e.target.value })} inputMode="decimal" placeholder={i === levels.length - 1 ? 'Sem limite' : '0,00'} />
              </label>
              {levels.length > 1 && <button type="button" className="icon-btn danger" onClick={() => setLevels(levels.filter((_, j) => j !== i))} aria-label="Remover nível"><Icon name="trash" size={16} /></button>}
            </div>
            <UserChecks users={users} value={l.userIds} onChange={(userIds) => update(i, { userIds })} filter="aprovador" />
          </fieldset>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => setLevels([...levels, { limit: '', userIds: [] }])}><Icon name="plus" size={16} /> Adicionar nível</button>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          {group.id && <button type="button" className="btn btn-ghost danger-text" onClick={remove} disabled={busy}>Excluir alçada</button>}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  )
}
