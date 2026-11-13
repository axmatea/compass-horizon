export const OPERATION_STORAGE_KEY = 'compass.pending-operation.v1'
const TTL = 24 * 60 * 60 * 1000
const validOwner = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value)
const validKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value)
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const unavailable = () => Object.assign(new Error('This tab cannot safely keep a pending build. Enable session storage and try again.'), {code:'operation_storage_unavailable'})

function recordFrom(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  try {
    const value = JSON.parse(raw)
    if (!plain(value) || Object.keys(value).length !== 4
      || !validOwner(value.owner) || !validKey(value.key)
      || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)
      || !Number.isSafeInteger(value.at) || value.at < 0) return null
    return value
  } catch { return null }
}

// A receipt handle, never a prompt or credential. Keep it through reloads and
// unknown network outcomes; only an acknowledged result may clear it.
export async function operationKey({owner,payload}, {
  storage = globalThis.sessionStorage,
  now = Date.now,
  id = () => globalThis.crypto.randomUUID(),
} = {}) {
  if (!validOwner(owner) || typeof payload !== 'string' || !payload) throw new TypeError('Invalid pending build')
  if (!storage?.getItem || !storage?.setItem) throw unavailable()
  const at = now()
  if (!Number.isSafeInteger(at) || at < 0) throw new TypeError('Invalid pending build timestamp')
  const bytes = new TextEncoder().encode(payload)
  const digest = await globalThis.crypto.subtle.digest('SHA-256',bytes)
  const hash = Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')
  let previous
  try { previous = recordFrom(storage.getItem(OPERATION_STORAGE_KEY)) } catch { throw unavailable() }
  if (previous?.owner === owner && previous.hash === hash && previous.at <= at && at - previous.at < TTL) return previous.key
  const key = id()
  if (!validKey(key)) throw new TypeError('Invalid pending build key')
  const raw = JSON.stringify({owner,hash,key,at})
  try {
    storage.setItem(OPERATION_STORAGE_KEY,raw)
    if (storage.getItem(OPERATION_STORAGE_KEY) !== raw) throw unavailable()
  } catch { throw unavailable() }
  return key
}

export function clearOperation({owner,key}, {storage} = {}) {
  if (!validOwner(owner) || !validKey(key)) return false
  try {
    if (storage === undefined) storage = globalThis.sessionStorage
    if (!storage?.getItem || !storage?.removeItem) return false
    const record = recordFrom(storage.getItem(OPERATION_STORAGE_KEY))
    if (record?.owner !== owner || record.key !== key) return false
    storage.removeItem(OPERATION_STORAGE_KEY)
    return storage.getItem(OPERATION_STORAGE_KEY) === null
  } catch { return false }
}
