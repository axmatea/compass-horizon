import {randomUUID} from 'expo-crypto';
import {fetch as expoFetch} from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import {COMPASS_ORIGIN, checkedId, createTransport} from './transport.mjs';

export {COMPASS_ORIGIN};

const sessionKey = 'compass.session.v1';
const transport = createTransport(expoFetch as typeof fetch, {
  get: () => SecureStore.getItemAsync(sessionKey),
  set: value => SecureStore.setItemAsync(sessionKey, value, {keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY}),
  clear: () => SecureStore.deleteItemAsync(sessionKey),
});

type Source = 'model' | 'prepared' | string;
export type MobileTarget = 'ios' | 'android' | 'cross-platform';
export type Target = 'website' | 'application' | MobileTarget;
export type Manifest = {
  title: string;
  description: string;
  kind: string;
  entity?: {plural: string; fields: Array<{label: string}>};
  crm?: object;
  mobile?: {platform: MobileTarget};
};
export type Application = {id: string; manifest: Manifest; version: number; source: Source; updatedAt: string};
export type WebsiteSummary = {id: string; name: string; updatedAt: string; revisions: number};
export type WebsiteRevision = {
  id: string;
  at: string;
  prompt: string;
  number: number;
  plan: {intent: Record<string, unknown>; version: number};
  render: {html: string; version: number; pending: string[]};
  source: Source;
  placeholder?: boolean;
};
export type Website = Omit<WebsiteSummary, 'revisions'> & {revisions: WebsiteRevision[]};
export type Plan = {manifest: Manifest; source: Source; baseVersion: number | null; contextVersion: number | null};
export type ContextNotes = {goal: string; architecture: string; preferences: string; dependencies: string; problems: string};
export type Decision = {id: string; text: string; supersededBy: string | null};
export type ContextTask = {id: string; text: string; status: 'active' | 'done' | 'cancelled'};
export type Context = {version: number; notes: ContextNotes; decisions: Decision[]; tasks: ContextTask[]};
export type Revision = {version: number; prompt: string; createdAt: string; buildReport?: {outcome: string; diagnostics: unknown[]}};
type UserPreferences = Record<string, unknown>;
type UsageAttempt = {id: string; provider?: string; status?: string; inputTokens?: number; outputTokens?: number};
type Integration = {provider?: string; id?: string; connected?: boolean; status?: string};
type RecordRow = {id: string; data: Record<string, string | number>};
type WebsiteBuild = {html: string; version: number; intent: Record<string, unknown>; source: Source; placeholder?: boolean; pending: string[]};

const request = transport.request;
const appPath = (id: string) => '/api/account/apps/' + checkedId(id);
const post = <T,>(path: string, json: unknown, key?: string) => request<T>(path, {method: 'POST', json, key});

