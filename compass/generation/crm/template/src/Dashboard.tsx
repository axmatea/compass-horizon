import type {CrmConfig, CrmRow, DealStage, Records} from './types';
import {amount, money, recordName, relationName, stageLabel, stages} from './presentation';

const total = (rows: CrmRow[]) => rows.reduce((sum, row) => sum + amount(row), 0);
const recordStage = (row: CrmRow) => row.data.stage as DealStage;

export function Dashboard({records, config, revenue}: {records: Records; config: CrmConfig; revenue: boolean}) {
  const active = records.deals.filter(row => !['won','lost'].includes(recordStage(row)));
  const won = records.deals.filter(row => recordStage(row) === 'won');
  const next = records.tasks.filter(row => row.data.status === 'open').sort((a,b) =>
    String(a.data.dueDate || '9999-12-31').localeCompare(String(b.data.dueDate || '9999-12-31'))).slice(0, 4);
  const currency = config.crm?.currency;
  const byStage = stages.map(stage => ({
    stage, value: total(records.deals.filter(row => recordStage(row) === stage)),
  }));
  const maximum = Math.max(1, ...byStage.map(row => row.value));
  return <>
    <div className="cards">
      <article className="metric"><h3>Won revenue</h3><strong>{money(total(won),currency)}</strong></article>
      <article className="metric"><h3>Open pipeline</h3><strong>{money(total(active),currency)}</strong></article>
      <article className="metric"><h3>{revenue ? 'Won deals' : 'Clients'}</h3><strong>{revenue ? won.length : records.clients.length}</strong></article>
    </div>
    <section className="sheet" aria-label={revenue ? 'Revenue by stage' : 'Upcoming follow-ups'}>
      <h3>{revenue ? 'Deal value by stage' : 'Upcoming follow-ups'}</h3>
      {revenue ? <ul className="stage-chart">
        {byStage.map(({stage, value}) => <li key={stage}>
          <span>{stageLabel(config, stage)}</span><meter min="0" max={maximum} value={value}
            aria-label={stageLabel(config, stage) + ' deal value'}/><strong>{money(value,currency)}</strong>
        </li>)}
      </ul> : next.length ? <ul className="record-list">
        {next.map(row => <li key={row.id}><div><strong>{recordName(row)}</strong>
          <span>{relationName(records.clients, row.data.clientId)}</span></div><time dateTime={String(row.data.dueDate || '')}>{row.data.dueDate || 'No date'}</time></li>)}
      </ul> : <p className="empty">No upcoming follow-ups.</p>}
    </section>
  </>;
}
