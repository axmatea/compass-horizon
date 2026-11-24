import {useState} from 'react';
import {Image, KeyboardAvoidingView, Modal, Platform, ScrollView, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {onDevice, photoDisplayUri} from './device';
import {Button, Detail, Feedback, Field, ScreenHeading, styles, usePalette} from './ui';
import {dayKey, listOf, newDraft, nextDay, projectStates, stages, type Draft, type Kind, type Row, type Stage, type Workspace} from './workspace';

export const names: Record<Kind, string> = {client: 'client', contact: 'contact', opportunity: 'opportunity', task: 'task', project: 'project'};

type Props = {
  workspace: Workspace; kind: Kind; row?: Row; busy: boolean; problem: string;
  currency: string; stageLabels: Record<Stage, string>;
  onClose: () => void; onSave: (draft: Draft) => void; onDelete: () => void;
  onAttach: (camera: boolean) => void; onRemovePhoto: () => void;
};

export function Editor({workspace, kind, row, busy, problem, currency, stageLabels, onClose, onSave, onDelete, onAttach, onRemovePhoto}: Props) {
  const colors = usePalette();
  const [draft, setDraft] = useState(() => newDraft(kind, row));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const clients = listOf(workspace, 'client');
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(previous => ({...previous, [key]: value}));
  const clientRequired = kind === 'contact' || kind === 'opportunity';
  const title = (row ? 'Edit ' : 'New ') + names[kind];
  const imageUri = row?.kind === 'project' && row.photoUri ? photoDisplayUri(row.photoUri) : '';

  return <Modal visible animationType="none" presentationStyle={Platform.OS === 'ios' ? 'formSheet' : 'fullScreen'}
    onRequestClose={busy ? () => {} : onClose}>
    <SafeAreaView style={[styles.page, {backgroundColor: colors.background}]} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={[styles.row, styles.rowSpread]}>
            <ScreenHeading title={title}/>
            <Button label="Close" disabled={busy} onPress={onClose}/>
          </View>
          {problem ? <Feedback message={problem} error/> : null}
          <Field label="Name" value={draft.title} editable={!busy && !confirmingDelete} onChangeText={value => set('title', value)} maxLength={100}/>
          {kind === 'client' ? <Field label="Industry" value={draft.industry} editable={!busy} onChangeText={value => set('industry', value)} maxLength={100}/> : null}
          {kind === 'contact' ? <>
            <Field label="Email" value={draft.email} editable={!busy} onChangeText={value => set('email', value)} maxLength={254}
              keyboardType="email-address" autoCapitalize="none" autoComplete="email"/>
            <Field label="Role" value={draft.role} editable={!busy} onChangeText={value => set('role', value)} maxLength={100}/>
          </> : null}
          {kind !== 'client' ? <View style={styles.field}>
            <Detail>Client{clientRequired ? '' : ' (optional)'}</Detail>
            <View style={styles.row}>
              {!clientRequired ? <Button label="Unassigned" selected={draft.clientId === null} disabled={busy} onPress={() => set('clientId', null)}/> : null}
              {clients.map(client => <Button key={client.id} label={client.title} selected={draft.clientId === client.id}
                disabled={busy} onPress={() => set('clientId', client.id)}/>)}
            </View>
          </View> : null}
          {kind === 'opportunity' ? <>
            <Field label={'Value (' + currency + ')'} value={draft.value} editable={!busy} onChangeText={value => set('value', value)}
              maxLength={12} keyboardType="decimal-pad" placeholder="0.00"/>
            <View style={styles.field}>
              <Detail>Stage</Detail>
              <View style={styles.row}>{stages.map(stage => <Button key={stage} label={stageLabels[stage]}
                selected={draft.stage === stage} disabled={busy} onPress={() => set('stage', stage)}/>)}</View>
            </View>
          </> : null}
          {kind === 'task' ? <>
            <View style={styles.row}>
              <Button label="Task" selected={draft.category === 'task'} disabled={busy} onPress={() => set('category', 'task')}/>
              <Button label="Follow-up" selected={draft.category === 'follow-up'} disabled={busy} onPress={() => set('category', 'follow-up')}/>
            </View>
            <Field label="Due date" value={draft.dueDate} editable={!busy} onChangeText={value => set('dueDate', value)}
              placeholder="YYYY-MM-DD" autoCapitalize="none" maxLength={10}/>
            <View style={styles.row}>
              <Button label="Today" disabled={busy} onPress={() => set('dueDate', dayKey())}/>
              <Button label="Tomorrow" disabled={busy} onPress={() => set('dueDate', nextDay())}/>
            </View>
          </> : null}
          {kind === 'project' ? <>
            <View style={styles.field}>
              <Detail>Status</Detail>
              <View style={styles.row}>{projectStates.map(status => <Button key={status} label={status[0].toUpperCase() + status.slice(1)}
                selected={draft.status === status} disabled={busy} onPress={() => set('status', status)}/>)}</View>
            </View>
            {imageUri ? <Image source={{uri: imageUri}} accessibilityLabel="Project reference photo"
              style={{width: '100%', height: 148, borderRadius: 14}} resizeMode="cover"/> : null}
            {row && onDevice ? <View style={styles.row}>
              <Button label="Choose photo" disabled={busy} onPress={() => onAttach(false)}/>
              <Button label="Take photo" disabled={busy} onPress={() => onAttach(true)}/>
              {imageUri ? <Button label="Remove photo" disabled={busy} onPress={onRemovePhoto}/> : null}
            </View> : null}
          </> : null}
          <Field label="Notes" value={draft.notes} editable={!busy} onChangeText={value => set('notes', value)} maxLength={600} multiline/>
          {confirmingDelete ? <View style={styles.field}>
            <Detail>Delete this {names[kind]} from this device?</Detail>
            <View style={styles.row}>
              <Button label="Keep" disabled={busy} onPress={() => setConfirmingDelete(false)}/>
              <Button label="Delete" kind="danger" disabled={busy} onPress={onDelete}/>
            </View>
          </View> : <View style={styles.row}>
            <Button label={busy ? 'Working…' : 'Save'} kind="primary" disabled={busy} onPress={() => onSave(draft)}/>
            {row ? <Button label="Delete…" kind="danger" disabled={busy} onPress={() => setConfirmingDelete(true)}/> : null}
          </View>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}
