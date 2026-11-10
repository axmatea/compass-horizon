// Prepared COMPASS demos. The public /demo idea (describe it, get a plan, see a
// preview) comes from c5cb564 SiteDemo. This module is the no-key path: a full
// run with clarifying questions, a plan, and a web + phone preview. No prices,
// customers, or live-account claims.

export const MAX_INTENT = 500;

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function answer(answers, id, fallback) {
  const found = (answers || []).find(item => item && item.id === id);
  return clean(found?.value, 80) || fallback;
}

function line(title, meta) {
  return { title, meta };
}

const barber = {
  id: 'barber',
  intent: 'a booking app for my barbershop with SMS reminders',
  productName: 'Barbershop booking',
  questions: [
    { id: 'q1', prompt: 'What do customers book?', options: ['Haircut', 'Beard', 'Cut and beard'] },
    { id: 'q2', prompt: 'When should the reminder go out?', options: ['24 hours before', '2 hours before', 'The morning of'] },
    { id: 'q3', prompt: 'Who gets the text?', options: ['The customer', 'The barber', 'Both'] },
  ],
  screens: [
    { name: 'Book', purpose: 'Pick a service, a chair, and an open time.' },
    { name: 'Today', purpose: 'The day sheet, with who is due a reminder.' },
    { name: 'Clients', purpose: 'People who book, and how they like to be reached.' },
    { name: 'Services', purpose: 'What the shop offers and how long it takes.' },
  ],
  dataModel: [
    { name: 'Client', fields: ['Name', 'Phone', 'Reminder preference'] },
    { name: 'Appointment', fields: ['Service', 'Chair', 'Start', 'Status'] },
    { name: 'Service', fields: ['Name', 'Minutes'] },
  ],
  integrations: [
    { name: 'SMS reminders', purpose: 'A text at the time you chose. Not sent from this preview.' },
    { name: 'Chair calendar', purpose: 'Holds the slot on the shop day sheet.' },
  ],
  preview(answers) {
    const service = answer(answers, 'q1', 'Haircut');
    const when = answer(answers, 'q2', '24 hours before');
    const who = answer(answers, 'q3', 'The customer');
    return {
      accent: '#1c3a34',
      headline: 'Book a chair',
      subhead: `${service}. Reminder ${when.toLowerCase()}, to ${who.toLowerCase()}.`,
      tabs: [
        { id: 'book', label: 'Book', title: 'Book a chair', kicker: service, lines: [line('Today · 10:30', 'First chair · open'), line('Today · 11:15', 'Second chair · open'), line('Today · 2:00', 'First chair · open')] },
        { id: 'today', label: 'Today', title: 'Day sheet', kicker: 'Reminders staged', lines: [line('10:30 · First chair', `${service} · text ${when.toLowerCase()}`), line('11:15 · Second chair', 'Checked in'), line('SMS', `${who} · not sent in this preview`)] },
        { id: 'clients', label: 'Clients', title: 'Clients', kicker: 'Reach', lines: [line('Regular', who), line('Last visit', service), line('Next reminder', when)] },
        { id: 'services', label: 'Services', title: 'Services', kicker: 'Shop menu', lines: [line(service, 'On the book'), line('Beard', 'Shorter slot'), line('Cut and beard', 'Longest slot')] },
      ],
    };
  },
};

