// Publish only founder-approved statements with a public attribution source.
// Quotes live in studio-content.mjs so team and voices stay in one place.
import { studioQuotes } from './studio-content.mjs'

export const testimonials = studioQuotes

const clean = (value,max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max) : ''

export function visibleTestimonials(entries = testimonials) {
  if (!Array.isArray(entries)) return []
  const result = []
  for (const entry of entries.slice(0,12)) {
    if (!entry || entry.approved !== true) continue
    const quote = clean(entry.quote,600)
    const name = clean(entry.name,100)
    const role = clean(entry.role,140)
    let source
    try { source = new URL(entry.sourceUrl) } catch { continue }
    if (!quote || !name || source.protocol !== 'https:' || source.username || source.password) continue
    result.push({quote,name,role,sourceUrl:source.toString()})
  }
  return result
}
