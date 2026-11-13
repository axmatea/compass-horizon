// Confirmed studio facts only. Add people, bios, photos and quotes here.
// Quotes require approved:true, attribution and an https source URL before they render.
// Photos must be same-origin paths under /assets/; empty photo uses a monogram.

export const studioCompany = Object.freeze({
  name: 'AX Media Global',
  url: 'https://aimedia.global',
  arr: '$240K ARR',
  buildsFor: Object.freeze(['CPAs', 'developers', 'fintech']),
  shipped: Object.freeze({ name: 'Jarrar CPA Pro', url: 'https://jarrarcpa.pro' }),
  product: Object.freeze({
    name: 'COMPASS',
    line: 'the new B2C product: website previews today, with web apps, mobile apps and full products as the vision',
  }),
})

export const studioTeam = Object.freeze([
  Object.freeze({
    name: 'Nayl Ahmadulin',
    role: 'Founder',
    initials: 'NA',
    bio: 'Founder of AX Media Global. COMPASS is the new B2C product: intent into real software.',
    photo: '',
  }),
])

// Leave empty until founder-approved wording, name, role and https source exist.
export const studioQuotes = Object.freeze([])
