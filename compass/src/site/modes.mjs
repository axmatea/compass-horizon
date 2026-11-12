// The public product creates website previews. Keep only its prompt examples.
export const MODES = [
  {
    id: 'site',
    label: 'Website',
    title: 'Websites',
    blurb: 'For the first thing people see: a launch page, a storefront, a portfolio.',
    placeholder: 'A website for my bakery with a menu and an order button…',
    ideas: ['A website for my bakery', 'A dark, cinematic page for an AI company', 'A wedding photographer portfolio'],
    brief: [['What', 'Bakery website'], ['For', 'The neighbourhood'], ['Tone', 'Warm'], ['Sections', 'Hero · Menu · Visit']],
    sample: { name: 'Website' },
  },
]

export const DEFAULT_MODE = 'site'

export function modeById(id) {
  return MODES.find(mode => mode.id === id) || MODES[0]
}

// Lines offered once a page exists. Each is a change the builder understands.
export const REVISIONS = [
  ['Darker, more cinematic', 'Make it darker and more cinematic.'],
  ['Add pricing', 'Add a pricing section.'],
  ['Bolder hero', 'Make the hero more ambitious.'],
]
