import type {
  AnswerInput,
  Experiment,
  Fields,
  Lead,
  LeadInput,
  ProjectInput,
  Qualification,
  Rules,
  State,
} from "./types";

export const DEMO_TIME = "2026-09-25T09:00:00.000Z";
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

export function qualify(
  fields: Fields,
  rules: Rules,
  rulesVersion: number,
): Qualification {
  const missing = (Object.keys(fields) as (keyof Fields)[]).filter(
    (key) => fields[key] === null || fields[key] === "",
  );
  const reasons: string[] = [];
  if (fields.businessFit === false)
    reasons.push("Outside the target business profile");
  if (fields.decisionMaker === false) reasons.push("Not the decision maker");
  if (fields.budget !== null && fields.budget < rules.minBudget)
    reasons.push(`Budget below ${money(rules.minBudget)} minimum`);
  if (
    fields.timelineDays !== null &&
    fields.timelineDays > rules.maxTimelineDays
  )
    reasons.push(`Timeline exceeds ${rules.maxTimelineDays} days`);
  const questions: Record<keyof Fields, string> = {
    problem: "What is the main business problem you want to solve?",
    decisionMaker: "Will you be making the final decision?",
    budget: "What budget have you set aside for this project?",
    timelineDays: "How many days until you would like to begin?",
    businessFit: "Does your business need AI workflow implementation?",
  };
  return {
    status: reasons.length
      ? "NOT_ICP"
      : missing.length
        ? "NEEDS_CONTEXT"
        : "QUALIFIED",
    reasons: reasons.length
      ? reasons
      : missing.length
        ? ["Waiting for context, not guessing"]
        : ["All five qualification criteria met"],
    missing,
    nextQuestion: missing.length ? questions[missing[0]] : null,
    rulesVersion,
  };
}

export function recalculate(state: State): State {
  const leads = state.project
    ? state.leads.map((lead) => ({
        ...lead,
        qualification: qualify(
          lead.fields,
          state.project!.rules,
          state.project!.rulesVersion,
        ),
      }))
    : state.leads;
  return {
    ...state,
    leads,
    metrics: {
      source: "Synthetic demo fixtures",
      totalLeads: leads.length,
      qualified: leads.filter(
        (lead) => lead.qualification.status === "QUALIFIED",
      ).length,
      unresolved: leads.filter(
        (lead) => lead.qualification.status === "NEEDS_CONTEXT",
      ).length,
      notIcp: leads.filter((lead) => lead.qualification.status === "NOT_ICP")
        .length,
      unknownAttribution: leads.filter((lead) => !lead.experimentId).length,
      sampleStatus: "insufficient_evidence",
      experiments: state.experiments.map((experiment) => ({
        experimentId: experiment.id,
        total: leads.filter((lead) => lead.experimentId === experiment.id)
          .length,
        qualified: leads.filter(
          (lead) =>
            lead.experimentId === experiment.id &&
            lead.qualification.status === "QUALIFIED",
        ).length,
      })),
    },
  };
}

export function createDemo(): State {
  const rules = { minBudget: 5000, maxTimelineDays: 90 };
  const fixtures: {
    id: string;
    name: string;
    experimentId: string | null;
    fields: Fields;
  }[] = [
    {
      id: "mira",
      name: "Mira Chen",
      experimentId: "signal",
      fields: {
        problem: "Stop losing qualified leads during manual follow-up",
        decisionMaker: true,
        budget: null,
        timelineDays: 30,
        businessFit: true,
      },
    },
    {
      id: "jonah",
      name: "Jonah Reed",
      experimentId: "signal",
      fields: {
        problem: "Automate client onboarding across five disconnected tools",
        decisionMaker: true,
        budget: 12000,
        timelineDays: 45,
        businessFit: true,
      },
    },
    {
      id: "alex",
      name: "Alex Morgan",
      experimentId: "clarity",
      fields: {
        problem: "Implement AI replies for a small support team",
        decisionMaker: true,
        budget: 1500,
        timelineDays: 30,
        businessFit: true,
      },
    },
    {
      id: "sam",
      name: "Sam Rivera",
      experimentId: null,
      fields: {
        problem: "Extract client requirements from calls into the CRM",
        decisionMaker: null,
        budget: null,
        timelineDays: 45,
        businessFit: true,
      },
    },
  ];
  return recalculate({
    mode: "DEMO",
    project: {
      id: "ai-media-global",
      name: "AI Media Global",
      goal: "Find businesses ready to put AI workflows to work.",
      rules,
      rulesVersion: 1,
    },
    experiments: [
      {
        id: "signal",
        name: "Fix the follow-up gap.",
        hypothesis:
          "A lead follow-up workflow will attract service businesses with a costly response delay.",
        audience: "Service teams losing leads to slow follow-up",
        message:
          "Your next client already replied. Put AI to work on the follow-up.",
      },
      {
        id: "clarity",
        name: "One workflow. Less busywork.",
        hypothesis:
          "A focused workflow audit will surface buyers with a specific implementation need.",
        audience: "Business owners managing disconnected tools",
        message:
          "Pick the process that slows you down. Build an AI workflow around it.",
      },
    ],
    leads: fixtures.map((lead) => ({
      ...lead,
      qualification: qualify(lead.fields, rules, 1),
      updatedAt: DEMO_TIME,
    })),
    events: [
      {
        id: "event-initial",
        source: "demo.form",
        externalId: "mira-intake",
        leadId: "mira",
        occurredAt: DEMO_TIME,
        receivedAt: DEMO_TIME,
        mode: "DEMO",
        fields: fixtures[0].fields,
      },
    ],
    decisions: [
      {
        id: "decision-initial",
        recommendation:
          "Keep learning. Four synthetic leads are not enough to choose a winning experiment.",
        status: "insufficient_evidence",
        evidenceIds: ["event-initial"],
        rulesVersion: 1,
        createdAt: DEMO_TIME,
      },
    ],
    runs: [],
    integrations: [],
    metrics: {
      source: "",
      totalLeads: 0,
      qualified: 0,
      unresolved: 0,
      notIcp: 0,
      unknownAttribution: 0,
      sampleStatus: "",
      experiments: [],
    },
  });
}

