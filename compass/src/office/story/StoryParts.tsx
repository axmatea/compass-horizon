import { CHANGES, MEMORY, SOURCE_TEXT } from './content';

export function PlanTrace() {
  return <div className="os-plan-wrap">
    <table className="os-plan">
      <caption>Harbor studio / proposed schedule / September 30 to October 2, 2026</caption>
      <thead><tr><th scope="col">Work &amp; responsibility</th><th scope="col">Before</th><th scope="col">Proposed plan</th></tr></thead>
      <tbody>{CHANGES.map(change => <tr key={change.name} data-state={change.kind}><th scope="row"><strong>{change.name}</strong><span>{change.owner}</span></th><td>{change.before}</td><td><strong>{change.after}</strong><span>{change.kind === 'changed' ? 'Supplier change' : change.kind === 'unchanged' ? 'Unchanged' : 'Awaiting Maya\'s approval'}</span></td></tr>)}</tbody>
    </table>
  </div>;
}

export function SourceNote({ expanded = false }: { expanded?: boolean }) {
  return <details className="os-source" open={expanded || undefined}>
    <summary>Read original supplier note <span aria-hidden="true">+</span></summary>
    <div><p className="of-kicker">Source history / fictional supplier update</p><blockquote>{SOURCE_TEXT}</blockquote><p className="os-fine">Original example text retained. This is not an imported message or a live supplier conversation.</p></div>
  </details>;
}

export function MemoryList() {
  return <dl className="os-memory-list">{MEMORY.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function Coordination() {
  return <div className="os-coordination">
    <div className="os-meeting-line"><span className="os-person-name">Noa<small>Operations / supplier handover</small></span><div className="os-meeting-bridge"><span>10 min</span><small>Proposed, not booked</small></div><span className="os-person-name">Leo<small>Build &amp; systems / installation and validation</small></span></div>
    <div className="os-coordination-foot"><p><strong>Maya</strong> retains owner approval.</p><p><strong>Esra · Ravi · Sam</strong> keep their plan unchanged.</p></div>
  </div>;
}
