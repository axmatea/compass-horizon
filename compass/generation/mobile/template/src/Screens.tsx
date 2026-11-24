import {useState, type ReactNode} from 'react';
import {Text, View} from 'react-native';
import {onDevice} from './device';
import {Button, Card, Detail, Name, ScreenHeading, styles, usePalette} from './ui';
import {formatMoney, listOf, reminderDate, stages, summarize, type Kind, type Row, type Stage, type Task, type Workspace} from './workspace';

export type Page = 'Today' | 'Pipeline' | 'Contacts' | 'Projects' | 'Assistant' | 'Revenue';
type ScreenProps = {
  workspace: Workspace; currency: string; stageLabels: Record<Stage, string>; busy: boolean;
  pending: Set<number> | null; onEdit: (row: Row) => void; onNew: (kind: Kind) => void;
  onMove: (page: Page) => void; onComplete: (task: Task) => void; onReminder: (task: Task, pending: boolean) => void;
  onSamples: () => void; onBuilder: () => void;
};

const caption = (value: string) => value[0].toUpperCase() + value.slice(1);
const clientName = (workspace: Workspace, id: number | null) => workspace.records.find(row => row.id === id)?.title || '';

function Metric({label, value}: {label: string; value: string}) {
  const colors = usePalette();
  return <Card minWidth={115}>
    <Detail>{label}</Detail>
    <Text style={[styles.metric, {color: colors.text}]}>{value}</Text>
  </Card>;
}

function RecordCard({title, subtitle, notes, action}: {title: string; subtitle?: string; notes?: string; action: () => void}) {
  return <Card>
    <View style={[styles.row, styles.rowSpread]}><Name>{title}</Name><Button label="Edit" accessibilityLabel={'Edit ' + title} onPress={action}/></View>
    {subtitle ? <Detail>{subtitle}</Detail> : null}
    {notes ? <Detail>{notes}</Detail> : null}
  </Card>;
}

function Group({title, children}: {title: string; children: ReactNode}) {
  return <View style={{gap: 10}}><Name>{title}</Name>{children}</View>;
}

function TaskCard({task, props}: {task: Task; props: ScreenProps}) {
  const client = clientName(props.workspace, task.clientId);
  const scheduled = Boolean(props.pending?.has(task.id));
  const canSchedule = Boolean(task.category === 'follow-up' && !task.done && reminderDate(task.dueDate));
  const subtitle = [task.done ? 'Done' : caption(task.category), task.dueDate, client].filter(Boolean).join(' · ');
  return <Card>
    <Name>{task.title}</Name>
    <Detail>{subtitle}</Detail>
    {task.notes ? <Detail>{task.notes}</Detail> : null}
    <View style={styles.row}>
      <Button label={task.done ? 'Reopen' : 'Complete'} accessibilityLabel={(task.done ? 'Reopen ' : 'Complete ') + task.title}
        disabled={props.busy} onPress={() => props.onComplete(task)}/>
      <Button label="Edit" accessibilityLabel={'Edit ' + task.title} disabled={props.busy} onPress={() => props.onEdit(task)}/>
      {onDevice && (scheduled || canSchedule) ? <Button label={scheduled ? 'Cancel reminder' : 'Remind at 9:00 AM'}
        disabled={props.busy} onPress={() => props.onReminder(task, scheduled)}/> : null}
    </View>
    {scheduled ? <Detail>Reminder scheduled on this device</Detail> : null}
  </Card>;
}

export function Today(props: ScreenProps) {
  const [showAll, setShowAll] = useState(false);
  const summary = summarize(props.workspace);
  const tasks = showAll ? listOf(props.workspace, 'task') : summary.openTasks;
  const date = new Intl.DateTimeFormat(undefined, {weekday: 'long', month: 'long', day: 'numeric'}).format(new Date());
  return <>
    <ScreenHeading title="Today" subtitle={date}/>
    <View style={styles.cards}>
      <Metric label="Won revenue" value={formatMoney(summary.won, props.currency)}/>
      <Metric label="Active projects" value={String(summary.activeProjects)}/>
    </View>
    {props.workspace.nextId === 1 ? <Card>
      <Name>Start your workspace</Name>
      <Detail>Add a client or try the workflows with synthetic records.</Detail>
      <View style={styles.row}>
        <Button label="New client" kind="primary" disabled={props.busy} onPress={() => props.onNew('client')}/>
        <Button label="Load sample data" disabled={props.busy} onPress={props.onSamples}/>
      </View>
    </Card> : null}
    <View style={[styles.row, styles.rowSpread]}>
      <Name>Tasks</Name><Button label="New task" kind="primary" disabled={props.busy} onPress={() => props.onNew('task')}/>
    </View>
    <View style={styles.row}>
      <Button label="Due today" selected={!showAll} onPress={() => setShowAll(false)}/>
      <Button label="All tasks" selected={showAll} onPress={() => setShowAll(true)}/>
    </View>
    {tasks.length ? tasks.map(task => <TaskCard key={task.id} task={task} props={props}/>) :
      <Card><Detail>{showAll ? 'Add your first task.' : 'No open tasks due today.'}</Detail></Card>}
  </>;
}

