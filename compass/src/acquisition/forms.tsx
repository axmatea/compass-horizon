import { useState } from "react";
import { api } from "./api";
import { afterSignupLocation } from "./login-return";
import { localDateTime, occurrenceTime } from "./datetime";
import type {
  AnswerInput,
  Experiment,
  Lead,
  LeadInput,
  ProjectInput,
  Session,
  State,
} from "./types";
import {
  AsyncForm,
  BooleanField,
  Icon,
  nullableBoolean,
  nullableNumber,
  value,
} from "./ui";

export function ProjectForm({
  state,
  session,
  onSave,
}: {
  state: State;
  session: Session | null;
  onSave: (input: ProjectInput) => Promise<void>;
}) {
  return (
    <AsyncForm
      submit="Save business & rules"
      onSubmit={async (data) => {
        const minBudget = nullableNumber(data, "minBudget");
        const maxTimelineDays = nullableNumber(data, "maxTimelineDays");
        if (
          minBudget === null ||
          maxTimelineDays === null ||
          !Number.isInteger(maxTimelineDays) ||
          maxTimelineDays < 1
        )
          throw new Error(
            "Set a budget and a timeline of at least one whole day.",
          );
        await onSave({
          name: value(data, "name"),
          goal: value(data, "goal"),
          rules: { minBudget, maxTimelineDays },
        });
      }}
      hint={
        state.mode === "DEMO"
          ? "Demo only. Changes reset when you reload or restart the tour."
          : "Saved to your workspace. Updated rules re-evaluate existing leads."
      }
    >
      {session && (
        <div className="account-summary">
          <span className="avatar">
            {(session.user.name || session.user.email)
              .slice(0, 1)
              .toUpperCase()}
          </span>
          <div>
            <strong>{session.user.name || "Your account"}</strong>
            <p>{session.user.email}</p>
            <small>Invited account · identity is read-only</small>
          </div>
        </div>
      )}
      <label>
        Business name
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={state.project?.name ?? ""}
          placeholder="e.g. AI Media Global"
          autoComplete="organization"
        />
      </label>
      <label>
        Your acquisition mission
        <textarea
          name="goal"
          required
          maxLength={500}
          rows={3}
          defaultValue={state.project?.goal ?? ""}
          placeholder="Who needs your implementation, and what problem can you solve?"
        />
      </label>
      <div className="form-divider">Qualification rules</div>
      <div className="form-grid">
        <label>
          Minimum budget (USD)
          <input
            name="minBudget"
            type="number"
            min="0"
            max="1000000000"
            step="1"
            required
            defaultValue={state.project?.rules.minBudget ?? 5000}
          />
        </label>
        <label>
          Maximum timeline (days)
          <input
            name="maxTimelineDays"
            type="number"
            min="1"
            max="3650"
            step="1"
            required
            defaultValue={state.project?.rules.maxTimelineDays ?? 90}
          />
        </label>
      </div>
      <p className="form-help">
        Business fit, a clear problem and decision-making authority also matter.
        Missing answers remain unknown.
      </p>
    </AsyncForm>
  );
}

export function ExperimentForm({
  onSave,
}: {
  onSave: (input: Omit<Experiment, "id">) => Promise<void>;
}) {
  return (
    <AsyncForm
      submit="Create experiment"
      onSubmit={async (data) =>
        onSave({
          name: value(data, "name"),
          hypothesis: value(data, "hypothesis"),
          audience: value(data, "audience"),
          message: value(data, "message"),
        })
      }
      hint="This saves a test brief. It does not publish an ad, contact anyone, or spend money."
    >
      <label>
        Experiment name
        <input
          name="name"
          required
          maxLength={120}
          placeholder="A specific promise"
        />
      </label>
      <label>
        Hypothesis
        <textarea
          name="hypothesis"
          required
          rows={2}
          maxLength={1500}
          placeholder="We believe this approach will attract..."
        />
      </label>
      <label>
        Audience
        <input
          name="audience"
          required
          maxLength={500}
          placeholder="Who is this for?"
        />
      </label>
      <label>
        Message
        <textarea
          name="message"
          required
          maxLength={1500}
          rows={3}
          placeholder="The idea you want to put in front of them"
        />
      </label>
    </AsyncForm>
  );
}

