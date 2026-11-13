import {readDraft,writeDraft,validPrompt,normalizePreferences} from './draft.mjs'
import {createAccountApi,allowedEmail,safeSocialRedirect,accountErrorText,isAccountChanged,resolveCreateEntry} from './flow.mjs'

const $ = id => document.getElementById(id)
const api = createAccountApi()
const state = {config:null,user:null,draft:readDraft(),profilePreferences:{},guest:false,busy:false,signup:true,step:'prompt',flowMode:'project'}
const providerNames = {google:'Google',github:'GitHub',apple:'Apple'}
const accountForm = $('account-form')
const onboardingForm = $('onboarding-form')
const promptInput = $('create-prompt')
let epoch = 0

function message(text = '',error = false) {
  $('create-status').textContent = text
  $('create-status').dataset.error = String(error)
}
function busy(value) {
  state.busy = value
  document.querySelectorAll('.create-card button,.create-card input,.create-card textarea').forEach(control => { control.disabled = value })
  $('account-submit').textContent = value ? 'Continuing…' : state.signup ? 'Create account →' : 'Sign in →'
  $('start-building').textContent = value ? 'Preparing…' : state.flowMode === 'profile' ? 'Save choices →' : 'Start building →'
  $('create-card')?.setAttribute('aria-busy',String(value))
}
function signedIn(value) {
  return typeof value?.user?.id === 'string' && typeof value?.session?.id === 'string'
}
function bindIdentity(user) {
  state.user = user
  api.bindUser(user?.id || null)
}
function requireAccountChoice(error) {
  bindIdentity(null)
  state.profilePreferences = {}
  state.guest = false
  $('account-password').value = ''
  // Keep the idea, but revoke any automatic handoff. A new explicit login or
  // guest continuation must happen before this draft can be ready again.
  if (state.draft) persist({ready:false})
  renderProviders()
  mode(false)
  show('auth')
  message(accountErrorText(error),true)
}
function count() { $('prompt-count').textContent = `${promptInput.value.length}/500` }
function preferences() {
  const values = new FormData(onboardingForm)
  return normalizePreferences({projectType:values.get('projectType'),visualDirection:values.get('visualDirection')})
}
function showPreferences(value) {
  const normalized = normalizePreferences(value)
  onboardingForm.querySelectorAll('input[type=radio]').forEach(input => { input.checked = normalized[input.name] === input.value })
  capability()
}
function capability() {
  const value = preferences().projectType
  $('capability-note').textContent = value && value !== 'website'
    ? 'Your idea is kept. This first build is a website preview.' : 'Starts with a website preview.'
}
function persist({ready = false,choices} = {}) {
  const result = writeDraft({prompt:promptInput.value,preferences:choices ?? state.draft?.preferences ?? state.profilePreferences,ready})
  if (!result.ok) {
    message(result.error === 'invalid-prompt' ? 'Describe your idea in 3–500 characters.'
      : 'This browser can’t keep your idea through the next step. Allow session storage or use the public demo.',true)
    return null
  }
  state.draft = result.draft
  return result.draft
}
function show(step,{focus = true} = {}) {
  state.step = step
  $('idea-form').hidden = step !== 'prompt'
  $('auth-step').hidden = step !== 'auth'
  onboardingForm.hidden = step !== 'onboarding'
  const returning = state.flowMode !== 'project' && !state.draft
  const editing = returning && state.flowMode === 'profile'
  const titles = {prompt:'What will you make?',auth:returning ? 'Welcome back.' : 'Keep your idea.',onboarding:editing ? 'Your direction.' : 'Make it yours.'}
  const descriptions = {prompt:'Start with an idea.',auth:returning ? 'Sign in to your workspace.' : 'One account. A place to keep building.',onboarding:'Two choices. Both optional.'}
  $('create-title').textContent = titles[step]
  $('create-lede').textContent = descriptions[step]
  $('step-label').textContent = editing ? 'Preferences' : returning ? 'Your workspace' : step === 'onboarding' ? 'A direction for your project' : 'A new project'
  $('auth-prompt').textContent = state.draft?.prompt || ''
  $('onboarding-prompt').textContent = state.draft?.prompt || ''
  $('auth-summary').hidden = !state.draft
  $('onboarding-summary').hidden = !state.draft
  $('create-draft-note').hidden = returning
  $('start-building').textContent = editing ? 'Save choices →' : 'Start building →'
  $('skip-onboarding').textContent = editing ? 'Back' : 'Skip'
  $('capability-note').hidden = editing
  if (step === 'onboarding') {
    showPreferences(state.draft?.preferences ?? state.profilePreferences)
    $('save-scope').textContent = state.guest || !state.user ? 'Your choices stay in this tab.'
      : state.config?.persistence === 'durable' ? 'Saved with your account when you continue.' : 'Preview account · data may reset.'
  }
  if (focus) $('create-title').focus()
}
function next() {
  const entry = resolveCreateEntry({search:location.search,hasDraft:Boolean(state.draft),config:state.config || {},signedIn:Boolean(state.user && !state.guest)})
  state.flowMode = entry.mode
  api.setReturnMode(entry.mode)
  if (entry.step === 'workspace') { location.assign('/workspace'); return }
  if (entry.step === 'onboarding' && !state.user) state.guest = true
  if (entry.step === 'auth' && entry.mode !== 'project') mode(false)
  show(entry.step)
}
function mode(signup) {
  state.signup = signup
  $('signup-mode').setAttribute('aria-pressed',String(signup))
  $('signin-mode').setAttribute('aria-pressed',String(!signup))
  $('name-field').hidden = !signup
  $('account-name').required = signup
  $('account-password').autocomplete = signup ? 'new-password' : 'current-password'
  $('password-note').hidden = !signup
  $('account-submit').textContent = signup ? 'Create account →' : 'Sign in →'
  message()
}
function renderProviders() {
  const providers = state.config?.configured ? state.config.providers : []
  $('social-providers').replaceChildren()
  for (const provider of providers.filter(name => name !== 'email')) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'social-button'
    button.textContent = `Continue with ${providerNames[provider]}`
    button.addEventListener('click',() => social(provider))
    $('social-providers').append(button)
  }
  const email = providers.includes('email')
  accountForm.hidden = !email
  $('email-divider').hidden = !email || providers.length < 2
  $('auth-preview-note').hidden = !email || state.config?.emailMode !== 'test'
  $('auth-unavailable').hidden = providers.length > 0
  $('account-email').placeholder = state.config?.emailMode === 'test' ? 'you@example.test' : 'you@example.com'
  $('create-account-link').hidden = !state.config?.configured
  $('create-account-link').textContent = state.user ? 'Workspace' : 'Sign in'
  $('create-account-link').href = state.user ? '/workspace' : '/create?signin=1'
}
async function initialize() {
  const run = ++epoch
  $('retry-config').hidden = true
  busy(true)
  message('Getting ready…')
  try {
    state.config = await api.config()
    if (run !== epoch) return
    state.flowMode = resolveCreateEntry({search:location.search,hasDraft:Boolean(state.draft),config:state.config}).mode
    api.setReturnMode(state.flowMode)
    if (state.config.enabled && state.config.configured) {
      const session = await api.session()
      if (run !== epoch) return
      bindIdentity(signedIn(session) ? session.user : null)
      if (state.user && state.flowMode !== 'signin' && !Object.keys(state.draft?.preferences || {}).length) {
        try {
          const profile = await api.profile()
          if (run !== epoch) return
          state.profilePreferences = normalizePreferences(profile?.preferences)
          if (state.draft) state.draft.preferences = state.profilePreferences
        } catch(error) {
          if (isAccountChanged(error)) { requireAccountChoice(error); return }
          if (state.flowMode === 'profile') {
            show('auth')
            $('retry-config').hidden = false
            message('We couldn’t load your choices. Try again.',true)
            return
          }
          /* Profile is optional until the user explicitly continues. */
        }
      }
    }
    renderProviders()
    message()
    next()
  } catch {
    if (run !== epoch) return
    state.config = null
    bindIdentity(null)
    renderProviders()
    show(state.draft ? 'auth' : 'prompt',{focus:false})
    $('retry-config').hidden = false
    message('We couldn’t check account availability. Your idea is still here. Try again or continue without an account.',true)
  } finally { if (run === epoch) busy(false) }
}

