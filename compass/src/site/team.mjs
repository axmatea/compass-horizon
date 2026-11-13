// Homepage team slot stays empty; studio people live in studio-content.mjs.
// visibleTeam sanitises any roster passed in (studio page, tests).
export const team = []

function sameOriginAsset(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : ''
}

function initialsFrom(name, provided) {
  const raw = String(provided || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()
  if (raw) return raw
  return String(name).split(/\s+/).filter(Boolean).map(part => part[0]).join('').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
}

export function visibleTeam(people = team) {
  if (!Array.isArray(people)) return []
  const list = []
  for (const person of people) {
    const name = String(person?.name || '').trim().slice(0, 80)
    if (!name) continue
    const logo = sameOriginAsset(person.logo)
    const photo = sameOriginAsset(person.photo)
    list.push({
      name,
      role: String(person.role || '').trim().slice(0, 80),
      bio: String(person.bio || '').trim().slice(0, 400),
      logo,
      photo,
      initials: initialsFrom(name, person.initials),
    })
  }
  return list
}
