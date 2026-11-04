// Only a fixed internal destination is accepted; an invitation never supplies a redirect URL.
export function workspaceReturn(pathname = window.location.pathname, search = window.location.search): string | null {
  const query = new URLSearchParams(search);
  if (!/^\/login\/?$/.test(pathname)) return null;
  if (query.get('returnTo') !== '/app') return null;
  const invite = query.get('workspaceInvite');
  return invite && /^[A-Za-z0-9_-]{43}$/.test(invite) ? `/app?workspaceInvite=${encodeURIComponent(invite)}` : '/app';
}

export function afterSignupLocation(pathname = window.location.pathname, search = window.location.search): string {
  const destination = workspaceReturn(pathname, search);
  const invite = destination ? new URL(destination, 'http://localhost').searchParams.get('workspaceInvite') : null;
  return '/login?returnTo=/app' + (invite ? `&workspaceInvite=${encodeURIComponent(invite)}` : '');
}
