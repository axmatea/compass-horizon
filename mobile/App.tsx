import {randomUUID} from 'expo-crypto';
import {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Image, Linking, Platform, Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {COMPASS_ORIGIN, errorText, mobileApi, targetLabels, type Application, type Plan, type Target, type WebsiteSummary} from './src/api';
import {enableCompletionNotifications, notifyCompletion} from './src/device';
import {ApplicationProject, PlanCard, type Run} from './src/Project';
import {Button, Empty, Field, Notice, Page, colors, styles} from './src/ui';
import {Website} from './src/Website';

type Tab = 'New' | 'Projects' | 'Account';
type Selection = {type: 'app'; value: Application} | {type: 'website'; value: Awaited<ReturnType<typeof mobileApi.website>>['project']};
type Feedback = {message: string; error?: boolean};
const emptyFeedback: Feedback = {message: ''};
const targets: Target[] = ['website', 'application', 'ios', 'android', 'cross-platform'];

const shell = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.canvas},
  header: {backgroundColor: colors.white, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  mark: {height: 29, width: 29, borderRadius: 7},
  brand: {fontSize: 16, fontWeight: '800', color: colors.ink, letterSpacing: 1.1},
  content: {flex: 1},
  notice: {paddingHorizontal: 18, paddingTop: 6},
  navigation: {backgroundColor: colors.white, flexDirection: 'row', justifyContent: 'center', padding: 9, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, gap: 8},
  tab: {minHeight: 48, flex: 1, maxWidth: 200, justifyContent: 'center', alignItems: 'center', padding: 9, borderRadius: 13},
  selectedTab: {backgroundColor: colors.accentTint},
  tabText: {color: colors.muted, fontSize: 15, fontWeight: '700'},
  selectedText: {color: colors.accent},
  loader: {flex: 1, alignItems: 'center', justifyContent: 'center'},
});

function NativeWorkspace() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<{userId: string} | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(emptyFeedback);
  const [busy, setBusy] = useState(false);
  const executing = useRef(false);
  const [tab, setTab] = useState<Tab>('New');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [projects, setProjects] = useState<{applications: Application[]; websites: WebsiteSummary[]} | null>(null);

  useEffect(() => {
    let mounted = true;
    mobileApi.restore().then(identity => {if (mounted) setUser(identity);})
      .catch(error => {if (mounted) setFeedback({message: errorText(error), error: true});})
      .finally(() => {if (mounted) setInitializing(false);});
    return () => {mounted = false;};
  }, []);

  const run: Run = (work, success) => {
    if (executing.current) return;
    executing.current = true;
    setBusy(true);
    setFeedback(emptyFeedback);
    work().then(() => {if (success) setFeedback({message: success});}).catch(error => {
      if (error?.code === 'sign_in_required' || error?.code === 'account_changed') clearAccount();
      setFeedback({message: errorText(error), error: true});
    }).finally(() => {executing.current = false; setBusy(false);});
  };

  function clearAccount() {
    setUser(null);
    setSelected(null);
    setProjects(null);
    setTab('New');
  }

  function refreshProjects() {
    run(async () => {
      const [{applications}, {projects: websites}] = await Promise.all([mobileApi.applications(), mobileApi.websites()]);
      setProjects({applications, websites});
    });
  }

  function go(next: Tab) {
    setSelected(null);
    setTab(next);
    setFeedback(emptyFeedback);
    if (next === 'Projects') refreshProjects();
  }

  function open(selection: Selection) {
    setProjects(null);
    setTab('Projects');
    setSelected(selection);
  }

  function back() { setSelected(null); refreshProjects(); }

  return <SafeAreaView style={shell.safe}>
    <StatusBar barStyle="dark-content" />
    <View style={shell.header}><Image accessible={false} source={require('./assets/icon.png')} style={shell.mark} /><Text accessibilityRole="header" style={shell.brand}>COMPASS</Text></View>
    {!!feedback.message && <View style={shell.notice}><Notice {...feedback} /></View>}
    <View style={shell.content}>
      {initializing ? <View style={shell.loader}><ActivityIndicator accessibilityLabel="Opening COMPASS" color={colors.accent} /></View> : !user ?
        <SignIn busy={busy} run={run} onLogin={setUser} /> : selected?.type === 'app' ?
        <ApplicationProject key={selected.value.id} app={selected.value} busy={busy} run={run} onBack={back}
          onUpdate={value => setSelected({type: 'app', value})} /> : selected?.type === 'website' ?
        <Website key={selected.value.id} project={selected.value} busy={busy} run={run} onBack={back}
          onUpdate={value => setSelected({type: 'website', value})} /> : tab === 'New' ?
        <NewProject busy={busy} run={run} onOpen={open} /> : tab === 'Projects' ?
        <Page title="Projects">
          <Button label="Refresh projects" busy={busy} onPress={refreshProjects} />
          {projects ? <>
            <Text accessibilityRole="header" style={styles.section}>Applications</Text>
            {projects.applications.length ? projects.applications.map(app => <ProjectRow key={app.id} title={app.manifest.title}
              detail={'Revision ' + app.version} disabled={busy} onPress={() => run(async () => open({type: 'app', value: (await mobileApi.application(app.id)).application}))} />) :
              <Empty text="No saved applications yet." />}
            <Text accessibilityRole="header" style={styles.section}>Websites</Text>
            {projects.websites.length ? projects.websites.map(site => <ProjectRow key={site.id} title={site.name}
              detail={`${site.revisions} ${site.revisions === 1 ? 'revision' : 'revisions'}`} disabled={busy}
              onPress={() => run(async () => open({type: 'website', value: (await mobileApi.website(site.id)).project}))} />) :
              <Empty text="No saved websites yet." />}
          </> : null}
        </Page> : <Account busy={busy} run={run} signOut={() => run(async () => {
          try {await mobileApi.signOut();} finally {clearAccount();}
        }, 'Signed out.')} />}
    </View>
    {user && <View accessibilityRole="tablist" style={shell.navigation}>
      {(['New', 'Projects', 'Account'] as const).map(item => <Pressable key={item} accessibilityRole="tab"
        accessibilityState={{selected: tab === item, disabled: busy}} disabled={busy} onPress={() => go(item)}
        style={[shell.tab, tab === item && shell.selectedTab]}><Text style={[shell.tabText, tab === item && shell.selectedText]}>{item}</Text></Pressable>)}
    </View>}
  </SafeAreaView>;
}

