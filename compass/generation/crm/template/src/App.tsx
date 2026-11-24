import {useCallback, useEffect, useRef, useState} from 'react';
import {Dashboard} from './Dashboard';
import {RecordEditor} from './Editor';
import {entities, names, recordDetails, recordName, stageLabel, stages} from './presentation';
import type {CrmClient, CrmConfig, CrmRow, DealStage, Entity, Records} from './types';

type Route = Entity | 'overview' | 'revenue';
const routes: {id: Route; label: string}[] = [
  {id: 'overview', label: 'Overview'}, {id: 'clients', label: 'Clients'}, {id: 'contacts', label: 'Contacts'},
  {id: 'deals', label: 'Pipeline'}, {id: 'tasks', label: 'Follow-ups'},
  {id: 'proposals', label: 'Proposals'}, {id: 'revenue', label: 'Revenue'},
];
const emptyRecords: Records = {clients: [], contacts: [], deals: [], tasks: [], proposals: []};
type Selection = {entity: Entity; row?: CrmRow};
const message = (error: unknown) => error instanceof Error ? error.message : 'The request could not finish.';
const routeAddress = () => routes.find(item => '#' + item.id === window.location.hash)?.id || 'overview';

export function App({client, config, signOut}: {client: CrmClient; config: CrmConfig; signOut?: () => Promise<void>}) {
  const [route, setRoute] = useState<Route>(signOut ? routeAddress : 'overview');
  const [records, setRecords] = useState<Records>(emptyRecords);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setProblem('');
    try {
      const entries = await Promise.all(entities.map(async entity => [entity, (await client.list(entity)).records] as const));
      if (loadVersion.current === version) {
        setRecords(Object.fromEntries(entries) as Records);
        setLoaded(true);
      }
    } catch (error) {
      if (loadVersion.current === version) setProblem(message(error));
    } finally {
      if (loadVersion.current === version) setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    void load();
    return () => {loadVersion.current++;};
  }, [load]);
  useEffect(() => {
    if (!signOut) return;
    const follow = () => {setRoute(routeAddress());setSearch('');};
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [signOut]);

  function navigate(destination: Route) {
    setRoute(destination);
    setSearch('');
    setNotice('');
    if (signOut) window.location.hash = destination;
  }
  async function save(entity: Entity, data: CrmRow['data'], row?: CrmRow) {
    const {record} = await client.save(entity, data, row);
    setRecords(before => ({...before, [entity]: [record, ...before[entity].filter(item => item.id !== record.id)]}));
    setNotice(row ? 'Record updated.' : 'Record created.');
  }
  async function remove(entity: Entity, row: CrmRow) {
    await client.delete(entity, row);
    setRecords(before => ({...before, [entity]: before[entity].filter(item => item.id !== row.id)}));
    setNotice('Record deleted.');
  }
  async function change(entity: Entity, row: CrmRow, data: CrmRow['data']) {
    if (changing) return;
    setChanging(row.id);
    setProblem('');
    try {await save(entity, {...row.data, ...data}, row);}
    catch (error) {setProblem(message(error));}
    finally {setChanging(null);}
  }

  const isDashboard = route === 'overview' || route === 'revenue';
  const label = routes.find(item => item.id === route)?.label || 'Overview';
  const rows = isDashboard ? [] : records[route].filter(row =>
    [recordName(row), ...recordDetails(route,row,records,config)].join(' ').toLowerCase().includes(search.toLowerCase().trim()));
  const prerequisite = route === 'proposals' && !records.deals.length ? 'deal' :
    ['contacts','deals','tasks'].includes(route) && !records.clients.length ? 'client' : null;
  return <main className="crm" data-mode={config.theme.mode} data-accent={config.theme.accent} data-font={config.theme.font} data-density={config.theme.density}>
    <header className="top">
      <div className="brand"><span className="brand-mark" aria-hidden="true"></span><h1>{config.title}</h1></div>
      {signOut && <button className="button quiet" type="button" onClick={() => void signOut().catch(error => setProblem(message(error)))}>Sign out</button>}
    </header>
    <nav className="navigation" aria-label="CRM pages">
      {routes.map(item => <button key={item.id} type="button" aria-current={route === item.id ? 'page' : undefined}
        onClick={() => navigate(item.id)}>{item.label}</button>)}
    </nav>
    <div className="content">
      <div className="heading">
        <h2>{label}</h2>
        {loaded && !isDashboard && <button type="button" className="button primary" disabled={loading || Boolean(prerequisite)}
          onClick={() => setSelected({entity: route})}>New {names[route].toLowerCase()}</button>}
      </div>
      {problem && <p className="problem" role="alert">{problem}</p>}
      <p className="sr-only" role="status">{loading ? 'Loading records…' : notice}</p>
      {!loaded ? <div className="sheet empty" aria-busy={loading}>
        {loading ? 'Loading records…' : <button type="button" className="button" onClick={() => void load()}>Retry</button>}
      </div> : isDashboard ? <Dashboard records={records} config={config} revenue={route === 'revenue'}/> :
        <>
          <div className="filters">
            <label className="search"><span className="sr-only">Search {label.toLowerCase()}</span>
              <input type="search" value={search} onChange={event => setSearch(event.currentTarget.value)} placeholder={'Search ' + label.toLowerCase() + '…'}/>
            </label>
            <button type="button" className="button" disabled={loading || Boolean(changing)} onClick={() => void load()}>Refresh</button>
          </div>
          {prerequisite ? <p className="sheet empty">Add a {prerequisite} to get started.</p> :
            route === 'deals' ? <div className="pipeline" aria-label="Deal stages">
              {stages.map(stage => {
                const deals = rows.filter(row => row.data.stage === stage);
                return <section key={stage} className="stage">
                  <h3>{stageLabel(config, stage)} <span>{deals.length}</span></h3>
                  <ul>{deals.map(row => <li key={row.id}>
                    <button type="button" className="record-title" disabled={loading || Boolean(changing)}
                      onClick={() => setSelected({entity: 'deals', row})}>{recordName(row)}</button>
                    <span>{recordDetails('deals', row, records, config).slice(0,2).filter(Boolean).join(' · ')}</span>
                    <label className="stage-picker"><span className="sr-only">Stage for {recordName(row)}</span>
                      <select value={String(row.data.stage)} disabled={loading || Boolean(changing)}
                        onChange={event => void change('deals', row, {stage: event.target.value as DealStage})}>
                        {stages.map(item => <option key={item} value={item}>{stageLabel(config,item)}</option>)}
                      </select></label>
                  </li>)}</ul>
                </section>;
              })}
            </div> : <section className="sheet record-sheet" aria-label={label + ' records'}>
              {rows.length ? <ul className="record-list">
                {rows.map(row => <li key={row.id}>
                  <div>
                    <button className="record-title" type="button" disabled={loading || Boolean(changing)}
                      onClick={() => setSelected({entity: route, row})}>{recordName(row)}</button>
                    <span>{recordDetails(route,row,records,config).filter(Boolean).join(' · ')}</span>
                  </div>
                  {route === 'tasks' ? <button type="button" className="button" disabled={loading || Boolean(changing)}
                    onClick={() => void change('tasks', row, {status: row.data.status === 'done' ? 'open' : 'done'})}>
                    {row.data.status === 'done' ? 'Reopen' : 'Complete'}
                  </button> : <button className="button" type="button" aria-label={'Edit ' + recordName(row)} disabled={loading || Boolean(changing)}
                    onClick={() => setSelected({entity: route, row})}>Edit</button>}
                </li>)}
              </ul> : <p className="empty">{search.trim() ? 'No matching records.' : 'No ' + label.toLowerCase() + ' yet.'}</p>}
            </section>}
        </>}
    </div>
    {selected && <RecordEditor key={selected.entity + ':' + (selected.row?.id || 'new')} entity={selected.entity}
      row={selected.row} records={records} config={config} close={() => setSelected(null)} save={save} remove={remove}/>}
  </main>;
}