async function authenticate(event) {
  event.preventDefault()
  if (state.busy || !accountForm.reportValidity() || (state.flowMode === 'project' && !persist())) return
  const email = $('account-email').value.trim()
  if (!allowedEmail(email,state.config)) { message('Use a .test email for this preview account.',true); $('account-email').focus(); return }
  const run = ++epoch
  busy(true)
  message()
  try {
    const details = {name:$('account-name').value.trim(),email,password:$('account-password').value}
    if (state.signup) await api.signUp(details)
    else await api.signIn(details)
    const session = await api.session()
    if (run !== epoch) return
    $('account-password').value = ''
    if (!signedIn(session)) { mode(false); message('Check your email to finish verification, then sign in. Your idea is still here.'); return }
    bindIdentity(session.user)
    state.guest = false
    if (state.flowMode !== 'signin' && !Object.keys(state.draft?.preferences || {}).length) {
      try {
        const profile = await api.profile()
        if (run !== epoch) return
        state.profilePreferences = normalizePreferences(profile?.preferences)
        if (state.draft) state.draft.preferences = state.profilePreferences
      } catch(error) {
        if (isAccountChanged(error)) { requireAccountChoice(error); return }
        if (state.flowMode === 'profile') {
          show('auth')
          $('retry-config').hidden = false
          message('We couldn’t load your choices. Try again.',true)
          return
        }
        /* The explicit profile write below remains authoritative. */
      }
    }
    next()
    message()
  } catch(error) {
    if (run === epoch) message(accountErrorText(error,state.signup ? 'signup' : 'sign-in'),true)
  } finally { if (run === epoch) busy(false) }
}
async function social(provider) {
  if (state.busy || !state.config?.providers.includes(provider) || (state.flowMode === 'project' && !persist())) return
  const run = ++epoch
  busy(true)
  message(`Opening ${providerNames[provider]}…`)
  try {
    const response = await api.social(provider)
    if (run !== epoch) return
    const url = safeSocialRedirect(response?.url,provider)
    if (!url) throw Error('Invalid redirect')
    // The API creates the provider's state/PKCE flow. The original prompt stays
    // in sessionStorage and the callback contains only the /create location.
    location.assign(url)
  } catch(error) {
    if (run === epoch) { message(accountErrorText(error),true); busy(false) }
  }
}
async function finish(skip = false) {
  if (state.busy) return
  const profileOnly = state.flowMode === 'profile' && !state.draft
  if (profileOnly && skip) { location.assign('/workspace'); return }
  const choices = skip ? {} : preferences()
  if (!profileOnly && !persist({choices})) return
  const run = ++epoch
  busy(true)
  message()
  try {
    const account = Boolean(state.user && !state.guest && state.config?.enabled && state.config.configured)
    if (profileOnly && !account) { show('auth'); message('Sign in to update your preferences.',true); busy(false); return }
    if (account) await api.saveProfile(choices)
    if (run !== epoch) return
    if (profileOnly) { location.assign('/workspace'); return }
    const saved = persist({choices,ready:true})
    if (!saved) { busy(false); return }
    location.assign(account ? '/workspace' : '/demo?from=create')
  } catch(error) {
    if (run === epoch) {
      if (isAccountChanged(error)) { requireAccountChoice(error); busy(false); return }
      message(accountErrorText(error,'profile'),true)
      // Expiry never silently converts a private action into a guest save.
      if (error?.status === 401) {
        bindIdentity(null)
        state.guest = false
        show('auth')
        message('Your session expired. Sign in again; your idea and choices are kept.',true)
      }
      busy(false)
    }
  }
}