export const delayedAnswer: AnswerInput = {
  source: "demo.form",
  externalId: "mira-budget-reply",
  leadId: "mira",
  occurredAt: "2026-09-27T09:00:00.000Z",
  fields: { budget: 6500 },
};

export function receiveDemoAnswer(
  state: State,
  answer: AnswerInput,
): { state: State; duplicate: boolean; changed: string[] } {
  const previous = state.events.find(
    (event) =>
      event.source === answer.source && event.externalId === answer.externalId,
  );
  if (previous) {
    if (
      previous.leadId !== answer.leadId ||
      previous.occurredAt !== answer.occurredAt ||
      JSON.stringify(Object.entries(previous.fields ?? {}).sort()) !==
        JSON.stringify(Object.entries(answer.fields).sort())
    )
      throw new Error("This event ID was already used for different evidence.");
    return { state, duplicate: true, changed: [] };
  }
  const changed: string[] = [];
  const leads = state.leads.map((lead) => {
    if (lead.id !== answer.leadId) return lead;
    const fields = { ...lead.fields };
    for (const [key, incoming] of Object.entries(answer.fields)) {
      const field = key as keyof Fields;
      const latest = state.events
        .filter(
          (event) =>
            event.leadId === lead.id && event.fields && field in event.fields,
        )
        .map((event) =>
          JSON.stringify([event.occurredAt, event.source, event.externalId]),
        )
        .sort()
        .at(-1);
      const clock = JSON.stringify([
        answer.occurredAt,
        answer.source,
        answer.externalId,
      ]);
      if (!latest || clock > latest) {
        if (fields[field] !== incoming) changed.push(field);
        Object.assign(fields, { [field]: incoming });
      }
    }
    return {
      ...lead,
      fields,
      updatedAt:
        answer.occurredAt > lead.updatedAt ? answer.occurredAt : lead.updatedAt,
    };
  });
  const event = {
    id: `demo-event-${state.events.length + 1}`,
    source: answer.source,
    externalId: answer.externalId,
    leadId: answer.leadId,
    occurredAt: answer.occurredAt,
    receivedAt: answer.occurredAt,
    mode: "DEMO",
    fields: answer.fields,
  };
  return {
    state: recalculate({ ...state, leads, events: [...state.events, event] }),
    duplicate: false,
    changed,
  };
}

export function updateDemoProject(state: State, input: ProjectInput): State {
  const version = (state.project?.rulesVersion ?? 0) + 1;
  return recalculate({
    ...state,
    project: {
      id: state.project?.id ?? "demo-project",
      ...input,
      rulesVersion: version,
    },
    decisions: [
      ...state.decisions,
      {
        id: `demo-memory-${version}`,
        recommendation: `Business memory updated: minimum budget ${money(input.rules.minBudget)}, timeline at most ${input.rules.maxTimelineDays} days. Leads re-evaluated against rules v${version}.`,
        status: "review",
        evidenceIds: state.events.map((event) => event.id),
        rulesVersion: version,
        createdAt: new Date(
          Math.max(
            ...state.events.map((event) => Date.parse(event.receivedAt)),
            Date.parse(DEMO_TIME),
          ) +
            version * 300000,
        ).toISOString(),
      },
    ],
  });
}

export function addDemoLead(state: State, input: LeadInput): State {
  const { name, experimentId, ...fields } = input;
  const lead: Lead = {
    id: crypto.randomUUID(),
    name,
    experimentId,
    fields,
    updatedAt: new Date().toISOString(),
    qualification: qualify(
      fields,
      state.project?.rules ?? { minBudget: 5000, maxTimelineDays: 90 },
      state.project?.rulesVersion ?? 1,
    ),
  };
  return recalculate({
    ...state,
    leads: [...state.leads, lead],
    events: [
      ...state.events,
      {
        id: `intake-${lead.id}`,
        source: "demo.manual",
        externalId: lead.id,
        leadId: lead.id,
        fields,
        occurredAt: lead.updatedAt,
        receivedAt: lead.updatedAt,
        mode: "DEMO",
      },
    ],
  });
}

export function addDemoExperiment(
  state: State,
  input: Omit<Experiment, "id">,
): State {
  return recalculate({
    ...state,
    experiments: [...state.experiments, { ...input, id: crypto.randomUUID() }],
  });
}
