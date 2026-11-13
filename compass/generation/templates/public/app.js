// Standalone transport; session credentials remain in HttpOnly cookies.
(async () => {
  const $ = id => document.getElementById(id);
  let manifest;
  let boundUser = null;
  async function api(path,method = 'GET',data) {
    const privateAction = path.startsWith('/api/records') || path.startsWith('/api/assets') || path === '/api/auth/sign-out';
    const response = await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{accept:'application/json',...(data ? {'content-type':'application/json'} : {}),...(privateAction && boundUser ? {'x-compass-app-user':boundUser} : {})},...(data ? {body:JSON.stringify(data)} : {}),signal:AbortSignal.timeout(15000)});
    if (!response.ok) {const problem = await response.json().catch(() => ({}));if (problem.error === 'account_changed') location.reload();throw Error('Request failed');}
    return response.json();
  }
  const records = (action,value) => action==='asset'?api('/api/assets/'+encodeURIComponent(value.assetId)):api('/api/records' + (value.id ? '/' + encodeURIComponent(value.id) : ''),{list:'GET',create:'POST',update:'PUT',delete:'DELETE'}[action],['create','update'].includes(action) ? {data:value.data} : undefined);
  function open(session) { boundUser = session.user.id;mountCrudApplication(manifest,records); $('sign-out').hidden = false; }
  try {
    manifest = await api('/api/config');
    $('auth-title').textContent = manifest.title;
    const session = await api('/api/auth/get-session');
    if (session?.user?.id) open(session);
  } catch { $('auth-status').textContent = 'Couldn’t connect. Reload to try again.'; }
  $('auth-form').addEventListener('submit',async event => {
    event.preventDefault();
    const button = $('auth-submit'); button.disabled = true; $('auth-status').textContent = 'Signing in…';
    const data = {email:$('auth-email').value.trim(),password:$('auth-password').value,name:$('auth-name').value.trim()};
    try {
      await api('/api/auth/' + ($('auth-signup').checked ? 'sign-up' : 'sign-in') + '/email','POST',data);
      const session = await api('/api/auth/get-session');
      if (!session?.user?.id) throw Error('No session');
      $('auth-password').value = ''; open(session);
    } catch { $('auth-status').textContent = 'Check your details and try again. This local app uses .test email addresses.'; }
    finally { button.disabled = false; }
  });
  $('sign-out').addEventListener('click',async () => {
    try { await api('/api/auth/sign-out','POST',{}); location.reload(); }
    catch { $('app-status').textContent = 'Couldn’t sign out. Try again.'; }
  });
})();
