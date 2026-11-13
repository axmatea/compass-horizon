// An explicit website choice wins; skipped personalization must still preserve
// an unmistakable application request instead of turning it into a static page.
export function applicationDraft(draft) {
  if(draft?.ready!==true)return false
  const type=draft.preferences?.projectType
  if(type==='website')return false
  if(['saas','internal-tool','client-portal'].includes(type))return true
  return /\b(?:crm|inventory|task tracker|expense tracker|project tracker|database|dashboard|client portal|web app|application|manage (?:contacts|bookings|tasks|stock))\b/i.test(String(draft.prompt || ''))
}
