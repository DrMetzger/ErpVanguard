import Icon from '../components/Icon.jsx'

export default function ModuleSoon({ module }) {
  return (
    <>
      <h1>{module.title}</h1>
      <div className="card soon">
        <span className="module-icon"><Icon name={module.icon} /></span>
        <h2>Em construção</h2>
        <p className="muted">Este módulo está sendo desenvolvido. O que vem por aí:</p>
        <ul>
          {module.soon.map((item) => <li key={item}><Icon name="check" size={16} /> {item}</li>)}
        </ul>
      </div>
    </>
  )
}
