const hint = 'Try a theme change or add a priority, due date or notes field.'
export function applicationResultOutcome(result,{creating = false} = {}) {
  const changed = result?.changed !== false
  const supplied = typeof result?.message === 'string' ? result.message.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,180) : ''
  return {changed,message:!changed ? supplied && !/application (?:updated|created)/i.test(supplied) ? supplied : hint
    : supplied || (creating ? 'Application created.' : 'Application updated.')}
}

export function requireApplicationVersion(response,version) {
  if (!Number.isSafeInteger(version) || response?.headers?.get('x-compass-app-version') !== String(version)) {
    throw Error('The project changed. Reopen it before continuing.')
  }
}
