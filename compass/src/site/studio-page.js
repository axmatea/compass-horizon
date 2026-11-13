import { visibleTeam } from './team.mjs'
import { studioTeam } from './studio-content.mjs'
import { visibleTestimonials } from './testimonials.mjs'

const people = document.querySelector('#studio-people')
const members = visibleTeam(studioTeam)
if (people && members.length) {
  people.replaceChildren(...members.map(person => {
    const article = document.createElement('article')
    article.className = 'person'
    const avatar = document.createElement('div')
    avatar.className = 'person-avatar'
    avatar.setAttribute('aria-hidden', 'true')
    if (person.photo) {
      const img = document.createElement('img')
      img.src = person.photo
      img.alt = ''
      img.width = 72
      img.height = 72
      img.loading = 'lazy'
      img.decoding = 'async'
      avatar.append(img)
    } else {
      avatar.textContent = person.initials || '?'
    }
    const name = document.createElement('h3')
    name.textContent = person.name
    article.append(avatar, name)
    if (person.role) {
      const role = document.createElement('p')
      role.className = 'person-role'
      role.textContent = person.role
      article.append(role)
    }
    if (person.bio) {
      const bio = document.createElement('p')
      bio.textContent = person.bio
      article.append(bio)
    }
    return article
  }))
  people.hidden = false
}

const section = document.querySelector('#studio-voices')
const quotes = document.querySelector('#studio-quotes')
const statements = visibleTestimonials()
if (section && quotes && statements.length) {
  quotes.replaceChildren(...statements.map(statement => {
    const figure = document.createElement('figure')
    figure.className = 'voice-quote'
    const quote = document.createElement('blockquote')
    quote.textContent = statement.quote
    const attribution = document.createElement('figcaption')
    const name = document.createElement('strong')
    name.textContent = statement.name
    attribution.append(name)
    if (statement.role) attribution.append(document.createTextNode(' · ' + statement.role))
    const source = document.createElement('a')
    source.href = statement.sourceUrl
    source.rel = 'noopener noreferrer'
    source.textContent = 'Read the source ↗'
    figure.append(quote, attribution, source)
    return figure
  }))
  section.hidden = false
}
