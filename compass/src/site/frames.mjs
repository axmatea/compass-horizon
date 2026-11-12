// Escaped prompt and brief markup for the homepage.
import { modeById } from './modes.mjs'

export function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function briefMock(modeId) {
  return modeById(modeId).brief.map(([label, value]) => `<li><span>${esc(label)}</span><b>${esc(value)}</b></li>`).join('')
}

export function ideasMock(modeId) {
  return modeById(modeId).ideas.map(idea => `<button type="button" class="idea" data-idea="${esc(idea)}">${esc(idea)}</button>`).join('')
}
