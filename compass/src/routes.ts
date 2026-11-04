// Dev and preview mirror the server's three core pages; unknown routes stay 404.
export function corePage(url: string): string | undefined {
  const queryAt = url.indexOf('?');
  const pathname = queryAt < 0 ? url : url.slice(0, queryAt);
  const query = queryAt < 0 ? '' : url.slice(queryAt);
  if (pathname === '/') return `/index.html${query}`;
  if (/^\/(app|office)\/?$/.test(pathname)) return `/app.html${query}`;
  if (/^\/login\/?$/.test(pathname)) return `/login.html${query}`;
}