function LeadFields({ lead }: { lead?: Lead }) {
  return (
    <>
      <label>
        Problem to solve
        <textarea
          name="problem"
          maxLength={2000}
          rows={2}
          defaultValue={lead?.fields.problem ?? ""}
          placeholder="Leave blank if not known"
        />
      </label>
      <div className="form-grid">
        <label>
          Budget (USD)
          <input
            name="budget"
            type="number"
            min="0"
            step="1"
            placeholder="Unknown"
            defaultValue={lead?.fields.budget ?? ""}
          />
        </label>
        <label>
          Timeline (days)
          <input
            name="timelineDays"
            type="number"
            min="0"
            step="1"
            placeholder="Unknown"
            defaultValue={lead?.fields.timelineDays ?? ""}
          />
        </label>
      </div>
      <BooleanField
        name="decisionMaker"
        label="Are they the decision maker?"
        defaultValue={lead?.fields.decisionMaker}
      />
      <BooleanField
        name="businessFit"
        label="Do they fit your business profile?"
        defaultValue={lead?.fields.businessFit}
      />
    </>
  );
}
function getFields(data: FormData) {
  return {
    problem: value(data, "problem") || null,
    budget: nullableNumber(data, "budget"),
    timelineDays: nullableNumber(data, "timelineDays"),
    decisionMaker: nullableBoolean(data, "decisionMaker"),
    businessFit: nullableBoolean(data, "businessFit"),
  };
}
export function LeadForm({
  state,
  onSave,
}: {
  state: State;
  onSave: (input: LeadInput) => Promise<void>;
}) {
  return (
    <AsyncForm
      submit="Add lead"
      onSubmit={async (data) =>
        onSave({
          name: value(data, "name"),
          experimentId: value(data, "experimentId") || null,
          ...getFields(data),
        })
      }
      hint="No message will be sent. Leave missing information blank, rather than guessing."
    >
      <label>
        Full name
        <input
          name="name"
          required
          maxLength={120}
          autoComplete="off"
          placeholder="Lead name"
        />
      </label>
      <label>
        Attribution
        <select name="experimentId">
          <option value="">Unknown / unattributed</option>
          {state.experiments.map((experiment) => (
            <option key={experiment.id} value={experiment.id}>
              {experiment.name}
            </option>
          ))}
        </select>
      </label>
      <LeadFields />
    </AsyncForm>
  );
}
export function AnswerForm({
  lead,
  onSave,
}: {
  lead: Lead;
  onSave: (answer: AnswerInput) => Promise<void>;
}) {
  // Keep the event ID stable across a network-error retry so the server can deduplicate it.
  const [externalId] = useState(() => crypto.randomUUID());
  const [originalTime] = useState(() =>
    new Date(
      Math.max(Date.now(), Date.parse(lead.updatedAt) + 1),
    ).toISOString(),
  );
  return (
    <AsyncForm
      submit="Save new context"
      onSubmit={async (data) => {
        const fields = getFields(data);
        const changed = Object.fromEntries(
          Object.entries(fields).filter(
            ([key, entry]) => entry !== lead.fields[key as keyof typeof fields],
          ),
        );
        if (!Object.keys(changed).length)
          throw new Error("Change at least one answer before saving.");
        await onSave({
          source: "manual",
          externalId,
          leadId: lead.id,
          occurredAt: occurrenceTime(value(data, "occurredAt"), originalTime),
          fields: changed,
        });
      }}
      hint="The server uses when the answer occurred, not when it arrived. Existing newer answers are preserved."
    >
      <LeadFields lead={lead} />
      <label>
        When did this answer occur?
        <input
          name="occurredAt"
          type="datetime-local"
          step="1"
          required
          defaultValue={localDateTime(originalTime)}
        />
      </label>
    </AsyncForm>
  );
}