function ProjectRow({title, detail, disabled, onPress}: {title: string; detail: string; disabled: boolean; onPress: () => void}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed}) => [styles.card, pressed && styles.pressed]}>
    <Text style={styles.label}>{title}</Text><Text style={styles.small}>{detail}</Text>
  </Pressable>;
}

function SignIn({busy, run, onLogin}: {busy: boolean; run: Run; onLogin: (user: {userId: string}) => void}) {
  const [mode, setMode] = useState<'sign-in' | 'register' | 'reset'>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const title = mode === 'register' ? 'Create your account' : mode === 'reset' ? 'Reset password' : 'Sign in';
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canSubmit = emailValid && (mode === 'reset' || password.length > 0) && (mode !== 'register' || (name.trim().length > 0 && password.length >= 12));

  return <Page title={title} intro="Your projects and decisions travel with your COMPASS account.">
    <View style={styles.card}>
      {mode === 'register' && <Field label="Name" value={name} onChangeText={setName} autoComplete="name" editable={!busy} maxLength={80} />}
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
        autoComplete="email" editable={!busy} maxLength={254} />
      {mode !== 'reset' && <Field label={mode === 'register' ? 'Password (12 or more characters)' : 'Password'} value={password} onChangeText={setPassword} editable={!busy} secureTextEntry
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'} maxLength={128} />}
      <Button label={mode === 'reset' ? 'Send reset link' : title} primary busy={busy} disabled={!canSubmit} onPress={() => {
        const address = email.trim();
        if (mode === 'register') run(async () => {
          await mobileApi.registration(name.trim(), address, password);
          setPassword('');
          setMode('sign-in');
        }, 'Check your inbox for the verification link.');
        else if (mode === 'reset') run(async () => {
          await mobileApi.passwordReset(address);
          setMode('sign-in');
        }, 'If the account exists, a reset link is on its way.');
        else run(async () => {
          try {onLogin(await mobileApi.signIn(address, password));} finally {setPassword('');}
        });
      }} />
    </View>
    <View style={styles.row}>
      <Button label={mode === 'sign-in' ? 'Create account' : 'Back to sign in'} disabled={busy}
        onPress={() => {setPassword(''); setMode(mode === 'sign-in' ? 'register' : 'sign-in');}} />
      {mode === 'sign-in' && <Button label="Forgot password" disabled={busy} onPress={() => {setPassword(''); setMode('reset');}} />}
      <Button label="Privacy" disabled={busy} onPress={() => run(() => Linking.openURL(COMPASS_ORIGIN + '/privacy'))} />
    </View>
  </Page>;
}

function NewProject({busy, run, onOpen}: {busy: boolean; run: Run; onOpen: (selection: Selection) => void}) {
  const [target, setTarget] = useState<Target>('application');
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<{value: Plan; text: string; key: string} | null>(null);
  const [website, setWebsite] = useState<{value: Awaited<ReturnType<typeof mobileApi.buildWebsite>>; text: string} | null>(null);
  const websiteRequest = useRef<{text: string; key: string} | null>(null);
  const maxLength = target === 'website' ? 500 : 2000;

  function request() {
    const prompt = text.trim();
    run(async () => {
      if (target !== 'website') setPlan({value: await mobileApi.plan(prompt, target), text: prompt, key: 'mobile-plan-apply-' + randomUUID()});
      else {
        const key = websiteRequest.current?.text === prompt ? websiteRequest.current.key : 'mobile-website-' + randomUUID();
        websiteRequest.current = {text: prompt, key};
        try {setWebsite({value: await mobileApi.buildWebsite(prompt, key), text: prompt});}
        catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'previous_build_failed') websiteRequest.current = null;
          throw error;
        }
      }
    });
  }

  return <Page title="What will you build?">
    <View style={styles.row}>
      {targets.map(value => <Button key={value} label={targetLabels[value]} selected={value === target} disabled={busy}
        onPress={() => {setTarget(value); setPlan(null); setWebsite(null);}} />)}
    </View>
    <View style={styles.card}>
      <Field label="Your idea" value={text} onChangeText={value => {setText(value); setPlan(null); setWebsite(null);}} editable={!busy}
        placeholder="Build a personal OS for my consulting practice." multiline maxLength={maxLength} />
      <Text style={styles.small}>Use your keyboard microphone to dictate.</Text>
      {text.length > maxLength && <Text style={styles.muted}>Keep this idea within {maxLength} characters.</Text>}
      <Button label={target === 'website' ? 'Build website' : 'Review plan'} primary busy={busy} disabled={text.trim().length < 3 || text.length > maxLength} onPress={request} />
    </View>
    {plan && <PlanCard plan={plan.value} busy={busy} onCancel={() => setPlan(null)} onApply={() => run(async () => {
      const {application} = await mobileApi.apply(plan.text, plan.value, plan.key);
      onOpen({type: 'app', value: application});
      void notifyCompletion().catch(() => {});
    }, 'Application saved.')} />}
    {website && <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.section}>Website built</Text>
      <Text style={styles.muted}>{website.value.source === 'model' ? 'AI generation complete' : 'Prepared build complete'}</Text>
      <Button label="Save and preview" primary busy={busy} onPress={() => run(async () => {
        const {project} = await mobileApi.saveWebsite(website.text, website.value);
        onOpen({type: 'website', value: project});
        void notifyCompletion().catch(() => {});
      }, 'Website saved.')} />
    </View>}
  </Page>;
}

