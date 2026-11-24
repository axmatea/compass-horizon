import {randomUUID} from 'expo-crypto';
import {useState} from 'react';
import {Alert, Linking, Text, View} from 'react-native';
import {COMPASS_ORIGIN, mobileApi, targetLabels, type Application, type Context, type ContextNotes, type Plan, type Revision} from './api';
import {notifyCompletion, pickImage} from './device';
import {Button, Empty, Field, Page, styles} from './ui';

export type Run = (work: () => Promise<unknown>, success?: string) => void;
type AppView = 'Build' | 'Records' | 'Context' | 'History';
type PendingPlan = {plan: Plan; text: string; key: string};

export function PlanCard({plan, busy, onApply, onCancel}: {plan: Plan; busy: boolean; onApply: () => void; onCancel: () => void}) {
  const {manifest} = plan;
  return <View style={styles.card}>
    <Text style={styles.small}>{plan.source === 'model' ? 'AI proposal' : 'Prepared proposal'}</Text>
    <Text accessibilityRole="header" style={styles.section}>{manifest.title}</Text>
    <Text style={styles.body}>{manifest.description}</Text>
    {manifest.entity?.fields?.length ? <Text style={styles.muted}>{manifest.entity.fields.map(field => field.label).join(' · ')}</Text> : null}
    <View style={styles.row}>
      <Button label="Approve and build" primary busy={busy} onPress={onApply} />
      <Button label="Dismiss plan" disabled={busy} onPress={onCancel} />
    </View>
  </View>;
}

export function ApplicationProject({app, busy, run, onBack, onUpdate}: {
  app: Application; busy: boolean; run: Run; onBack: () => void; onUpdate: (app: Application) => void;
}) {
  const [view, setView] = useState<AppView>('Build');
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState<PendingPlan | null>(null);
  const [records, setRecords] = useState<Awaited<ReturnType<typeof mobileApi.records>>['records'] | null>(null);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const platform = app.manifest.mobile?.platform;

  function refresh(section: AppView) {
    if (section === 'Records') run(async () => {setRecords((await mobileApi.records(app)).records);});
    if (section === 'History') run(async () => {setRevisions((await mobileApi.revisions(app.id)).revisions);});
    if (section === 'Context') run(async () => {setContext((await mobileApi.context(app.id)).context);});
  }

  function approve() {
    if (!pending) return;
    run(async () => {
      const next = (await mobileApi.apply(pending.text, pending.plan, pending.key, app)).application;
      onUpdate(next);
      setPending(null);
      setInstruction('');
      setRecords(null);
      setRevisions(null);
      void notifyCompletion().catch(() => {});
    }, 'Revision saved.');
  }

  function restore(version: number) {
    Alert.alert('Restore this revision?', 'COMPASS saves it as a new revision.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Restore', onPress: () => run(async () => {
        const updated = (await mobileApi.restoreRevision(app.id, version)).application;
        onUpdate(updated);
        setRevisions((await mobileApi.revisions(app.id)).revisions);
        setPending(null);
      }, 'Revision restored.')},
    ]);
  }

  function attach() {
    run(async () => {
      const image = await pickImage();
      if (!image) return;
      onUpdate((await mobileApi.uploadImage(app, image.bytes, image.mime)).application);
      setPending(null);
    });
  }

  return <Page title={app.manifest.title} intro={app.manifest.description}>
    <View style={styles.spread}>
      <Button label="All projects" disabled={busy} onPress={onBack} />
      <Text style={styles.small}>{platform ? targetLabels[platform] : 'Web app'} · Revision {app.version}</Text>
    </View>
    <View style={styles.row}>
      {(['Build', 'Records', 'Context', 'History'] as const).map(item => <Button key={item}
        label={item} disabled={busy} selected={view === item} onPress={() => {setView(item); refresh(item);}} />)}
    </View>
    {view === 'Build' && <>
      <View style={styles.card}>
        <Field label="Describe a change" placeholder="What should change?" value={instruction} onChangeText={setInstruction} multiline maxLength={2000} editable={!busy} />
        <Button label="Review plan" primary busy={busy} disabled={instruction.trim().length < 3} onPress={() => {
          const text = instruction.trim();
          run(async () => {
            const plan = await mobileApi.plan(text, 'application', app);
            setPending({plan, text, key: 'mobile-apply-' + randomUUID()});
          });
        }} />
      </View>
      {pending && <PlanCard plan={pending.plan} busy={busy} onApply={approve} onCancel={() => setPending(null)} />}
      <View style={styles.row}>
        {!platform && !app.manifest.crm && <Button label="Add project image" disabled={busy} onPress={attach} />}
        <Button label="Refresh revision" disabled={busy} onPress={() => run(async () => {
          onUpdate((await mobileApi.application(app.id)).application);
          setPending(null);
          setRecords(null);
          setRevisions(null);
        })} />
        <Button label="Open web Builder" disabled={busy} onPress={() => run(() => Linking.openURL(COMPASS_ORIGIN + '/workspace'))} />
      </View>
    </>}
    {view === 'Records' && <>
      <View style={styles.spread}>
        <Text accessibilityRole="header" style={styles.section}>{app.manifest.crm ? 'CRM clients' : app.manifest.entity?.plural || 'Saved records'}</Text>
        <Button label="Refresh records" disabled={busy} onPress={() => refresh('Records')} />
      </View>
      {records?.length ? records.slice(0, 40).map(record => <View key={record.id} style={styles.card}>
        {Object.entries(record.data).slice(0, 6).map(([label, value]) => <View key={label}>
          <Text style={styles.small}>{label.replaceAll('_', ' ')}</Text><Text style={styles.body}>{String(value)}</Text>
        </View>)}
      </View>) : <Empty text={records ? 'No saved records yet.' : 'Load records from your workspace.'} />}
    </>}
    {view === 'Context' && <>
      <View style={styles.spread}><Text accessibilityRole="header" style={styles.section}>Project context</Text>
        <Button label="Refresh context" disabled={busy} onPress={() => refresh('Context')} /></View>
      {context && <ContextDetails key={context.version} context={context} busy={busy} save={notes => run(async () => {
        setContext((await mobileApi.updateContext(app.id, context.version, notes)).context);
      }, 'Context saved.')} change={input => run(async () => {
        setContext((await mobileApi.changeContext(app.id, context.version, input)).context);
      }, 'Context updated.')} />}
    </>}
    {view === 'History' && <>
      <View style={styles.spread}><Text accessibilityRole="header" style={styles.section}>Revisions</Text>
        <Button label="Refresh history" disabled={busy} onPress={() => refresh('History')} /></View>
      {revisions?.map(revision => <View key={revision.version} style={styles.card}>
        <Text style={styles.label}>Revision {revision.version}{revision.version === app.version ? ' · Current' : ''}</Text>
        <Text style={styles.body}>{revision.prompt}</Text>
        <Text style={styles.small}>{new Date(revision.createdAt).toLocaleDateString()}</Text>
        {revision.buildReport && <Text style={styles.muted}>{revision.buildReport.outcome === 'repaired' ? 'Configuration repaired' : 'Build recorded'}</Text>}
        {revision.version !== app.version && <Button label="Restore revision" disabled={busy} onPress={() => restore(revision.version)} />}
      </View>)}
    </>}
  </Page>;
}

