import {randomUUID} from 'expo-crypto';
import {useRef, useState} from 'react';
import {Linking, Text, View} from 'react-native';
import {WebView} from 'react-native-webview';
import {COMPASS_ORIGIN, mobileApi, type Website as WebsiteProject} from './api';
import type {Run} from './Project';
import {notifyCompletion} from './device';
import {Button, Empty, Field, Page, styles} from './ui';

function scriptlessPreview(html: string) {
  if (typeof html !== 'string' || html.length > 160000 || !/^<!doctype html>/i.test(html.trim()) ||
      /<\s*(?:script|iframe|object|embed|base|link)\b/i.test(html) || /http-equiv\s*=/i.test(html) || !/<head>/i.test(html)) return null;
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";
  return html.replace(/<head>/i, '<head><meta http-equiv="Content-Security-Policy" content="' + policy + '">');
}

export function Website({project, busy, run, onBack, onUpdate}: {
  project: WebsiteProject; busy: boolean; run: Run; onBack: () => void; onUpdate: (project: WebsiteProject) => void;
}) {
  const [selected, setSelected] = useState(project.revisions.at(-1)?.id);
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState<{text: string; version: string; build: Awaited<ReturnType<typeof mobileApi.buildWebsite>>} | null>(null);
  const turn = useRef<{text: string; version: string; key: string} | null>(null);
  const revision = project.revisions.find(item => item.id === selected);
  const candidate = pending?.version === project.updatedAt ? pending.build.html : null;
  const html = candidate ?? revision?.render.html;
  const preview = html ? scriptlessPreview(html) : null;

  function buildRevision() {
    const text = instruction.trim();
    const latest = project.revisions.at(-1);
    if (!latest) return;
    const version = project.updatedAt;
    const key = turn.current?.text === text && turn.current.version === version ? turn.current.key : 'mobile-site-revision-' + randomUUID();
    turn.current = {text, version, key};
    run(async () => {
      try {setPending({text, version, build: await mobileApi.buildWebsite(text, key, latest.plan.intent)});}
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'previous_build_failed') turn.current = null;
        throw error;
      }
    });
  }

  function refresh() {
    run(async () => {
      const updated = (await mobileApi.website(project.id)).project;
      onUpdate(updated);
      setSelected(updated.revisions.at(-1)?.id);
      setPending(null);
    });
  }

  return <Page title={project.name}>
    <View style={styles.row}><Button label="All projects" disabled={busy} onPress={onBack} />
      <Button label="Refresh website" disabled={busy} onPress={refresh} />
      <Button label="Open web Builder" disabled={busy} onPress={() => run(() => Linking.openURL(COMPASS_ORIGIN + '/workspace'))} /></View>
    <Text accessibilityRole="header" style={styles.section}>{candidate ? 'Proposed revision' : 'Website preview'}</Text>
    {preview ? <View style={{height: 470, borderRadius: 20, overflow: 'hidden', backgroundColor: '#FFFFFF'}}>
      <WebView source={{html: preview, baseUrl: 'about:blank'}}
        originWhitelist={['*']}
        accessibilityLabel="Scriptless website preview" javaScriptEnabled={false} domStorageEnabled={false}
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
        thirdPartyCookiesEnabled={false} sharedCookiesEnabled={false} setSupportMultipleWindows={false}
        mediaPlaybackRequiresUserAction mixedContentMode="never" incognito
        // Let the callback reject all nonlocal destinations. WebView normally
        // offers out-of-whitelist links to the system browser before callbacks.
        onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url.startsWith('about:blank#')} />
    </View> : <Empty text="This website preview could not be opened safely." />}
    <View style={styles.card}>
      <Field label="Describe a change" multiline value={instruction} onChangeText={value => {setInstruction(value); setPending(null);}}
        maxLength={500} editable={!busy} placeholder="What should change?" />
      <Button label="Build a revision" primary busy={busy} disabled={instruction.trim().length < 3} onPress={buildRevision} />
      {!!candidate && <Button label="Approve revision" disabled={busy} onPress={() => {
        if (!pending) return;
        run(async () => {
          const {project: updated} = await mobileApi.saveWebsite(pending.text, pending.build, project);
          onUpdate(updated);
          setSelected(updated.revisions.at(-1)?.id);
          setPending(null);
          setInstruction('');
          void notifyCompletion().catch(() => {});
        }, 'Revision saved.');
      }} />}
    </View>
    <Text accessibilityRole="header" style={styles.section}>Revisions</Text>
    {[...project.revisions].reverse().map(item => <View key={item.id} style={styles.card}>
      <Text style={styles.label}>Revision {item.number}</Text>
      <Text style={styles.body}>{item.prompt}</Text>
      <Button label={selected === item.id ? 'Selected preview' : 'Preview revision'} selected={selected === item.id} disabled={busy}
        onPress={() => {setSelected(item.id); setPending(null);}} />
    </View>)}
  </Page>;
}