const jobs = {
  id: 'jobs',
  intent: 'a job tracker for my plumbing crew with on-the-way texts',
  productName: 'Crew job tracker',
  questions: [
    { id: 'q1', prompt: 'What is a job?', options: ['A service call', 'An install', 'A repair'] },
    { id: 'q2', prompt: 'When do you text the customer?', options: ['On the way', 'When the job is done', 'Both'] },
    { id: 'q3', prompt: 'What should the crew capture?', options: ['Photos', 'Notes', 'Photos and notes'] },
  ],
  screens: [
    { name: 'Today', purpose: 'Jobs on the board for this crew.' },
    { name: 'Job', purpose: 'Address, status, and what was captured.' },
    { name: 'On the way', purpose: 'The text the customer would get.' },
    { name: 'Crew', purpose: 'Who is out and which job they hold.' },
  ],
  dataModel: [
    { name: 'Job', fields: ['Kind', 'Address', 'Status', 'Window'] },
    { name: 'Visit', fields: ['Crew', 'Arrived', 'Capture'] },
    { name: 'Message', fields: ['When', 'To', 'Status'] },
  ],
  integrations: [
    { name: 'On-the-way text', purpose: 'A customer text at the moment you chose. Not sent from this preview.' },
    { name: 'Job photos', purpose: 'Held on the visit. Nothing is uploaded from this preview.' },
  ],
  preview(answers) {
    const kind = answer(answers, 'q1', 'A service call');
    const when = answer(answers, 'q2', 'On the way');
    const capture = answer(answers, 'q3', 'Photos');
    return {
      accent: '#16324f',
      headline: 'Today’s board',
      subhead: `${kind}. Text the customer ${when.toLowerCase()}. Capture ${capture.toLowerCase()}.`,
      tabs: [
        { id: 'today', label: 'Today', title: 'Today’s board', kicker: kind, lines: [line('8:30 · North route', 'Scheduled'), line('11:00 · Second call', 'Open'), line('1:40 · Follow-up', 'Open')] },
        { id: 'job', label: 'Job', title: 'Job', kicker: kind, lines: [line('Status', 'Scheduled'), line('Capture', capture), line('Window', 'Morning')] },
        { id: 'way', label: 'On the way', title: 'Customer text', kicker: 'Not sent', lines: [line('When', when), line('Message', 'We are on the way.'), line('Status', 'Preview only')] },
        { id: 'crew', label: 'Crew', title: 'Crew', kicker: 'Out now', lines: [line('Van 1', 'North route'), line('Van 2', 'Open'), line('Capture', capture)] },
      ],
    };
  },
};

const classes = {
  id: 'classes',
  intent: 'a class schedule for my yoga studio with a full-class waitlist',
  productName: 'Studio schedule',
  questions: [
    { id: 'q1', prompt: 'How do people join?', options: ['Drop-in', 'Membership', 'Either'] },
    { id: 'q2', prompt: 'When a class is full?', options: ['Waitlist', 'Close booking', 'Ask the teacher'] },
    { id: 'q3', prompt: 'What is on the phone home screen?', options: ['Today’s classes', 'My bookings', 'The week'] },
  ],
  screens: [
    { name: 'Schedule', purpose: 'Classes on the week, with space left.' },
    { name: 'Class', purpose: 'Teacher, room, and what happens when it is full.' },
    { name: 'Bookings', purpose: 'What this person is already on.' },
    { name: 'Waitlist', purpose: 'Who is next if a spot opens.' },
  ],
  dataModel: [
    { name: 'Class', fields: ['Name', 'Start', 'Capacity', 'Full rule'] },
    { name: 'Booking', fields: ['Person', 'Class', 'How they joined'] },
    { name: 'Waitlist entry', fields: ['Person', 'Class', 'Place'] },
  ],
  integrations: [
    { name: 'Full-class rule', purpose: 'The choice you made when a class has no space left.' },
    { name: 'Schedule', purpose: 'The week on the wall and on the phone. Nothing is published from this preview.' },
  ],
  preview(answers) {
    const join = answer(answers, 'q1', 'Either');
    const full = answer(answers, 'q2', 'Waitlist');
    const home = answer(answers, 'q3', 'Today’s classes');
    return {
      accent: '#6b3f2a',
      headline: home,
      subhead: `Join by ${join.toLowerCase()}. When a class is full: ${full.toLowerCase()}.`,
      tabs: [
        { id: 'schedule', label: 'Schedule', title: home, kicker: join, lines: [line('7:00 · Morning', '4 spots'), line('12:10 · Midday', 'Full'), line('18:00 · Evening', '2 spots')] },
        { id: 'class', label: 'Class', title: 'Midday', kicker: 'Full', lines: [line('Join', join), line('When full', full), line('Room', 'Front room')] },
        { id: 'bookings', label: 'Bookings', title: 'Bookings', kicker: home, lines: [line('Morning', 'On the list'), line('Evening', 'Open'), line('How', join)] },
        { id: 'wait', label: 'Waitlist', title: 'Waitlist', kicker: full, lines: [line('Midday', full), line('Next', '1 person'), line('Status', 'Preview only')] },
      ],
    };
  },
};

export const EXAMPLES = [barber, jobs, classes];

const genericQuestions = [
  { id: 'q1', prompt: 'Who is it for?', options: ['Customers', 'A team', 'Both'] },
  { id: 'q2', prompt: 'What should the first screen be?', options: ['A schedule', 'A list of work', 'A home screen'] },
  { id: 'q3', prompt: 'What should it connect to later?', options: ['Email', 'Text messages', 'Nothing yet'] },
];

