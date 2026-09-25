// MOCK tool used only to validate the agent loop and interruption handling.
// Results are clearly labelled mock. The real provider is chosen by the orchestrator.
const NAMES = ['Trattoria Uno (mock)', 'Osteria Due (mock)', 'Cucina Tre (mock)'];

export function formatTime12(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
}

export function createMockRestaurantSearch({ delayMs = 1500 } = {}) {
  return {
    name: 'mock_restaurant_search',
    description: 'MOCK: find restaurants for the current intent (cuisine, location, date, time). Returns sample data.',
    mock: true,
    sideEffect: false,
    dependsOn: ['cuisine', 'location', 'date', 'time'],
    requires: ['cuisine'],
    argsFromIntent: (i) => ({ cuisine: i.cuisine, location: i.location, date: i.date, time: i.time }),
    run: (args, { signal } = {}) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve({
          mock: true,
          query: args,
          results: NAMES.map((name, idx) => ({
            name: `${args.cuisine} ${name}`,
            area: args.location || 'current area',
            availableAt: args.time,
            distanceKm: 0.6 + idx * 0.7,
          })),
        });
      }, delayMs);
      const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')); };
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
    summarize: (result, intent) => {
      const n = result.results.length;
      const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];
      const count = words[n] ?? String(n);
      const where = intent.location ? ` near ${intent.location}` : '';
      const when = intent.time ? ` for ${formatTime12(intent.time)}` : '';
      return `${count} ${intent.cuisine} spots${where}${when}. Sample results.`;
    },
  };
}
