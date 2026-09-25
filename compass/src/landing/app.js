const routeLegacyHash = () => {
  if (location.hash === '#present') location.replace('/present.html');
  if (location.hash === '#demo') location.replace('/demo.html?deck=0#demo');
};
routeLegacyHash();
window.addEventListener('hashchange', routeLegacyHash);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let storedMotion = null;
try { storedMotion = localStorage.getItem('compass-motion'); } catch { /* Storage can be disabled. */ }
let motionPaused = reducedMotion.matches || storedMotion === 'paused';
const motionButton = document.getElementById('motion-control');
function setMotion(paused) {
  paused = paused || reducedMotion.matches;
  motionPaused = paused;
  document.documentElement.classList.toggle('motion-paused', paused);
  motionButton.setAttribute('aria-pressed', String(paused));
  motionButton.setAttribute('aria-label', paused ? 'Enable decorative motion' : 'Pause decorative motion');
  motionButton.querySelector('.motion-label').textContent = paused ? 'Motion off' : 'Motion on';
  motionButton.querySelector('.motion-symbol').textContent = paused ? '▷' : 'Ⅱ';
  motionButton.disabled = reducedMotion.matches;
  if (reducedMotion.matches) motionButton.setAttribute('aria-label', 'Motion off: reduced motion system preference');
}
setMotion(motionPaused);
motionButton.addEventListener('click', () => {
  setMotion(!motionPaused);
  try { localStorage.setItem('compass-motion', motionPaused ? 'paused' : 'on'); } catch { /* Optional preference. */ }
});
reducedMotion.addEventListener('change', event => {
  setMotion(event.matches || motionPaused);
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(element => {
    element.classList.add('will-reveal');
    observer.observe(element);
  });
}

const moments = [
  {
    label: '01 / THE FIRST THOUGHT',
    user: '“The client wants Friday. I’m not sure I can say yes.”',
    assistant: '“Is the deadline the concern?”',
    fact: 'Client requested Friday',
    concernLabel: 'Open assumption',
    concern: 'Deadline?',
    question: 'What makes you hesitate?',
    state: 'A thought, still taking shape.',
    announcement: 'First thought. The client requested Friday. Deadline is an assumption, not a confirmed concern.'
  },
  {
    label: '02 / THE CORRECTION',
    user: '“Actually, Friday’s fine. It’s the payment.”',
    assistant: '“So timing works. What payment terms would help?”',
    fact: 'Friday works',
    concernLabel: 'Corrected assumption',
    concern: 'Deadline → Payment',
    question: 'Which payment terms?',
    state: 'The concern changes. The fact stays.',
    announcement: 'Correction. Friday works. The concern changes from deadline to payment. The next question is which payment terms would help.'
  },
  {
    label: '03 / A PRACTICAL NEXT STEP',
    user: '“Half upfront. Half on delivery.”',
    assistant: '“Then propose those terms before you commit.”',
    fact: 'Friday works',
    concernLabel: 'Payment terms',
    concern: '50% upfront · 50% on delivery',
    question: 'Review the draft before sending',
    state: 'Prepared for you. Never sent for you.',
    announcement: 'Next step. Propose 50 percent upfront and 50 percent on delivery. An editable draft is shown. Nothing has been sent.'
  }
];
const draftText = 'Friday works for me. Can we agree on 50% upfront and 50% on delivery?';
const stepButtons = [...document.querySelectorAll('[data-step]')];
function selectMoment(index, announce = true) {
  const moment = moments[index];
  const fields = {
    'moment-label': moment.label,
    'user-line': moment.user,
    'assistant-line': moment.assistant,
    'fact-line': moment.fact,
    'concern-label': moment.concernLabel,
    'concern-line': moment.concern,
    'question-line': moment.question,
    'panel-state': moment.state
  };
  for (const [id, text] of Object.entries(fields)) document.getElementById(id).textContent = text;
  stepButtons.forEach((button, i) => {
    button.classList.toggle('is-active', i === index);
    button.setAttribute('aria-pressed', String(i === index));
  });
  document.querySelector('.conversation-panel').dataset.moment = String(index);
  document.getElementById('draft-box').hidden = index !== 2;
  if (announce) document.getElementById('demo-announcement').textContent = moment.announcement;
  if (!motionPaused && !reducedMotion.matches) {
    document.getElementById('conversation-content').animate(
      [{ opacity: 0.3, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' }
    );
  }
}
stepButtons.forEach(button => button.addEventListener('click', () => selectMoment(Number(button.dataset.step))));
document.getElementById('reset-demo').addEventListener('click', () => {
  document.getElementById('reply-draft').value = draftText;
  selectMoment(0);
});
selectMoment(0, false);
