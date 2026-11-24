import {useEffect, useRef, useState} from 'react';
import {BackHandler, Linking, Platform, Pressable, ScrollView, StatusBar, Text, View, useColorScheme} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import manifest from '../manifest.json';
import {Editor} from './Editor';
import {Assistant, Contacts, Pipeline, Projects, Revenue, Today, type Page} from './Screens';
import {cancelReminder, deletePhoto, pendingReminders, pickPhoto, readWorkspace, scheduleReminder, writeWorkspace} from './device';
import {Button, Detail, Feedback, PaletteContext, ScreenHeading, palette, styles, usePalette} from './ui';
import {removeRecord, sampleWorkspace, saveDraft, updateRecord, type Draft, type Kind, type Project, type Row, type Task, type Workspace} from './workspace';

const tabs = ['Today', 'Pipeline', 'Contacts', 'Projects', 'Assistant'] as const;
const screens = {Today, Pipeline, Contacts, Projects, Assistant, Revenue};
const builderUrl = 'https://mycompass.world/workspace';
type EditSelection = {kind: Kind; id?: number};

function Tabs({page, onChange}: {page: Page; onChange: (page: Page) => void}) {
  const colors = usePalette();
  return <View accessibilityRole="tablist" style={[styles.nav, {backgroundColor: colors.paper, borderColor: colors.border}]}>
    {tabs.map(tab => {
      const selected = tab === page || (tab === 'Pipeline' && page === 'Revenue');
      return <Pressable key={tab} accessibilityRole="tab" accessibilityState={{selected}} onPress={() => onChange(tab)} style={styles.navItem}>
        <View style={[styles.navBar, {backgroundColor: selected ? colors.accent : colors.border}]}/>
        <Text style={[styles.navText, {color: selected ? colors.accent : colors.muted}]}>{tab}</Text>
      </Pressable>;
    })}
  </View>;
}