export function EarlyAccessForm() {
  const [saved, setSaved] = useState(false);
  if (saved)
    return (
      <div className="success-panel" role="status">
        <Icon name="check" />
        <h3>Request received.</h3>
        <p>
          Your early-access request was saved. This is not a purchase or a
          subscription. We will follow up about availability and terms.
        </p>
      </div>
    );
  return (
    <>
      <div className="price-line">
        <strong>
          $299<span>/ month</span>
        </strong>
        <span className="badge neutral">Planned early-access price</span>
      </div>
      <p className="muted">
        A focused acquisition workspace for your business. Request an
        invitation, not another subscription today.
      </p>
      <AsyncForm
        submit="Request early access"
        onSubmit={async (data) => {
          const result = await api<{ ok: boolean }>("/api/early-access", {
            email: value(data, "email"),
            name: value(data, "name"),
            business: value(data, "business"),
            consent: true,
          });
          if (result.ok !== true)
            throw new Error(
              "A durable save was not confirmed. Please try again later.",
            );
          setSaved(true);
        }}
        hint="No payment is collected. Access and pricing are subject to written terms. This form is real, even in the demo."
      >
        <label>
          Your name
          <input name="name" maxLength={120} autoComplete="name" />
        </label>
        <label>
          Work email
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="you@yourbusiness.com"
          />
        </label>
        <label>
          Business
          <input
            name="business"
            maxLength={300}
            autoComplete="organization"
            placeholder="Business name or website"
          />
        </label>
        <label className="checkbox-label">
          <input name="consent" type="checkbox" required />I agree to be
          contacted about this early-access request.
        </label>
      </AsyncForm>
    </>
  );
}

export function AuthForm({
  onAuthenticated,
  onEarlyAccess,
}: {
  onAuthenticated: () => Promise<void>;
  onEarlyAccess: () => void;
}) {
  const [kind, setKind] = useState<"sign-in" | "invite">(() =>
    new URLSearchParams(window.location.search).has("token")
      ? "invite"
      : "sign-in",
  );
  const [accepted, setAccepted] = useState(false);
  return (
    <div className="auth-card">
      <p className="eyebrow">YOUR WORK. YOUR WORKSPACE.</p>
      <h1>
        {kind === "invite"
          ? "Make yourself at home."
          : "A little more direction."}
      </h1>
      <p className="muted">
        {kind === "invite"
          ? "Accept your invitation to create your private workspace."
          : "Sign in to your invited COMPASS workspace."}
      </p>
      <div className="segmented" aria-label="Account access">
        <button
          type="button"
          aria-pressed={kind === "sign-in"}
          onClick={() => setKind("sign-in")}
        >
          Sign in
        </button>
        <button
          type="button"
          aria-pressed={kind === "invite"}
          onClick={() => setKind("invite")}
        >
          Accept invite
        </button>
      </div>
      {accepted && (
        <p className="notice success" role="status">
          Invitation accepted. Sign in with your new account.
        </p>
      )}
      <AsyncForm
        key={kind}
        submit={kind === "invite" ? "Accept invitation" : "Open workspace"}
        onSubmit={async (data) => {
          const email = value(data, "email");
          const password = String(data.get("password") ?? "");
          if (kind === "invite") {
            const result = await api<{ ok: boolean }>(
              "/api/acquisition/accept-invite",
              {
                token: value(data, "token"),
                name: value(data, "name"),
                email,
                password,
              },
            );
            if (!result.ok) throw new Error("Invitation was not accepted.");
            setAccepted(true);
            setKind("sign-in");
            window.history.replaceState(null, "", afterSignupLocation());
          } else {
            await api("/api/auth/sign-in/email", { email, password });
            await onAuthenticated();
          }
        }}
        hint="Invitation-only access. No public account creation or billing."
      >
        {kind === "invite" && (
          <>
            <label>
              Invitation token
              <input
                name="token"
                required
                autoComplete="off"
                defaultValue={
                  new URLSearchParams(window.location.search).get("token") ?? ""
                }
              />
            </label>
            <p className="fine-print">
              Invites are private and expire. An expired or already-used token
              will show the server error; request a fresh invitation from your
              workspace owner.
            </p>
            <label>
              Your name
              <input name="name" required maxLength={120} autoComplete="name" />
            </label>
          </>
        )}
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={kind === "invite" ? 12 : undefined}
            maxLength={128}
            autoComplete={
              kind === "invite" ? "new-password" : "current-password"
            }
          />
        </label>
      </AsyncForm>
      <div className="auth-footer">
        <a href="/">Explore the demo</a>
        <button className="text-button" onClick={onEarlyAccess}>
          Request an invitation <Icon name="arrow" />
        </button>
      </div>
    </div>
  );
}