function packFor(intent) {
  const text = intent.toLowerCase();
  if (/\b(barber|haircut|salon|beard)\b|\bbooking app\b|\bsms reminder/.test(text)) return barber;
  if (/\b(plumb|crew|dispatch|job tracker)\b|\bon the way\b/.test(text)) return jobs;
  if (/\b(yoga|studio|class schedule|waitlist)\b/.test(text)) return classes;
  return null;
}

function genericPreview(intent, answers) {
  const who = answer(answers, 'q1', 'Customers');
  const first = answer(answers, 'q2', 'A home screen');
  const connect = answer(answers, 'q3', 'Nothing yet');
  return {
    productName: 'Your product',
    summary: `A first plan for “${intent}”. For ${who.toLowerCase()}, starting with ${first.toLowerCase()}.`,
    screens: [
      { name: 'Home', purpose: `${first} for ${who.toLowerCase()}.` },
      { name: 'Work', purpose: 'The items this product has to keep track of.' },
      { name: 'People', purpose: `The ${who.toLowerCase()} it is for.` },
      { name: 'Connect', purpose: `Later: ${connect.toLowerCase()}. Not connected in this preview.` },
    ],
    dataModel: [
      { name: 'Person', fields: ['Name', 'Role', 'Reach'] },
      { name: 'Item', fields: ['Title', 'Status', 'Owner'] },
      { name: 'Note', fields: ['Item', 'Text'] },
    ],
    integrations: [
      { name: connect, purpose: connect === 'Nothing yet' ? 'No outside service in this preview.' : `${connect} can be added later. Not connected in this preview.` },
    ],
    preview: {
      accent: '#243044',
      headline: first,
      subhead: intent,
      tabs: [
        { id: 'home', label: 'Home', title: first, kicker: who, lines: [line('For', who), line('First screen', first), line('Connect', connect)] },
        { id: 'work', label: 'Work', title: 'Work', kicker: 'Open', lines: [line('First item', 'Ready to shape'), line('Status', 'Preview'), line('Owner', who)] },
        { id: 'people', label: 'People', title: 'People', kicker: who, lines: [line('Audience', who), line('Reach', connect), line('Saved', 'Only in this preview')] },
        { id: 'connect', label: 'Connect', title: 'Connect', kicker: 'Not live', lines: [line('Service', connect), line('Status', 'Not connected'), line('Sends', 'Nothing')] },
      ],
    },
  };
}

function realize(pack, intent, answers) {
  const view = pack.preview(answers);
  return {
    productName: pack.productName,
    summary: `A first plan for “${intent}”.`,
    screens: pack.screens,
    dataModel: pack.dataModel,
    integrations: pack.integrations,
    preview: view,
  };
}

export function findExample(exampleId) {
  return EXAMPLES.find(item => item.id === exampleId) || null;
}

function safeAnswers(answers) {
  return (answers || []).map(item => ({
    id: clean(item?.id, 12),
    prompt: clean(item?.prompt, 180),
    value: clean(item?.value, 80),
  })).filter(item => item.id && item.value);
}

export function clarifyLocal(intent, exampleId) {
  const example = findExample(exampleId);
  if (example) return { ok: true, example: true, exampleId: example.id, intent: example.intent, questions: example.questions };
  const raw = String(intent ?? '');
  if (raw.trim().length > MAX_INTENT) return { ok: false, error: 'too_long', limit: MAX_INTENT };
  const text = clean(raw, MAX_INTENT);
  if (!text) return { ok: false, error: 'empty', limit: MAX_INTENT };
  const pack = packFor(text);
  return { ok: true, example: false, exampleId: null, intent: text, questions: pack ? pack.questions : genericQuestions };
}

export function planLocal(intent, exampleId, answers) {
  const example = findExample(exampleId);
  const picked = safeAnswers(answers);
  if (example) {
    return { ok: true, example: true, exampleId: example.id, intent: example.intent, questions: example.questions, answers: picked, ...realize(example, example.intent, picked) };
  }
  const clarified = clarifyLocal(intent);
  if (!clarified.ok) return clarified;
  const pack = packFor(clarified.intent);
  const built = pack ? realize(pack, clarified.intent, picked) : genericPreview(clarified.intent, picked);
  return { ok: true, example: false, exampleId: null, intent: clarified.intent, questions: clarified.questions, answers: picked, ...built };
}

export function rateLimitFallback() {
  const plan = planLocal('', 'barber', barber.questions.map(q => ({ id: q.id, prompt: q.prompt, value: q.options[0] })));
  return { ...plan, example: true, exampleId: 'barber' };
}
