const PROVIDERS = ['email','google','github','apple']

// Returning-account routes carry only mode flags. A pending idea always keeps
// the normal creation path; it is never replaced by a fabricated prompt.
export function resolveCreateEntry({search = '',hasDraft = false,config = {},signedIn = false} = {}) {
  const query = new URLSearchParams(search)
  const view = query.get('view')
  if (['recover','reset','verify'].includes(view)) return {mode:view,step:'manage'}
  if (view === 'account') return {mode:'account',step:config.enabled && config.configured && signedIn ? 'manage' : 'auth'}
  if (view === 'preferences' && config.enabled && config.configured) return {mode:'profile',step:signedIn ? 'onboarding' : 'auth'}
  if (!hasDraft && config.enabled && config.configured) {
    if (query.get('edit') === '1') return {mode:'profile',step:signedIn ? 'onboarding' : 'auth'}
    if (query.get('signin') === '1') return {mode:'signin',step:signedIn ? 'workspace' : 'auth'}
  }
  return {mode:'project',step:!hasDraft ? 'prompt' : signedIn || config.enabled === false ? 'onboarding' : 'auth'}
}

export function normalizeAccountConfig(value) {
  const enabled = value?.enabled === true
  const configured = enabled && value?.configured === true
  return {enabled,configured,providers:configured && Array.isArray(value?.providers)
    ? [...new Set(value.providers.filter(provider => PROVIDERS.includes(provider)))] : [],
  emailMode:['verification','verified'].includes(value?.emailMode) ? 'verified' : 'test',
  persistence:value?.persistence === 'durable' ? 'durable' : 'ephemeral-preview',
  features:{accountManagement:configured && value?.features?.accountManagement === true,
    passwordRecovery:configured && value?.features?.passwordRecovery === true,
    emailVerification:configured && value?.features?.emailVerification === true,
    accountLinking:configured && value?.features?.accountLinking === true}}
}

export function allowedEmail(value, config) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false
  return config?.emailMode !== 'test' || /^[^\s@]+@[^\s@]+\.test$/i.test(value)
}

export function safeSocialRedirect(value, provider) {
  if (typeof value !== 'string' || value.length > 8192) return null
  try {
    const url = new URL(value)
    const hosts = {google:['accounts.google.com'],github:['github.com'],apple:['appleid.apple.com']}[provider]
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && hosts?.includes(url.hostname) ? url.href : null
  } catch { return null }
}

export class AccountRequestError extends Error {
  constructor(code, status = 0) { super('Account request failed'); this.name = 'AccountRequestError'; this.code = code; this.status = status }
}