function Account({busy, run, signOut}: {busy: boolean; run: Run; signOut: () => void}) {
  const [status, setStatus] = useState<{
    usage: Awaited<ReturnType<typeof mobileApi.usage>>; integrations: Awaited<ReturnType<typeof mobileApi.integrations>>;
    preferences: Awaited<ReturnType<typeof mobileApi.preferences>>['preferences'];
  } | null>(null);
  const [notifications, setNotifications] = useState<string | null>(null);
  return <Page title="Account">
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.section}>Usage and connections</Text>
      <Button label="Load account usage" disabled={busy} onPress={() => run(async () => {
        const [usage, integrations, {preferences}] = await Promise.all([mobileApi.usage(), mobileApi.integrations(), mobileApi.preferences()]);
        setStatus({usage, integrations, preferences});
      })} />
      {status && <>
        <Text style={styles.body}>{status.usage.attempts.length} recent model attempts</Text>
        <Text style={styles.small}>{status.usage.attempts.reduce((total, item) => total + (item.inputTokens || 0) + (item.outputTokens || 0), 0).toLocaleString()} measured input and output tokens</Text>
        <Text style={styles.muted}>{status.usage.billingEnabled ? 'Billing available' : 'Payments are off'}</Text>
        <Text style={styles.muted}>{status.integrations.enabled ? `${status.integrations.providers.filter(item => item.connected).length} connected providers` : 'Connections are unavailable for this account.'}</Text>
      </>}
      <Button label="Manage account on web" disabled={busy} onPress={() => run(() => Linking.openURL(COMPASS_ORIGIN + '/create?view=account'))} />
    </View>
    {status && <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.section}>Design preference</Text>
      <View style={styles.row}>{[['minimal', 'Minimal'], ['editorial', 'Editorial'], ['bold', 'Bold'], ['professional', 'Professional']].map(([value, label]) =>
        <Button key={value} label={label} disabled={busy} selected={status.preferences.visualDirection === value} onPress={() => run(async () => {
          const prior = (await mobileApi.preferences()).preferences;
          const {preferences} = await mobileApi.savePreferences({...prior, visualDirection: value});
          setStatus({...status, preferences});
        }, 'Design preference saved.')} />)}</View>
    </View>}
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.section}>Build notifications</Text>
      <Button label="Allow local notifications" disabled={busy} onPress={() => run(async () => {
        setNotifications(await enableCompletionNotifications() ? 'Enabled on this device.' : 'Notifications are still off.');
      })} />
      {!!notifications && <Text style={styles.muted}>{notifications}</Text>}
    </View>
    <View style={styles.row}>
      <Button label="Privacy" disabled={busy} onPress={() => run(() => Linking.openURL(COMPASS_ORIGIN + '/privacy'))} />
      <Button label="Sign out" disabled={busy} onPress={signOut} />
    </View>
  </Page>;
}

export default function App() {
  return <SafeAreaProvider>{Platform.OS === 'web' ? <SafeAreaView style={shell.safe}>
    <Page title="COMPASS"><Button label="Open COMPASS on web" primary onPress={() => {void Linking.openURL(COMPASS_ORIGIN);}} /></Page>
  </SafeAreaView> : <NativeWorkspace />}</SafeAreaProvider>;
}
