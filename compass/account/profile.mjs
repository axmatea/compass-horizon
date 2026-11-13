import {normalizePreferences,PREFERENCE_OPTIONS} from '../src/create/draft.mjs';

/** Strict server boundary; all values are optional, unknown fields are rejected. */
export function validateProfilePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.entries(value).some(([field,item]) => !Object.hasOwn(PREFERENCE_OPTIONS,field) || !PREFERENCE_OPTIONS[field].includes(item))) return null;
  return normalizePreferences(value);
}
