// Tool router contract. Every tool:
//   name, description, mock (bool), sideEffect (bool; side-effect tools must be user-confirmed)
//   dependsOn: intent fields whose change makes a result stale
//   requires:  intent fields that must be known before the tool can run
//   argsFromIntent(intent) -> args   (state is the source of truth for arguments)
//   run(args, { signal }) -> Promise<result>   (must honor AbortSignal)
//   summarize(result, intent) -> short spoken string
export function createToolRegistry(defs = []) {
  const byName = new Map();
  for (const d of defs) {
    for (const k of ['name', 'description', 'dependsOn', 'requires', 'argsFromIntent', 'run', 'summarize']) {
      if (d[k] == null) throw new Error(`Tool ${d.name ?? '?'} missing ${k}`);
    }
    byName.set(d.name, Object.freeze({ mock: false, sideEffect: false, ...d }));
  }
  return {
    get: (name) => byName.get(name) || null,
    list: () => [...byName.values()],
    /** Compact description for the model prompt. */
    describe: () => [...byName.values()].map((t) => ({ name: t.name, description: t.description, requires: t.requires })),
  };
}

export function missingFields(tool, intent) {
  return tool.requires.filter((f) => intent[f] == null);
}