export function createAccountApi({fetch:request = globalThis.fetch,origin = globalThis.location?.origin,timeoutMs = 20000} = {}) {
  const base = new URL(origin)
  if (!['http:','https:'].includes(base.protocol)) throw new TypeError('Invalid application origin')
  const callbackURL = base.origin + '/create'
  let boundUserId = null
  let returnMode = 'project'
  const callback = () => callbackURL + (returnMode === 'profile' ? '?view=preferences' : returnMode === 'account' ? '?view=account' : returnMode === 'signin' ? '?signin=1' : '')
  async function send(path,method = 'GET',body,expectedUserId = null) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(),timeoutMs)
    try {
      const response = await request(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{accept:'application/json',...(body === undefined ? {} : {'content-type':'application/json'}),
          ...(expectedUserId ? {'x-compass-user':expectedUserId} : {})},
        signal:controller.signal,...(body === undefined ? {} : {body:JSON.stringify(body)})})
      let data
      try { data = await response.json() } catch { throw new AccountRequestError('invalid-response',response.status) }
      if (expectedUserId && boundUserId !== expectedUserId) throw new AccountRequestError('account_changed',403)
      if (!response.ok) throw new AccountRequestError(typeof data?.code === 'string' ? data.code
        : data?.error === 'account_changed' ? 'account_changed' : 'request-failed',response.status)
      return data
    } catch(error) {
      if (error instanceof AccountRequestError) throw error
      throw new AccountRequestError(controller.signal.aborted ? 'timeout' : 'network')
    } finally { clearTimeout(timer) }
  }
  function privateRequest(path,method = 'GET',body) {
    if (!boundUserId) return Promise.reject(new AccountRequestError('identity-required',401))
    return send(path,method,body,boundUserId)
  }
  return {
    // This is a continuity assertion, never an authentication source. The server
    // still verifies the HttpOnly session and rejects another cookie identity.
    bindUser(userId) {
      if (userId !== null && (typeof userId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(userId))) throw new TypeError('Invalid identity binding')
      boundUserId = userId
    },
    setReturnMode(value) {
      if (!['project','signin','profile','account','recover','reset','verify'].includes(value)) throw new TypeError('Invalid return mode')
      returnMode = value
    },
    config:async () => normalizeAccountConfig(await send('/api/account/config')),
    session:() => send('/api/auth/get-session'),
    profile:() => privateRequest('/api/account/profile'),
    saveProfile:preferences => privateRequest('/api/account/profile','PUT',{preferences}),
    signUp:({name,email,password}) => send('/api/auth/sign-up/email','POST',{name,email,password,callbackURL:base.origin+'/create?view=verify'}),
    signIn:({email,password}) => send('/api/auth/sign-in/email','POST',{email,password,callbackURL:callback()}),
    social:provider => send('/api/auth/sign-in/social','POST',{provider,callbackURL:callback()}),
    signOut:() => boundUserId ? privateRequest('/api/auth/sign-out','POST',{}) : send('/api/auth/sign-out','POST',{}),
    updateName:name => privateRequest('/api/auth/update-user','POST',{name}),
    changePassword:({currentPassword,newPassword}) => privateRequest('/api/auth/change-password','POST',{currentPassword,newPassword,revokeOtherSessions:true}),
    sessions:() => privateRequest('/api/auth/list-sessions'),
    revokeOtherSessions:() => privateRequest('/api/auth/revoke-other-sessions','POST',{}),
    accounts:() => privateRequest('/api/auth/list-accounts'),
    linkSocial:provider => privateRequest('/api/auth/link-social','POST',{provider,callbackURL:base.origin+'/create?view=account'}),
    unlinkAccount:accountId => privateRequest('/api/auth/unlink-account','POST',{accountId}),
    changeEmail:newEmail => privateRequest('/api/auth/change-email','POST',{newEmail,callbackURL:base.origin+'/create?view=verify'}),
    requestPasswordReset:email => send('/api/auth/request-password-reset','POST',{email,redirectTo:base.origin+'/create?view=reset'}),
    resetPassword:({token,newPassword}) => send('/api/auth/reset-password','POST',{token,newPassword}),
    resendVerification:email => send('/api/auth/send-verification-email','POST',{email,callbackURL:base.origin+'/create?view=verify'},boundUserId),
  }
}

export function accountErrorText(error, action = 'sign-in') {
  if (isAccountChanged(error)) return 'The account changed. Sign in again or continue without an account. Your idea is kept.'
  if (error?.code === 'timeout') return 'That took too long. Your idea is still here. Try again.'
  if (error?.code === 'network' || error?.code === 'invalid-response') return 'We couldn’t connect. Your idea is still here. Try again.'
  if (error?.status === 429) return 'Too many attempts. Wait a moment, then try again.'
  if (error?.code === 'EMAIL_NOT_VERIFIED') return 'Verify your email, then sign in to continue.'
  if (['INVALID_TOKEN','TOKEN_EXPIRED','INVALID_VERIFICATION_TOKEN','INVALID_TOKEN_SIGNATURE'].includes(error?.code)) return 'This link is invalid or expired. Request a new one.'
  if (['INVALID_PASSWORD','INVALID_EMAIL_OR_PASSWORD'].includes(error?.code)) return 'Check your password and try again.'
  if (error?.code === 'STAGING_ACCOUNT_LIMIT') return 'This preview has reached its test-account limit.'
  if (['PASSWORD_TOO_SHORT','PASSWORD_TOO_LONG'].includes(error?.code)) return 'Use a password between 12 and 128 characters.'
  if (error?.code === 'PASSWORD_MISMATCH') return 'The passwords must match.'
  if (action === 'manage') return 'That request could not finish. Check your account and try again.'
  if (['USER_ALREADY_EXISTS','USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'].includes(error?.code)) return 'An account already uses this email. Sign in to continue.'
  return action === 'profile' ? 'We couldn’t save your choices. Your idea is still here. Try again.'
    : action === 'signup' ? 'We couldn’t create your account. Check your details and try again.'
      : 'We couldn’t sign you in. Check your details and try again.'
}

export function isAccountChanged(error) {
  return error?.status === 403 && error?.code === 'account_changed'
}