export const mobileApi = {
  ...transport,
  registration: (name: string, email: string, password: string) => post('/api/auth/sign-up/email', {
    name, email, password, callbackURL: COMPASS_ORIGIN + '/create?view=verify',
  }),
  passwordReset: (email: string) => post('/api/auth/request-password-reset', {
    email, redirectTo: COMPASS_ORIGIN + '/create?view=reset',
  }),
  applications: () => request<{applications: Application[]}>('/api/account/apps'),
  application: (id: string) => request<{application: Application}>(appPath(id)),
  websites: () => request<{projects: WebsiteSummary[]}>('/api/account/projects'),
  website: (id: string) => request<{project: Website}>('/api/account/projects/' + checkedId(id)),
  usage: () => request<{billingEnabled: boolean; creditsEnabled: boolean; attempts: UsageAttempt[]}>('/api/account/usage'),
  integrations: () => request<{enabled: boolean; providers: Integration[]}>('/api/account/integrations'),
  preferences: () => request<{preferences: UserPreferences}>('/api/account/profile'),
  savePreferences: (preferences: UserPreferences) => request<{preferences: UserPreferences}>('/api/account/profile', {method: 'PUT', json: {preferences}}),
  plan: (text: string, target: Exclude<Target, 'website'>, current?: Application) => post<Plan>(
    current ? appPath(current.id) + '/plan' : '/api/account/apps/plan', {
      text, ...(current ? {version: current.version} : target !== 'application' ? {platform: target} : {}),
    }, 'mobile-plan-' + randomUUID()),
  apply: (text: string, plan: Plan, key: string, current?: Application) => post<{application: Application}>(
    current ? appPath(current.id) + '/build-plan' : '/api/account/apps/build-plan', {
      text, manifest: plan.manifest,
      ...(current ? {version: plan.baseVersion, contextVersion: plan.contextVersion} : {}),
    }, key),
  buildWebsite: (text: string, key: string, resumeIntent?: WebsiteRevision['plan']['intent']) => post<WebsiteBuild>(
    '/api/account/turn', {text, ...(resumeIntent ? {resumeIntent} : {})}, key),
  saveWebsite: (text: string, build: WebsiteBuild, project?: Website) => {
    if (!build.html || !build.version || !build.intent || !Array.isArray(build.pending) || build.pending.length) throw new Error('incomplete_website');
    const name = (typeof build.intent.business === 'string' && build.intent.business.trim()) || 'Website';
    const revision = {
      id: 'r_' + randomUUID(), at: new Date().toISOString(), prompt: text.slice(0, 500), number: (project?.revisions.at(-1)?.number || 0) + 1,
      plan: {intent: build.intent, version: build.version},
      render: {html: build.html, version: build.version, pending: []},
      source: build.source, placeholder: Boolean(build.placeholder),
    };
    const revisions = [...(project?.revisions || []), revision].slice(-8);
    while (revisions.length > 1 && JSON.stringify(revisions).length > 390000) revisions.shift();
    return post<{project: Website}>('/api/account/projects', {
      name: project?.name || name.slice(0, 64), revisions,
      ...(project ? {projectId: project.id, expectedUpdatedAt: project.updatedAt} : {}),
    });
  },
  context: (id: string) => request<{context: Context}>(appPath(id) + '/context'),
  updateContext: (id: string, version: number, notes: ContextNotes) => request<{context: Context}>(appPath(id) + '/context', {method: 'PUT', json: {version, notes}}),
  changeContext: (id: string, version: number, input: {action: string; id?: string; text?: string; status?: string}) => post<{context: Context}>(appPath(id) + '/context', {version, ...input}),
  revisions: (id: string) => request<{revisions: Revision[]}>(appPath(id) + '/revisions'),
  restoreRevision: (id: string, version: number) => post<{application: Application}>(appPath(id) + '/restore', {version}),
  records: (app: Application) => app.manifest.crm
    ? request<{records: RecordRow[]}>(appPath(app.id) + '/crm/clients', {appVersion: app.version})
    : request<{records: RecordRow[]}>(appPath(app.id) + '/records'),
  uploadImage: (app: Application, bytes: ArrayBuffer, mime: 'image/png' | 'image/jpeg') => request<{application: Application}>(appPath(app.id) + '/assets', {method: 'POST', bytes, mime, appVersion: app.version}),
};

const messages: Record<string, string> = {
  invalid_email_or_password: 'Check your email and password.',
  email_not_verified: 'Verify your email before signing in.',
  user_already_exists: 'Sign in or reset your password to continue.',
  session_cookie_missing: 'This sign-in didn’t create a mobile session. Verify your email and try again.',
  request_timed_out: 'The request took too long. Refresh Projects before trying again.',
  auth_unavailable: 'Account service is temporarily unavailable.',
  sign_in_required: 'Sign in to continue.',
  account_changed: 'This session changed. Sign in again.',
  account_rate_limited: 'Too many requests. Try again shortly.',
  rate_limited: 'Too many requests. Try again shortly.',
  invalid_response: 'COMPASS returned an unexpected response. Try again.',
  project_context_conflict: 'Project context changed on another device. Refresh first.',
  version_conflict: 'This project changed on another device. Refresh and request a new plan.',
  project_version_conflict: 'This website changed on another device. Refresh and build a new revision.',
  application_limit: 'Your account has reached its application limit.',
  invalid_asset: 'Choose a PNG or JPEG up to 512 KB and 5 megapixels.',
  asset_file_limit: 'This project already has eight images.',
  insufficient_credits: 'Your account does not have enough available credits.',
  build_in_progress: 'This request is still in progress. Refresh Projects before trying again.',
  invalid_platform: 'This project type is unavailable for this release.',
};

export function errorText(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return messages[code] || 'This request could not finish. Try again.';
}

export const targetLabels: Record<Target, string> = {
  website: 'Website', application: 'Web app', ios: 'iOS', android: 'Android', 'cross-platform': 'iOS + Android',
};