function PersonalOS() {
  const colors = usePalette();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [pending, setPending] = useState<Set<number> | null>(null);
  const [page, setPage] = useState<Page>('Today');
  const [editor, setEditor] = useState<EditSelection | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const activeOperation = useRef(false);
  const selectedRow = editor?.id === undefined ? undefined : workspace?.records.find(row => row.id === editor.id);

  useEffect(() => {
    let active = true;
    Promise.all([readWorkspace(), pendingReminders().catch(() => null)]).then(([saved, reminders]) => {
      if (!active) return;
      setWorkspace(saved);
      setPending(reminders);
    }).catch(() => { if (active) setProblem('Could not open the saved workspace.'); });
    return () => { active = false; };
  }, [loadAttempt]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page === 'Today') return false;
      setPage(page === 'Revenue' ? 'Pipeline' : 'Today');
      return true;
    });
    return () => handler.remove();
  }, [page]);

  function onMove(destination: Page) {
    if (activeOperation.current) return;
    setNotice('');
    setProblem('');
    setPage(destination);
  }

  function openEditor(kind: Kind, id?: number) {
    if (activeOperation.current) return;
    setNotice('');
    setProblem('');
    setEditor({kind, id});
  }

  async function operate(action: () => Promise<void>) {
    if (activeOperation.current) return;
    activeOperation.current = true;
    setBusy(true);
    setNotice('');
    setProblem('');
    try { await action(); }
    catch (error) { setProblem(error instanceof Error ? error.message : 'Could not complete that action.'); }
    finally { activeOperation.current = false; setBusy(false); }
  }

  async function persist(next: Workspace) {
    try { await writeWorkspace(next); }
    catch { throw new Error('Could not save to this device. Try again.'); }
    setWorkspace(next);
  }

  if (!workspace) {
    return <SafeAreaView style={[styles.page, {backgroundColor: colors.background}]}>
      <View style={[styles.content, styles.max]}>
        <ScreenHeading title={manifest.title}/>
        {problem ? <>
          <Feedback message={problem} error/>
          <Button label="Retry" onPress={() => {setProblem(''); setLoadAttempt(loadAttempt + 1);}}/>
        </> : <Detail>Opening workspace…</Detail>}
      </View>
    </SafeAreaView>;
  }

  const current = workspace;
  const Screen = screens[page];
  const refreshReminders = async () => setPending(await pendingReminders().catch(() => null));
  const dismiss = () => {setEditor(null); setProblem('');};
  const prospective = async (next: Workspace, task?: Task) => {
    if (!task) {await persist(next); return;}
    // Cancel first so a removed or changed task cannot leave a stale notification.
    await cancelReminder(task.id);
    await refreshReminders();
    await persist(next);
  };

  const screenProps = {
    workspace: current, currency: manifest.crm.currency, stageLabels: manifest.crm.stages, busy, pending,
    onEdit: (row: Row) => openEditor(row.kind, row.id),
    onNew: openEditor,
    onMove,
    onComplete: (task: Task) => void operate(async () => {
      const next = updateRecord(current, {...task, done: !task.done});
      await prospective(next, task);
      setNotice(task.done ? 'Task reopened.' : 'Task completed.');
    }),
    onReminder: (task: Task, scheduled: boolean) => void operate(async () => {
      if (scheduled) await cancelReminder(task.id);
      else await scheduleReminder(task);
      await refreshReminders();
      setNotice(scheduled ? 'Reminder cancelled.' : 'Reminder scheduled for this device.');
    }),
    onSamples: () => void operate(async () => {
      if (current.nextId !== 1 || current.records.length) return;
      await persist(sampleWorkspace());
      setNotice('Synthetic sample records loaded.');
    }),
    onBuilder: () => void operate(async () => { await Linking.openURL(builderUrl); }),
  };

  function saveEditor(draft: Draft) {
    if (!editor) return;
    void operate(async () => {
      const next = saveDraft(current, editor.kind, draft, editor.id);
      const oldTask = selectedRow?.kind === 'task' ? selectedRow : undefined;
      const needsCancel = oldTask && (oldTask.dueDate !== draft.dueDate || oldTask.category !== draft.category || oldTask.done !== draft.done);
      await prospective(next, needsCancel ? oldTask : undefined);
      dismiss();
      setNotice('Saved on this device.');
    });
  }

  function deleteEditor() {
    if (!selectedRow) return;
    void operate(async () => {
      const next = removeRecord(current, selectedRow);
      await prospective(next, selectedRow.kind === 'task' ? selectedRow : undefined);
      if (selectedRow.kind === 'project') cleanAttachment(selectedRow);
      dismiss();
      setNotice('Record deleted.');
    });
  }

  function cleanAttachment(project: Project) {
    if (!project.photoUri) return;
    try { deletePhoto(project.photoUri); }
    catch { /* Old copies remain inside the local app sandbox if cleanup fails. */ }
  }

  function attachPhoto(camera: boolean) {
    if (selectedRow?.kind !== 'project') return;
    void operate(async () => {
      const photoUri = await pickPhoto(camera, selectedRow.id);
      if (!photoUri) return;
      try { await persist(updateRecord(current, {...selectedRow, photoUri})); }
      catch (error) {
        cleanAttachment({...selectedRow, photoUri});
        throw error;
      }
      cleanAttachment(selectedRow);
    });
  }

  function removePhoto() {
    if (selectedRow?.kind !== 'project' || !selectedRow.photoUri) return;
    void operate(async () => {
      await persist(updateRecord(current, {...selectedRow, photoUri: null}));
      cleanAttachment(selectedRow);
    });
  }

  return <SafeAreaView style={[styles.page, {backgroundColor: colors.background}]}
    edges={['top', 'bottom', 'left', 'right']}>
    <StatusBar barStyle={colors.dark ? 'light-content' : 'dark-content'}/>
    <View style={[styles.brand, styles.max]}>
      <View accessible={false} style={[styles.mark, {backgroundColor: colors.accent}]}/>
      <Text numberOfLines={1} style={[styles.brandText, {color: colors.text}]}>{manifest.title}</Text>
    </View>
    <ScrollView key={page} style={styles.page} contentContainerStyle={[styles.content, styles.max]}>
      {!editor && problem ? <Feedback message={problem} error/> : null}
      {notice ? <Feedback message={notice}/> : null}
      <Screen {...screenProps}/>
    </ScrollView>
    <Tabs page={page} onChange={onMove}/>
    {editor ? <Editor key={editor.kind + ':' + (editor.id ?? 'new')} kind={editor.kind} row={selectedRow} workspace={current}
      currency={manifest.crm.currency} stageLabels={manifest.crm.stages} busy={busy} problem={problem}
      onClose={() => {if (!activeOperation.current) dismiss();}} onSave={saveEditor}
      onDelete={deleteEditor} onAttach={attachPhoto} onRemovePhoto={removePhoto}/> : null}
  </SafeAreaView>;
}

export default function App() {
  const system = useColorScheme();
  const colors = palette(manifest.theme.mode === 'dark' || system === 'dark', manifest.theme.accent);
  return <SafeAreaProvider><PaletteContext.Provider value={colors}><PersonalOS/></PaletteContext.Provider></SafeAreaProvider>;
}
