/** Render-only formatting of v1 values. No state interpretation lives here. */
import type { FieldName, FieldValue } from './types'
import { t } from './i18n'

export const FIELD_ORDER: FieldName[] = ['task', 'date', 'time', 'cuisine', 'location', 'party_size']
export const labelFor = (f: string) => t.field[f] ?? f

export function time12(v: FieldValue): string | null {
  if (v == null) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v))
  if (!m) return String(v)
  const h = Number(m[1]); const min = m[2]
  return `${h % 12 === 0 ? 12 : h % 12}:${min} ${h >= 12 ? 'PM' : 'AM'}`
}

/** Uppercase the first letter for display; locale-aware, no-op for scripts without case. */
const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1)

export function formatValue(field: string, v: FieldValue): string | null {
  if (v == null || v === '') return null
  if (field === 'time') return time12(v)
  if (field === 'party_size') return String(v)
  return cap(String(v))
}

export const toolLabel = (tool: string) => cap(tool.replace(/^mock_/, '').replace(/_/g, ' '))
