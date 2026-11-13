import { fail } from './security.mjs';

const google = { issuer: 'https://accounts.google.com', authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth', token_endpoint: 'https://oauth2.googleapis.com/token', revocation_endpoint: 'https://oauth2.googleapis.com/revoke' };
const scope = name => `https://www.googleapis.com/auth/${name}`;
export const PROVIDERS = Object.freeze({
  github: { label: 'GitHub', prefix: 'GITHUB', pkce: true, auth: 'post',
    server: { issuer: 'https://github.com', authorization_endpoint: 'https://github.com/login/oauth/authorize', token_endpoint: 'https://github.com/login/oauth/access_token' },
    scopes: ['read:user'], permissions: ['Read your profile and public repository metadata'],
    limitation: 'Public repository export requires a separate explicit grant and confirmation. No private repository access.' },
  'google-drive': { label: 'Google Drive', prefix: 'GOOGLE', pkce: true, auth: 'post', server: google,
    scopes: [scope('drive.metadata.readonly')], permissions: ['Read Drive file metadata; no file content or writes'] },
  'google-sheets': { label: 'Google Sheets', prefix: 'GOOGLE', pkce: true, auth: 'post', server: google,
    scopes: [scope('spreadsheets.readonly')], permissions: ['Read cells from an explicitly selected spreadsheet and bounded range'],
    limitation: 'Google grants account-wide spreadsheet read permission; COMPASS requires an explicit spreadsheet ID on every read.' },
  gmail: { label: 'Gmail metadata', prefix: 'GOOGLE', pkce: true, auth: 'post', server: google,
    scopes: [scope('gmail.metadata')], permissions: ['Read message IDs, labels and selected headers; no bodies, attachments or sending'] },
  'google-calendar': { label: 'Google Calendar', prefix: 'GOOGLE', pkce: true, auth: 'post', server: google,
    scopes: [scope('calendar.events.readonly')], permissions: ['Read selected calendar event summaries and times; no writes'] },
  notion: { label: 'Notion selected pages', prefix: 'NOTION', pkce: false, auth: 'basic',
    server: { issuer: 'https://api.notion.com', authorization_endpoint: 'https://api.notion.com/v1/oauth/authorize', token_endpoint: 'https://api.notion.com/v1/oauth/token' },
    scopes: [], permissions: ['Read metadata and one bounded block page from an explicitly selected accessible page'],
    limitation: 'Notion uses configured integration capabilities and its page picker, not OAuth scopes. Configure Read content only. No documented PKCE support.' },
  slack: { label: 'Slack public channels', prefix: 'SLACK', pkce: true, auth: 'none',
    server: { issuer: 'https://slack.com', authorization_endpoint: 'https://slack.com/oauth/v2/authorize', token_endpoint: 'https://slack.com/api/oauth.v2.access' },
    scopes: ['channels:read'], permissions: ['List public channel names and IDs; no message history, private channels or sending'],
    limitation: 'Requires an existing test app with PKCE enabled and an HTTPS staging callback. The grant represents a workspace bot installation.' },
});
export const providerIds = Object.freeze(Object.keys(PROVIDERS));
for (const definition of Object.values(PROVIDERS)) {
  Object.freeze(definition.server); Object.freeze(definition.scopes); Object.freeze(definition.permissions); Object.freeze(definition);
}
export function providerDefinition(id) {
  if (!Object.hasOwn(PROVIDERS, id)) fail(404, 'integration_provider_unknown');
  return PROVIDERS[id];
}
export const text = (value, max = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : '';
const array = value => Array.isArray(value) ? value : [];
const identifier = (value, expression) => { if (typeof value !== 'string' || !expression.test(value)) fail(400, 'integration_invalid_input'); return value; };
export function repositoryName(value) {
  identifier(value, /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/);
  if (value.split('/').some(p => p === '.' || p === '..') || value.endsWith('.git')) fail(400, 'integration_invalid_repository');
  return value;
}
const link = (base, path, query = {}) => {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.href;
};
export function validateReadInput(provider, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) fail(400, 'integration_invalid_input');
  const allowed = { github: ['repository'], 'google-drive': [], 'google-sheets': ['spreadsheetId', 'range'], gmail: ['messageId'], 'google-calendar': ['calendarId', 'timeMin', 'timeMax'], notion: ['pageId'], slack: [] }[provider];
  if (!allowed || Object.keys(input).some(key => !allowed.includes(key))) fail(400, 'integration_invalid_input');
  if (provider === 'github' && input.repository !== undefined) repositoryName(input.repository);
  if (provider === 'google-sheets') {
    identifier(input.spreadsheetId, /^[A-Za-z0-9_-]{10,128}$/);
    // Explicit small rectangular A1 ranges only. Never fetch an entire sheet.
    identifier(input.range, /^(?:(?:[A-Za-z0-9_-]{1,80}|'[A-Za-z0-9_ -]{1,80}')!)?([A-Z]{1,2})([1-9][0-9]{0,4}):([A-Z]{1,2})([1-9][0-9]{0,4})$/);
    const [, a, r1, b, r2] = input.range.match(/([A-Z]{1,2})([1-9][0-9]{0,4}):([A-Z]{1,2})([1-9][0-9]{0,4})$/);
    const col = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    if (col(b) < col(a) || +r2 < +r1 || col(b) - col(a) >= 20 || +r2 - +r1 >= 100 || (col(b) - col(a) + 1) * (+r2 - +r1 + 1) > 1000) fail(400, 'integration_range_too_large');
  }
  if (provider === 'gmail' && input.messageId !== undefined) identifier(input.messageId, /^[A-Za-z0-9_-]{1,128}$/);
  if (provider === 'google-calendar') {
    identifier(input.calendarId, /^[A-Za-z0-9_@.+-]{1,200}$/);
    for (const value of [input.timeMin, input.timeMax]) identifier(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/);
    const span = Date.parse(input.timeMax) - Date.parse(input.timeMin);
    if (!Number.isFinite(span) || span <= 0 || span > 31 * 86400000) fail(400, 'integration_invalid_time_window');
  }
  if (provider === 'notion') identifier(input.pageId, /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i);
  return input;
}
export async function readProvider(provider, input, request) {
  input = validateReadInput(provider, input);
  if (provider === 'github') {
    if (input.repository) {
      const repo = await request(`https://api.github.com/repos/${repositoryName(input.repository)}`);
      if (repo.private !== false || repo.visibility && repo.visibility !== 'public') fail(403, 'integration_public_repository_required');
      return { repository: repoMetadata(repo) };
    }
    const repos = await request('https://api.github.com/user/repos?visibility=public&per_page=30&sort=updated');
    return { repositories: array(repos).filter(r => r.private === false).slice(0, 30).map(repoMetadata) };
  }
  if (provider === 'google-drive') {
    const data = await request(link('https://www.googleapis.com', '/drive/v3/files', { pageSize: '30', q: 'trashed = false', fields: 'files(id,name,mimeType,modifiedTime),nextPageToken' }));
    return { files: array(data.files).slice(0, 30).map(f => ({ id: text(f.id, 128), name: text(f.name), mimeType: text(f.mimeType, 120), modifiedTime: text(f.modifiedTime, 40) })), hasMore: !!data.nextPageToken };
  }
  if (provider === 'google-sheets') {
    const data = await request(link('https://sheets.googleapis.com', `/v4/spreadsheets/${input.spreadsheetId}/values/${encodeURIComponent(input.range)}`, { valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS' }));
    const [, firstCol, firstRow, lastCol, lastRow] = input.range.match(/([A-Z]{1,2})([1-9][0-9]{0,4}):([A-Z]{1,2})([1-9][0-9]{0,4})$/);
    const column = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    return { spreadsheetId: input.spreadsheetId, range: input.range, values: array(data.values).slice(0, +lastRow - +firstRow + 1).map(row => array(row).slice(0, column(lastCol) - column(firstCol) + 1).map(v => text(String(v ?? ''), 1000))) };
  }
  if (provider === 'gmail') {
    const base = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
    if (!input.messageId) {
      const data = await request(base + '?maxResults=20&fields=messages(id,threadId),nextPageToken');
      return { messages: array(data.messages).slice(0, 20).map(m => ({ id: text(m.id, 128), threadId: text(m.threadId, 128) })), hasMore: !!data.nextPageToken };
    }
    const url = new URL(`${base}/${input.messageId}`);
    url.searchParams.set('format', 'metadata'); url.searchParams.set('fields', 'id,threadId,labelIds,internalDate,payload/headers');
    for (const header of ['From', 'To', 'Subject', 'Date']) url.searchParams.append('metadataHeaders', header);
    const data = await request(url.href);
    return { id: text(data.id, 128), threadId: text(data.threadId, 128), labels: array(data.labelIds).slice(0, 30).map(x => text(x, 100)), headers: array(data.payload?.headers).filter(h => ['from', 'to', 'subject', 'date'].includes(h.name?.toLowerCase())).slice(0, 12).map(h => ({ name: text(h.name, 20), value: text(h.value, 500) })) };
  }
  if (provider === 'google-calendar') {
    const data = await request(link('https://www.googleapis.com', `/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`, { timeMin: input.timeMin, timeMax: input.timeMax, maxResults: '30', singleEvents: 'true', orderBy: 'startTime', fields: 'items(id,summary,status,start,end),nextPageToken' }));
    return { events: array(data.items).slice(0, 30).map(e => ({ id: text(e.id, 150), summary: text(e.summary), status: text(e.status, 30), start: text(e.start?.dateTime || e.start?.date, 50), end: text(e.end?.dateTime || e.end?.date, 50) })), hasMore: !!data.nextPageToken };
  }
  if (provider === 'notion') {
    const pageId = input.pageId.toLowerCase();
    const page = await request(`https://api.notion.com/v1/pages/${pageId}`);
    if (page.object !== 'page') fail(502, 'integration_invalid_response');
    const blocks = await request(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=30`);
    const title = Object.values(page.properties || {}).find(p => p?.type === 'title');
    return { id: text(page.id, 40), title: array(title?.title).slice(0, 20).map(v => text(v.plain_text)).join('').slice(0, 500),
      blocks: array(blocks.results).slice(0, 30).map(b => ({ id: text(b.id, 40), type: text(b.type, 40), text: array(b[b.type]?.rich_text).slice(0, 20).map(r => text(r.plain_text)).join('').slice(0, 2000), hasChildren: b.has_children === true })), hasMore: blocks.has_more === true };
  }
  if (provider === 'slack') {
    const data = await request('https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=30');
    if (data.ok !== true) fail(502, 'integration_provider_rejected');
    return { channels: array(data.channels).filter(c => c.is_private === false && c.is_channel === true).slice(0, 30).map(c => ({ id: text(c.id, 40), name: text(c.name, 100), memberCount: Number.isSafeInteger(c.num_members) ? c.num_members : null })), hasMore: !!data.response_metadata?.next_cursor };
  }
  fail(404, 'integration_provider_unknown');
}
function repoMetadata(r) {
  return { name: text(r.full_name, 150), description: text(r.description, 500), defaultBranch: text(r.default_branch, 100), archived: r.archived === true, canPush: r.permissions?.push === true };
}
