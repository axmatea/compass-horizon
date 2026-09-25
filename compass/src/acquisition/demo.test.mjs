import test from "node:test";
import assert from "node:assert/strict";
import {
  addDemoLead,
  createDemo,
  delayedAnswer,
  receiveDemoAnswer,
  updateDemoProject,
} from "./demo.ts";
import { localDateTime, occurrenceTime } from "./datetime.ts";

test("demo is explicit and starts with unknown budget, not zero", () => {
  const state = createDemo();
  assert.equal(state.mode, "DEMO");
  assert.equal(state.project.name, "AI Media Global");
  assert.equal(state.experiments.length, 2);
  assert.equal(
    state.leads.find((lead) => lead.id === "mira").fields.budget,
    null,
  );
  assert.equal(
    state.leads.find((lead) => lead.id === "mira").qualification.status,
    "NEEDS_CONTEXT",
  );
  assert.equal(state.metrics.qualified, 1);
  assert.equal(state.metrics.sampleStatus, "insufficient_evidence");
});
test("delayed reply qualifies Mira and replay is an actual no-op", () => {
  const { state, changed } = receiveDemoAnswer(createDemo(), delayedAnswer);
  assert.deepEqual(changed, ["budget"]);
  assert.equal(
    state.leads.find((lead) => lead.id === "mira").qualification.status,
    "QUALIFIED",
  );
  assert.equal(state.metrics.qualified, 2);
  const replay = receiveDemoAnswer(state, delayedAnswer);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.state, state);
  assert.equal(replay.state.events.length, 2);
  assert.equal(replay.state.leads.length, 4);
});
test("memory rule change requalifies existing people and retains evidence", () => {
  const state = receiveDemoAnswer(createDemo(), delayedAnswer).state;
  const changed = updateDemoProject(state, {
    ...state.project,
    rules: { ...state.project.rules, minBudget: 8000 },
  });
  assert.equal(
    changed.leads.find((lead) => lead.id === "mira").qualification.status,
    "NOT_ICP",
  );
  assert.equal(
    changed.leads.find((lead) => lead.id === "jonah").qualification.status,
    "QUALIFIED",
  );
  assert.equal(changed.project.rulesVersion, 2);
  assert.equal(changed.decisions.length, 2);
  assert.equal(changed.events, state.events);
  assert.ok(
    changed.decisions.at(-1).createdAt > changed.events.at(-1).receivedAt,
  );
});
test("older evidence cannot overwrite newer answers", () => {
  const state = receiveDemoAnswer(createDemo(), delayedAnswer).state;
  const result = receiveDemoAnswer(state, {
    ...delayedAnswer,
    externalId: "older-budget",
    occurredAt: "2026-09-26T09:00:00.000Z",
    fields: { budget: 1000 },
  });
  assert.equal(
    result.state.leads.find((lead) => lead.id === "mira").fields.budget,
    6500,
  );
  assert.deepEqual(result.changed, []);
  assert.equal(result.state.events.length, 3);
});
test("reusing an event ID for different evidence fails visibly", () => {
  const state = receiveDemoAnswer(createDemo(), delayedAnswer).state;
  assert.throws(
    () =>
      receiveDemoAnswer(state, { ...delayedAnswer, fields: { budget: 9000 } }),
    /different evidence/,
  );
});
test("manual lead keeps unknown attribution and missing answers", () => {
  const state = addDemoLead(createDemo(), {
    name: "Test buyer",
    experimentId: null,
    problem: null,
    budget: null,
    decisionMaker: null,
    businessFit: null,
    timelineDays: null,
  });
  assert.equal(state.leads.at(-1).qualification.status, "NEEDS_CONTEXT");
  assert.equal(state.metrics.unknownAttribution, 2);
  assert.equal(state.leads.at(-1).fields.budget, null);
});
test("untouched local input preserves seconds and original milliseconds", () => {
  const original = "2026-09-25T18:42:38.947Z";
  assert.match(localDateTime(original), /:\d{2}:38$/);
  assert.equal(occurrenceTime(localDateTime(original), original), original);
  assert.equal(
    occurrenceTime(localDateTime("2026-09-25T18:43:12.000Z"), original),
    "2026-09-25T18:43:12.000Z",
  );
});