$('idea-form').addEventListener('submit',event => {
  event.preventDefault()
  if (state.busy || !validPrompt(promptInput.value) || !persist()) {
    if (!state.busy && !validPrompt(promptInput.value)) { message('Describe your idea in 3–500 characters.',true); promptInput.focus() }
    return
  }
  state.guest = false
  message()
  next()
})
promptInput.addEventListener('input',count)
accountForm.addEventListener('submit',authenticate)
$('signup-mode').addEventListener('click',() => mode(true))
$('signin-mode').addEventListener('click',() => mode(false))
for (const id of ['edit-idea','onboarding-edit']) $(id).addEventListener('click',() => {
  if (state.busy) return
  message()
  show('prompt')
  promptInput.focus()
})
$('continue-guest').addEventListener('click',() => {
  if (state.busy) return
  if (!state.draft && state.flowMode !== 'project') { location.assign('/demo'); return }
  if (!persist()) return
  state.guest = true
  message()
  show('onboarding')
})
onboardingForm.addEventListener('change',capability)
onboardingForm.addEventListener('submit',event => { event.preventDefault(); finish() })
$('skip-onboarding').addEventListener('click',() => finish(true))
$('retry-config').addEventListener('click',initialize)
promptInput.value = state.draft?.prompt || ''
count()
initialize()
