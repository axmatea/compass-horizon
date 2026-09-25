import { describe, expect, it } from 'vitest';
import { extractRules } from '@/engine/extract-rules';
import { OUTCOMES, REPLIES } from '@/engine/scenario/ai-media-q4';

describe('rules extractor on scenario replies', () => {
  for (const r of REPLIES) {
    it(`${r.externalId} reads as intended`, () => {
      const x = extractRules(r.text);
      for (const [k, v] of Object.entries(r.expect)) {
        const f = x[k as 'budgetUsd' | 'timelineDays' | 'decisionMaker'];
        expect(f ? f.value : null, `${k} in "${r.text}"`).toBe(v);
      }
      for (const f of Object.values(x)) if (f) expect(r.text.includes(f.quote)).toBe(true);
    });
  }
  it('reads the late CRM notes', () => {
    const b03 = extractRules(OUTCOMES.find((o) => o.externalId === 'crm-call-B03')!.note);
    expect(b03.timelineDays?.value).toBe(45);
    expect(b03.budgetUsd).toBeNull();
    const b05 = extractRules(OUTCOMES.find((o) => o.externalId === 'crm-call-B05')!.note);
    expect(b05.decisionMaker?.value).toBe(true);
  });
});