const noteLabels: Record<keyof ContextNotes, string> = {
  goal: 'Goal', architecture: 'Architecture', preferences: 'Preferences', dependencies: 'Dependencies', problems: 'Open questions',
};

function ContextDetails({context, busy, save, change}: {
  context: Context; busy: boolean; save: (notes: ContextNotes) => void;
  change: (input: {action: string; id?: string; text?: string; status?: string}) => void;
}) {
  const [notes, setNotes] = useState(context.notes);
  const [decision, setDecision] = useState('');
  const [supersede, setSupersede] = useState<string | null>(null);
  const [task, setTask] = useState('');
  const changed = Object.keys(noteLabels).some(key => notes[key as keyof ContextNotes] !== context.notes[key as keyof ContextNotes]);

  return <>
    <View style={styles.card}>
      {Object.entries(noteLabels).map(([key, label]) => <Field key={key} label={label} value={notes[key as keyof ContextNotes]}
        onChangeText={text => setNotes(prior => ({...prior, [key]: text}))} maxLength={300} editable={!busy} />)}
      <Button label="Save notes" primary disabled={busy || !changed} onPress={() => save(notes)} />
    </View>
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.section}>Decisions</Text>
      {context.decisions.map(item => <View key={item.id} style={styles.field}>
        <Text style={styles.body}>{item.text}</Text>
        {item.supersededBy ? <Text style={styles.small}>Superseded</Text> : <Button label="Replace decision" disabled={busy || changed} onPress={() => setSupersede(item.id)} />}
      </View>)}
      <Field label={supersede ? 'Replacement decision' : 'New decision'} value={decision} onChangeText={setDecision} maxLength={220} editable={!busy} />
      <Button label={supersede ? 'Save replacement' : 'Add decision'} primary disabled={busy || changed || !decision.trim()} onPress={() => change({
        action: supersede ? 'supersede' : 'decision', ...(supersede ? {id: supersede} : {}), text: decision.trim(),
      })} />
      {supersede && <Button label="Cancel replacement" disabled={busy} onPress={() => setSupersede(null)} />}
    </View>
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.section}>Tasks</Text>
      {context.tasks.map(item => <View key={item.id} style={styles.field}>
        <Text style={styles.body}>{item.text}</Text><Text style={styles.small}>{item.status}</Text>
        <Button label={item.status === 'active' ? 'Complete task' : 'Reopen task'} disabled={busy || changed} onPress={() => change({
          action: 'task-status', id: item.id, status: item.status === 'active' ? 'done' : 'active',
        })} />
      </View>)}
      <Field label="New task" value={task} onChangeText={setTask} maxLength={220} editable={!busy} />
      <Button label="Add task" disabled={busy || changed || !task.trim()} onPress={() => change({action: 'task', text: task.trim()})} />
    </View>
  </>;
}
