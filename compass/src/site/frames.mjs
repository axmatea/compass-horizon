// Example layouts for the homepage device frames. Pure strings, no DOM.
// index.html carries this output for the default mode and for the four product
// cards; test/home.test.mjs fails when the two drift apart.
import { modeById } from './modes.mjs'

export function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const pill = (text, tone) => text ? `<i class="p p-${esc(tone || 'mute')}">${esc(text)}</i>` : ''

function appWeb(ui) {
  const nav = ui.nav.map((item, index) => `<span${index === 0 ? ' class="on"' : ''}>${esc(item)}</span>`).join('')
  const rows = ui.rows.map(([when, what, state, tone]) => `<li><small>${esc(when)}</small><b>${esc(what)}</b>${pill(state, tone)}</li>`).join('')
  return `<div class="ui ui-app"><div class="ui-side"><strong>${esc(ui.brand)}</strong>${nav}</div><div class="ui-main"><div class="ui-head"><b>${esc(ui.title)}</b><em>${esc(ui.action)}</em></div><ul class="ui-rows">${rows}</ul></div></div>`
}

function siteWeb(ui) {
  const nav = (ui.nav || []).map(item => `<span>${esc(item)}</span>`).join('')
  const tiles = ui.tiles.map(item => `<li><i></i><b>${esc(item)}</b></li>`).join('')
  return `<div class="ui ui-site"><div class="ui-nav"><strong>${esc(ui.brand)}</strong>${nav}</div><div class="ui-hero"><small>${esc(ui.eyebrow)}</small><b>${esc(ui.headline)}</b><em>${esc(ui.cta)}</em></div><ul class="ui-tiles">${tiles}</ul></div>`
}

function listPhone(ui) {
  const rows = ui.rows.map(([what, note, state, tone]) => `<li><b>${esc(what)}</b><small>${esc(note)}</small>${pill(state, tone)}</li>`).join('')
  const cta = ui.cta ? `<div class="ui-cta"><em>${esc(ui.cta)}</em>${ui.alt ? `<span>${esc(ui.alt)}</span>` : ''}</div>` : ''
  const tabs = ui.tabs ? `<div class="ui-tabs">${ui.tabs.map((item, index) => `<span${index === 0 ? ' class="on"' : ''}>${esc(item)}</span>`).join('')}</div>` : ''
  return `<div class="ui ui-list"><div class="ui-head"><b>${esc(ui.title)}</b></div><ul class="ui-rows">${rows}</ul>${cta}${tabs}</div>`
}

function sitePhone(ui) {
  const tiles = ui.tiles.map(item => `<li><i></i><b>${esc(item)}</b></li>`).join('')
  return `<div class="ui ui-site"><div class="ui-nav"><strong>${esc(ui.brand)}</strong></div><div class="ui-hero"><small>${esc(ui.eyebrow)}</small><b>${esc(ui.headline)}</b><em>${esc(ui.cta)}</em></div><ul class="ui-tiles">${tiles}</ul></div>`
}

export function webMock(modeId) {
  const ui = modeById(modeId).sample.web
  return ui.kind === 'site' ? siteWeb(ui) : appWeb(ui)
}

export function phoneMock(modeId) {
  const ui = modeById(modeId).sample.phone
  return ui.kind === 'site' ? sitePhone(ui) : listPhone(ui)
}

export function briefMock(modeId) {
  return modeById(modeId).brief.map(([label, value]) => `<li><span>${esc(label)}</span><b>${esc(value)}</b></li>`).join('')
}

export function ideasMock(modeId) {
  return modeById(modeId).ideas.map(idea => `<button type="button" class="idea" data-idea="${esc(idea)}">${esc(idea)}</button>`).join('')
}
