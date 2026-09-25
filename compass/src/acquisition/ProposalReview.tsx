import { useState } from "react";
import type { AnswerInput, AnswerOutcome, Fields, Run, State } from "./types";
import { AsyncForm, value } from "./ui";
import { localDateTime, occurrenceTime } from "./datetime";

const labels: Record<keyof Fields, string> = {
  problem: "Problem",
  decisionMaker: "Decision maker",
  budget: "Budget (USD)",
  timelineDays: "Timeline (days)",
  businessFit: "Business fit",
};

function proposedFields(result: unknown): Partial<Fields> | null {
  if (
    !result ||
    typeof result !== "object" ||
    !("fields" in result) ||
    !result.fields ||
    typeof result.fields !== "object"
  )
    return null;
  const fields: Partial<Fields> = {};
  for (const [key, entry] of Object.entries(result.fields)) {
    if (key === "problem" && (entry === null || typeof entry === "string"))
      fields.problem = entry;
    if (
      (key === "budget" || key === "timelineDays") &&
      (entry === null ||
        (typeof entry === "number" && Number.isFinite(entry) && entry >= 0))
    )
      fields[key] = entry;
    if (
      (key === "decisionMaker" || key === "businessFit") &&
      (entry === null || typeof entry === "boolean")
    )
      fields[key] = entry;
  }
  return Object.keys(fields).length ? fields : null;
}

export function ProposalReview({
  run,
  state,
  onAccept,
}: {
  run: Run;
  state: State;
  onAccept: (input: AnswerInput) => Promise<AnswerOutcome>;
}) {
  const fields = proposedFields(run.result);
  const externalId = `review-${run.id}`;
  const [accepted, setAccepted] = useState(
    state.events.some(
      (event) =>
        event.source === "manual.review" && event.externalId === externalId,
    ),
  );
  const [outcome, setOutcome] = useState(
    "Review event recorded. Inspect current lead context for the server-derived qualification.",
  );
  const [leadId, setLeadId] = useState(run.leadId ?? "");
  const [originalTime] = useState(() => new Date().toISOString());
  if (!fields || run.status !== "completed") return null;
  if (accepted)
    return (
      <p className="notice info" role="status">
        {outcome}
      </p>
    );
  const lead = state.leads.find((entry) => entry.id === leadId);
  return (
    <div className="review-proposal">
      <h4>Proposed fields. Not saved facts.</h4>
      <p>
        Compare each field with the source. Select only the answers you have
        verified. Nothing is accepted automatically.
      </p>
      <AsyncForm
        submit="Accept selected fields as manual review"
        onSubmit={async (data) => {
          const selected = Object.fromEntries(
            Object.entries(fields).filter(
              ([key]) => data.get(`accept-${key}`) === "on",
            ),
          );
          if (!Object.keys(selected).length)
            throw new Error("Select at least one verified field.");
          const result = await onAccept({
            source: "manual.review",
            externalId,
            leadId: value(data, "leadId"),
            occurredAt: occurrenceTime(value(data, "occurredAt"), originalTime),
            fields: selected,
          });
          setOutcome(
            result.duplicate
              ? "Duplicate review ignored. Current facts were not changed again."
              : result.changed?.length === 0
                ? "Evidence recorded, but no current facts changed. Newer or identical evidence was retained. Inspect the lead before making another update."
                : `${result.changed?.length ?? "Selected"} field(s) changed by the server. Qualification uses your rules. Unchanged fields may have newer evidence.`,
          );
          setAccepted(true);
        }}
      >
        <label>
          Lead to update
          <select
            name="leadId"
            value={leadId}
            required
            onChange={(event) => setLeadId(event.target.value)}
          >
            <option value="">Choose the matching lead</option>
            {state.leads.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        {Object.entries(fields).map(([key, entry]) => (
          <label className="checkbox-label" key={key}>
            <input
              type="checkbox"
              name={`accept-${key}`}
              disabled={!lead || entry === null}
            />
            <span>
              <strong>{labels[key as keyof Fields]}: </strong>
              {entry === null
                ? "Unknown (not applied)"
                : typeof entry === "boolean"
                  ? entry
                    ? "Yes"
                    : "No"
                  : String(entry)}
              <br />
              <small>
                Current:{" "}
                {lead
                  ? String(lead.fields[key as keyof Fields] ?? "Unknown")
                  : "Choose a lead first"}
              </small>
            </span>
          </label>
        ))}
        <label>
          When did the source answer occur?
          <input
            type="datetime-local"
            name="occurredAt"
            required
            step="1"
            defaultValue={localDateTime(originalTime)}
          />
        </label>
        <p className="fine-print">
          This creates a session-bound evidence event. Newer field-level
          evidence still takes precedence.
        </p>
      </AsyncForm>
    </div>
  );
}
