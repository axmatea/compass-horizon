// TODO: team bios and logos. Publish names only after the founder confirms them.
// Leave `team` empty until then. The homepage renders a bio only when an entry has a name.
export const team = []

export function visibleTeam(people = team) {
  if (!Array.isArray(people)) return []
  const list = []
  for (const person of people) {
    const name = String(person?.name || '').trim().slice(0, 80)
    if (!name) continue
    const logo = typeof person.logo === 'string' && person.logo.startsWith('/') && !person.logo.startsWith('//') ? person.logo : ''
    list.push({
      name,
      role: String(person.role || '').trim().slice(0, 80),
      bio: String(person.bio || '').trim().slice(0, 400),
      logo,
    })
  }
  return list
}
