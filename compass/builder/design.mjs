// Shared, deterministic design direction. Domain words select a composition,
// never a remote asset or an unverified business fact.
const PROFILES = Object.freeze({
  property: { kind: 'real estate', sections: ['products', 'features', 'contact'], hero: 'split', font: 'serif', accent: 'slate' },
  booking: { kind: 'booking', sections: ['features', 'contact'], hero: 'split', font: 'sans', accent: 'sky' },
  creative: { kind: 'creative studio', sections: ['gallery', 'features', 'contact'], hero: 'split', font: 'sans', accent: 'slate' },
  food: { kind: 'bakery', sections: ['products', 'features', 'contact'], hero: 'split', font: 'serif', accent: 'coral' },
  general: { kind: 'project', sections: ['features', 'contact'], hero: 'centered', font: 'sans', accent: 'sky' },
});

export function profileFor(value = '') {
  const text = typeof value === 'object' && value ? `${value.kind || ''}` : String(value);
  const id = /\b(real[ -]?estate|realtor|propert(?:y|ies)|realty|listings?)\b/i.test(text) ? 'property'
    : /\b(bookings?|appointments?|reservations?|scheduling)\b/i.test(text) ? 'booking'
      : /\b(bakery|baker|coffee|cafe|café|restaurant|food)\b/i.test(text) ? 'food'
        : /\b(studio|architect|architecture|portfolio|photograph|designer|creative|ceramic|artist)\w*/i.test(text) ? 'creative'
          : 'general';
  return { id, ...PROFILES[id], sections: [...PROFILES[id].sections] };
}

// All primary actions must reach a section which exists in the rendered page.
// Booking requests belong to contact; a property/portfolio page leads with work.
export function primaryTarget(spec = {}) {
  const sections = Array.isArray(spec.sections) ? spec.sections : [];
  const preferred = profileFor(spec).id === 'booking'
    ? ['contact', 'signup', 'features', 'products', 'gallery', 'pricing', 'faq', 'testimonials']
    : ['products', 'gallery', 'contact', 'signup', 'features', 'pricing', 'faq', 'testimonials'];
  return preferred.find(section => sections.includes(section)) || 'hero';
}