export function Pipeline(props: ScreenProps) {
  const [stageFilter, setStageFilter] = useState<Stage | null>(null);
  const deals = listOf(props.workspace, 'opportunity');
  const clients = listOf(props.workspace, 'client');
  const visible = stageFilter ? deals.filter(deal => deal.stage === stageFilter) : deals;
  return <>
    <ScreenHeading title="Pipeline" subtitle={formatMoney(summarize(props.workspace).activePipeline, props.currency) + ' in active opportunities'}/>
    <View style={styles.row}>
      <Button label="New opportunity" kind="primary" disabled={props.busy || !clients.length} onPress={() => props.onNew('opportunity')}/>
      <Button label="Revenue" onPress={() => props.onMove('Revenue')}/>
    </View>
    {!clients.length ? <Card><Detail>Opportunities are attached to clients.</Detail>
      <Button label="Add a client" disabled={props.busy} onPress={() => props.onNew('client')}/></Card> : null}
    <View style={styles.row}>
      <Button label="All stages" selected={stageFilter === null} onPress={() => setStageFilter(null)}/>
      {stages.map(stage => <Button key={stage} label={props.stageLabels[stage]} selected={stageFilter === stage} onPress={() => setStageFilter(stage)}/>)}
    </View>
    {visible.length ? visible.map(deal => <RecordCard key={deal.id} title={deal.title} notes={deal.notes}
      subtitle={[props.stageLabels[deal.stage], clientName(props.workspace, deal.clientId), formatMoney(deal.valueCents, props.currency)].join(' · ')}
      action={() => props.onEdit(deal)}/>) : <Card><Detail>No opportunities in this view.</Detail></Card>}
  </>;
}

export function Contacts(props: ScreenProps) {
  const [showPeople, setShowPeople] = useState(false);
  const clients = listOf(props.workspace, 'client');
  const rows = showPeople ? listOf(props.workspace, 'contact') : clients;
  return <>
    <ScreenHeading title="Contacts"/>
    <View style={[styles.row, styles.rowSpread]}>
      <View style={styles.row}>
        <Button label="Clients" selected={!showPeople} onPress={() => setShowPeople(false)}/>
        <Button label="People" selected={showPeople} onPress={() => setShowPeople(true)}/>
      </View>
      <Button label={showPeople ? 'New contact' : 'New client'} kind="primary" disabled={props.busy || (showPeople && !clients.length)}
        onPress={() => props.onNew(showPeople ? 'contact' : 'client')}/>
    </View>
    {rows.length ? rows.map(row => <RecordCard key={row.id} title={row.title} notes={row.notes}
      subtitle={row.kind === 'contact' ? [row.role, clientName(props.workspace, row.clientId), row.email].filter(Boolean).join(' · ') : row.industry}
      action={() => props.onEdit(row)}/>) : <Card><Detail>{showPeople ? (clients.length ? 'No contacts yet.' : 'Add a client before adding contacts.') : 'No clients yet.'}</Detail></Card>}
  </>;
}

export function Projects(props: ScreenProps) {
  const rows = listOf(props.workspace, 'project');
  return <>
    <View style={[styles.row, styles.rowSpread]}>
      <ScreenHeading title="Projects"/>
      <Button label="New project" kind="primary" disabled={props.busy} onPress={() => props.onNew('project')}/>
    </View>
    {rows.length ? rows.map(row => <RecordCard key={row.id} title={row.title} notes={row.notes}
      subtitle={[caption(row.status), clientName(props.workspace, row.clientId), row.photoUri ? 'Photo attached' : ''].filter(Boolean).join(' · ')}
      action={() => props.onEdit(row)}/>) : <Card><Detail>No projects yet.</Detail></Card>}
  </>;
}

export function Assistant(props: ScreenProps) {
  const digest = summarize(props.workspace);
  return <>
    <ScreenHeading title="Assistant" subtitle="A daily briefing from records on this device."/>
    <Group title="Focus">
      <Card>
        <Name>{digest.openTasks.length} {digest.openTasks.length === 1 ? 'task' : 'tasks'} due</Name>
        <Detail>{digest.overdueFollowUps.length} overdue {digest.overdueFollowUps.length === 1 ? 'follow-up' : 'follow-ups'}</Detail>
        {digest.openTasks.slice(0, 3).map(task => <Detail key={task.id}>{task.title}</Detail>)}
        <Button label="Open tasks" onPress={() => props.onMove('Today')}/>
      </Card>
    </Group>
    <Card>
      <Name>COMPASS AI</Name>
      <Detail>Continue with the signed-in online Builder. This app keeps its records on this device.</Detail>
      <Button label="Open COMPASS" kind="primary" onPress={props.onBuilder}/>
    </Card>
  </>;
}

export function Revenue(props: ScreenProps) {
  const summary = summarize(props.workspace);
  const colors = usePalette();
  const largest = Math.max(1, ...Object.values(summary.opportunityValues));
  return <>
    <View style={[styles.row, styles.rowSpread]}><ScreenHeading title="Revenue"/><Button label="Pipeline" onPress={() => props.onMove('Pipeline')}/></View>
    <View style={styles.cards}>
      <Metric label="Won revenue" value={formatMoney(summary.won, props.currency)}/>
      <Metric label="Open pipeline" value={formatMoney(summary.activePipeline, props.currency)}/>
    </View>
    <Group title="Value by stage">
      <Card>
        {stages.map(stage => <View key={stage} style={{gap: 5, marginBottom: 8}}>
          <View style={[styles.row, styles.rowSpread]}>
            <Detail>{props.stageLabels[stage]}</Detail>
            <Detail>{formatMoney(summary.opportunityValues[stage], props.currency)}</Detail>
          </View>
          <View accessible={false} style={{height: 5, borderRadius: 3, backgroundColor: colors.accentBackground, overflow: 'hidden'}}>
            <View style={{height: 5, borderRadius: 3, backgroundColor: colors.accent, width: (summary.opportunityValues[stage] / largest * 100) + '%'}}/>
          </View>
        </View>)}
      </Card>
    </Group>
  </>;
}
