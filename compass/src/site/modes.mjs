// What the homepage picker offers. Every sample below is an illustrative layout,
// not a customer, and carries no prices, counts or people.

export const MODES = [
  {
    id: 'web',
    label: 'Web app',
    title: 'Web apps',
    blurb: 'For the product people log in to: bookings, dashboards, client portals.',
    placeholder: 'A booking app for my barbershop, warm and friendly…',
    ideas: ['A booking app for my barbershop', 'A client portal for a design studio', 'A class schedule for a yoga studio'],
    brief: [['What', 'Booking app'], ['For', 'A barbershop'], ['Tone', 'Warm'], ['Screens', 'Today · Calendar · Services']],
    sample: {
      name: 'Barbershop booking',
      web: { kind: 'app', brand: 'Barbershop', nav: ['Today', 'Calendar', 'Services', 'Clients'], title: 'Today', action: 'New booking',
        rows: [['9:00', 'Haircut', 'Confirmed', 'ok'], ['9:30', 'Beard trim', 'Confirmed', 'ok'], ['10:15', 'Cut and shave', 'Waiting', 'warn'], ['11:00', 'Kids cut', 'Open', 'mute']] },
      phone: { kind: 'list', title: 'Book a visit', rows: [['Haircut', 'Classic cut', '', ''], ['Beard trim', 'Shape and line', '', ''], ['Cut and shave', 'The full visit', '', '']], cta: 'Choose a time' },
    },
  },
  {
    id: 'mobile',
    label: 'Mobile app',
    title: 'Mobile apps',
    blurb: 'For the work that happens away from a desk: field crews, members, deliveries.',
    placeholder: 'A job tracker my crew can use on site…',
    ideas: ['A job tracker for my renovation crew', 'A habit tracker with daily reminders', 'A delivery checklist for drivers'],
    brief: [['What', 'Job tracker'], ['For', 'A renovation crew'], ['Tone', 'Direct'], ['Screens', 'Jobs · Map · Photos']],
    sample: {
      name: 'Crew job tracker',
      web: { kind: 'app', brand: 'Dispatch', nav: ['Jobs', 'Crews', 'Map', 'Photos'], title: 'Jobs', action: 'New job',
        rows: [['Mon', 'Kitchen refit', 'In progress', 'ok'], ['Tue', 'Roof repair', 'Scheduled', 'mute'], ['Wed', 'Site survey', 'Scheduled', 'mute'], ['Thu', 'Deck stain', 'Needs parts', 'warn']] },
      phone: { kind: 'list', title: 'Jobs', rows: [['Kitchen refit', 'Today', 'In progress', 'ok'], ['Roof repair', 'Tomorrow', 'Scheduled', 'mute'], ['Deck stain', 'This week', 'Needs parts', 'warn']], tabs: ['Jobs', 'Map', 'Photos'] },
    },
  },
  {
    id: 'site',
    label: 'Website',
    title: 'Websites',
    blurb: 'For the first thing people see: a launch page, a storefront, a portfolio.',
    placeholder: 'A website for my bakery with a menu and an order button…',
    ideas: ['A website for my neighbourhood bakery', 'A dark, cinematic page for an AI company', 'A portfolio for a wedding photographer'],
    brief: [['What', 'Bakery website'], ['For', 'The neighbourhood'], ['Tone', 'Warm'], ['Sections', 'Hero · Menu · Visit']],
    sample: {
      name: 'Bakery website',
      web: { kind: 'site', brand: 'Bakery', nav: ['Menu', 'Visit', 'Order'], eyebrow: 'Open every morning', headline: 'Fresh bread, baked before you wake.', cta: 'Order ahead', tiles: ['Sourdough', 'Pastries', 'Cakes'] },
      phone: { kind: 'site', brand: 'Bakery', eyebrow: 'Open every morning', headline: 'Fresh bread, baked before you wake.', cta: 'Order ahead', tiles: ['Sourdough', 'Pastries'] },
    },
  },
  {
    id: 'tool',
    label: 'Internal tool',
    title: 'Internal tools',
    blurb: 'For the work behind the business: approvals, trackers, admin screens.',
    placeholder: 'An invoice approval tool for my finance team…',
    ideas: ['An invoice approval tool for my finance team', 'An inventory tracker for a small warehouse', 'A hiring pipeline for my team'],
    brief: [['What', 'Approval tool'], ['For', 'A finance team'], ['Tone', 'Calm'], ['Screens', 'Queue · Approved · History']],
    sample: {
      name: 'Invoice approvals',
      web: { kind: 'app', brand: 'Approvals', nav: ['Queue', 'Approved', 'History', 'Rules'], title: 'Invoice queue', action: 'Add invoice',
        rows: [['Today', 'Office supplies', 'Awaiting approval', 'warn'], ['Today', 'Software licence', 'Approved', 'ok'], ['Mon', 'Courier', 'Needs info', 'bad'], ['Mon', 'Cleaning', 'Approved', 'ok']] },
      phone: { kind: 'list', title: 'To approve', rows: [['Office supplies', 'Sent today', 'Awaiting', 'warn'], ['Courier', 'Sent Monday', 'Needs info', 'bad']], cta: 'Approve', alt: 'Decline' },
    },
  },
]

export const DEFAULT_MODE = 'web'

export function modeById(id) {
  return MODES.find(mode => mode.id === id) || MODES[0]
}

// Lines offered once a page exists. Each is a change the builder understands.
export const REVISIONS = [
  ['Darker, more cinematic', 'Make it darker and more cinematic.'],
  ['Add pricing', 'Add a pricing section.'],
  ['Bolder hero', 'Make the hero more ambitious.'],
]
