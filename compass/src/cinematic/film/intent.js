// Pure derivation from the canonical /api/turn v1 fixture (dinner-turns.json,
// byte-identical copy of feat/agent-core test/fixtures/dinner-turns.json).
// No schema translation: render states are read straight off v1 PatchOps.
//   status 'kept'                      -> kept
//   status 'active', change 'updated'  -> `from` superseded, `to` active (gold)
//   status 'active', change 'added'    -> added
//   status 'active', change 'removed'  -> `from` superseded, nothing active
// Only display formatting happens here (24h -> "8:00 PM", capitalisation).
import { UTTER } from "./timeline.js";

export const FIELD_LABELS = { task: "Task", date: "When", time: "Time", location: "Near", cuisine: "Cuisine", party_size: "Party" };

export function formatValue(field, v) {
  if (v == null) return "";
  if (field === "time" && /^\d{1,2}:\d{2}$/.test(v)) {
    const [h, m] = v.split(":").map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  const s = String(v);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function renderStatus(op) {
  if (op.status === "kept") return "kept";
  if (op.change === "added") return "added";
  if (op.change === "removed") return "removed";
  return "updated";
}

export function deriveRows(fixture) {
  const [t1, t2] = fixture.turns;
  const firstFields = t1.response.patch.map((p) => p.field);
  const order = Object.keys(t2.response.state.intent);
  const ops = [...t2.response.patch].sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
  return ops.map((op) => ({
    field: op.field,
    label: FIELD_LABELS[op.field] || op.field,
    firstIndex: firstFields.indexOf(op.field),
    status: renderStatus(op),
    from: formatValue(op.field, op.from),
    to: formatValue(op.field, op.to),
  }));
}

export function deriveActions(fixture) {
  const t2 = fixture.turns[1].response;
  const inv = t2.events.find((e) => e.type === "action_invalidated");
  return t2.state.actions.map((a) => ({
    id: a.id,
    status: a.status, // invalidated | running | done
    label: ["cuisine", "location", "date", "time"].map((f) => formatValue(f, a.args[f])).filter(Boolean).join(" · "),
    invalidatedFields: a.status === "invalidated" ? (inv && inv.actionId === a.id ? inv.changedFields : a.invalidatedBy?.fields || []) : [],
  }));
}

export function deriveResults(fixture) {
  const tr = fixture.turns[1].response.toolResult;
  const res = tr?.result?.results || [];
  return {
    mock: Boolean(tr?.mock || tr?.result?.mock),
    items: res.map((r) => ({
      name: r.name.replace(/\s*\(mock\)\s*$/i, ""),
      meta: `${r.area} · ${(r.distanceKm * 0.621371).toFixed(1)} mi`,
      slot: formatValue("time", r.availableAt),
    })),
  };
}

// Word timings: fit words into the spoken window proportionally to length.
export function timeWords(text, [a, b]) {
  const list = text.split(/\s+/);
  const weights = list.map((w) => w.length + 2 + (/[.,]$/.test(w) ? 4 : 0));
  const total = weights.reduce((x, y) => x + y, 0);
  let acc = 0;
  return list.map((w, i) => {
    const s = a + ((b - a) * acc) / total;
    acc += weights[i];
    return { w, s };
  });
}

export function deriveCues(fixture) {
  const [t1, t2] = fixture.turns;
  const says = (r, turnId) => r.events.filter((e) => e.type === "say" && e.turnId === turnId).map((e) => e.text);
  const lines = [
    { id: "user1", speaker: "You", text: t1.request.text },
    { id: "say1", speaker: "COMPASS", text: says(t1.response, t1.response.turnId)[0] },
    { id: "user2", speaker: "You", text: t2.request.text, interrupt: true },
    { id: "say2", speaker: "COMPASS", text: says(t2.response, t2.response.turnId)[0] },
    { id: "reply", speaker: "COMPASS", text: t2.response.reply },
  ];
  return lines.filter((l) => l.text).map((l) => ({ ...l, window: UTTER[l.id], words: timeWords(l.text, UTTER[l.id]) }));
}

export function patchSummary(rows) {
  const n = (s) => rows.filter((r) => r.status === s).length;
  return [
    n("updated") && `${n("updated")} updated`,
    n("added") && `${n("added")} added`,
    n("removed") && `${n("removed")} removed`,
    n("kept") && `${n("kept")} kept`,
  ].filter(Boolean).join(" · ");
}
