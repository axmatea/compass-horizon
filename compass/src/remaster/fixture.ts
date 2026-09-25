import type {
  Command, Fact, MemoryOp, Person, Preset, RunOptions, Snapshot, Task, Transport, TransportUpdate,
} from './types.ts';

const DAY_MS = 2_000;
const LEAVE_ID = 'fact-sarah-availability';
const PRESETS: Preset[] = ['sarah-leave', 'deadline-shift', 'dependency-delay'];
const TEAM: Person[] = [
  { id: 'priya', name: 'Priya', role: 'Product lead', initials: 'PR', color: '#ac682f', skills: ['planning', 'delivery'] },
  { id: 'sarah', name: 'Sarah', role: 'Product designer', initials: 'SA', color: '#b45272', skills: ['research', 'visuals'] },
  { id: 'max', name: 'Max', role: 'Design engineer', initials: 'MA', color: '#47736a', skills: ['visuals', 'frontend'] },
  { id: 'leo', name: 'Leo', role: 'Frontend engineer', initials: 'LE', color: '#5871a0', skills: ['frontend', 'accessibility'] },
  { id: 'maya', name: 'Maya', role: 'Backend engineer', initials: 'MY', color: '#787338', skills: ['backend', 'integration'] },
  { id: 'noah', name: 'Noah', role: 'Quality engineer', initials: 'NO', color: '#886c91', skills: ['testing', 'release'] },
];

type Work = { id: string; title: string; owner: string; earliest: number; days: number; dependencies: string[] };
type Progress = { done: number; started: number | null };
type Subscriber = { listener: (update: TransportUpdate) => void; runId: string; seq: number };

function workFor(seed: number): Work[] {
  const coreDays = 6 + ((Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0) % 3;
  return [
    { id: 'brief', title: 'Product brief', owner: 'priya', earliest: 1, days: 4, dependencies: [] },
    { id: 'architecture', title: 'Service architecture', owner: 'maya', earliest: 5, days: 5, dependencies: ['brief'] },
    { id: 'flows', title: 'User flows', owner: 'sarah', earliest: 11, days: 4, dependencies: ['brief'] },
    { id: 'api', title: 'Core API', owner: 'maya', earliest: 15, days: 5, dependencies: ['architecture', 'flows'] },
    { id: 'core', title: 'Core product UI', owner: 'leo', earliest: 21, days: coreDays, dependencies: ['api'] },
    { id: 'blueprint', title: 'Launch blueprint', owner: 'priya', earliest: 25, days: 4, dependencies: ['flows'] },
    { id: 'integration', title: 'End-to-end integration', owner: 'maya', earliest: 31, days: 6, dependencies: ['core', 'api'] },
    { id: 'onboarding', title: 'Onboarding experience', owner: 'max', earliest: 35, days: 5, dependencies: ['core', 'flows'] },
    { id: 'launch-visuals', title: 'Launch visuals', owner: 'sarah', earliest: 41, days: 5, dependencies: ['blueprint', 'core'] },
    { id: 'release-qa', title: 'Release QA', owner: 'noah', earliest: 46, days: 5, dependencies: ['integration', 'onboarding', 'launch-visuals'] },
    { id: 'polish', title: 'Release polish', owner: 'leo', earliest: 51, days: 5, dependencies: ['release-qa'] },
    { id: 'handoff', title: 'Launch and handoff', owner: 'priya', earliest: 56, days: 5, dependencies: ['polish'] },
  ];
}

function initialSnapshot(seed: number, stressTest: boolean, runId: string): Snapshot {
  return {
    schemaVersion: 1, runId, seq: 0, executionMode: 'fixture', teamSource: 'simulated',
    day: 0, deadlineDay: 60, status: 'idle', phase: 'planning', stressTest, seed,
    team: structuredClone(TEAM),
    tasks: workFor(seed).map(work => ({
      id: work.id, title: work.title, ownerId: work.owner, sprint: Math.ceil(work.earliest / 10),
      startDay: work.earliest, dueDay: work.earliest + work.days - 1, completedDay: null,
      status: 'planned', dependsOn: [...work.dependencies],
    })),
    facts: [], memoryOps: [], decisions: [], checks: [], feed: [], receipts: [], injections: [],
    metrics: { completedTasks: 0, totalTasks: 12, conflictsDetected: 0, restores: 0, protectedFacts: 0, contextTokens: null },
    outcome: null,
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function commandKey(command: Command): string {
  if (!object(command) || typeof command.commandId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(command.commandId)) {
    throw new Error('Invalid fixture command ID');
  }
  const keys = Object.keys(command).sort().join(',');
  if (command.type === 'pause' || command.type === 'resume') {
    if (keys === 'commandId,type') return command.type;
  } else if (command.type === 'inject_event' && keys === 'commandId,payload,type') {
    if (object(command.payload) && Object.keys(command.payload).join(',') === 'preset' && PRESETS.includes(command.payload.preset)) {
      return `inject_event:${command.payload.preset}`;
    }
  }
  throw new Error('Invalid fixture command');
}

/** Entirely local, deterministic SIMULATION. No model, backend, token or cost estimates. */
export class FixtureTransport implements Transport {
  private snapshot = initialSnapshot(42, false, 'fixture-idle');
  private readonly autoTick: boolean;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private elapsed = 0;
  private runNumber = 0;
  private nextId = 0;
  private progress = new Map<string, Progress>();
  private releaseGates = new Map<string, number>();
  private commands = new Map<string, string>();
  private pendingRepair = false;
  private subscribers = new Set<Subscriber>();
  private publications: Snapshot[] = [];
  private publishing = false;

  constructor({ autoTick = true }: { autoTick?: boolean } = {}) {
    this.autoTick = autoTick;
  }

  getSnapshot(): Snapshot {
    return structuredClone(this.snapshot);
  }

  subscribe(listener: (update: TransportUpdate) => void): () => void {
    if (this.disposed) return () => {};
    const subscriber = { listener, runId: '', seq: -1 };
    this.subscribers.add(subscriber);
    this.deliver(subscriber, this.snapshot);
    return () => { this.subscribers.delete(subscriber); };
  }

  async start(options: RunOptions): Promise<void> {
    this.assertOpen();
    if (!object(options) || !Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffff_ffff || typeof options.stressTest !== 'boolean') {
      throw new Error('Fixture requires an unsigned 32-bit seed and a stressTest boolean');
    }
    this.stopClock();
    this.elapsed = 0;
    this.nextId = 0;
    this.pendingRepair = false;
    this.commands.clear();
    this.releaseGates.clear();
    this.progress = new Map(workFor(options.seed).map(work => [work.id, { done: 0, started: null }]));
    this.snapshot = initialSnapshot(options.seed, options.stressTest, `fixture-${options.seed}-${++this.runNumber}`);
    this.snapshot.status = 'running';
    this.log('simulation', 'Simulation started', `Synthetic six-person team, 60 working days, seed ${options.seed}. ${options.stressTest ? 'Scripted stress test: archive day 30, divergence day 31, repair day 32.' : 'No-stress mode: retain availability and prevent conflicts.'}`);
    this.replan(1);
    this.publish();
    this.startClock();
  }

  async command(command: Command): Promise<void> {
    this.assertOpen();
    const key = commandKey(command);
    const previous = this.commands.get(command.commandId);
    if (previous !== undefined) {
      if (previous !== key) throw new Error('Fixture command ID reused with a different payload');
      return;
    }
    if (this.snapshot.status !== 'running' && this.snapshot.status !== 'paused') {
      throw new Error('Fixture commands require a running or paused run');
    }
    if (this.commands.size >= 256) throw new Error('Fixture command limit reached; restart the simulation');
    this.commands.set(command.commandId, key);
    if (command.type === 'inject_event') {
      const preset = command.payload.preset;
      if (this.snapshot.injections.includes(preset)) return;
      this.snapshot.injections.push(preset);
      this.inject(preset);
    } else {
      const status = command.type === 'pause' ? 'paused' : 'running';
      if (status === this.snapshot.status) return;
      this.snapshot.status = status;
      this.log('control', status === 'paused' ? 'Simulation paused' : 'Simulation resumed', 'Only the local simulation clock is affected.');
    }
    if (this.snapshot.day >= this.snapshot.deadlineDay) this.finish();
    this.publish();
    if (this.snapshot.status === 'running') this.startClock();
    else this.stopClock();
  }

  advanceTime(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0 || ms > Number.MAX_SAFE_INTEGER) throw new Error('Invalid fixture elapsed time');
    if (this.disposed || this.snapshot.status !== 'running') return;
    let remaining = ms;
    while (this.snapshot.status === 'running' && !this.disposed && remaining >= DAY_MS - this.elapsed) {
      remaining -= DAY_MS - this.elapsed;
      this.elapsed = 0;
      this.advanceDay();
    }
    // Time supplied after a subscriber pauses/completes the run must not become backlog.
    if (this.snapshot.status === 'running' && !this.disposed) this.elapsed += remaining;
  }

  dispose(): void {
    this.disposed = true;
    this.stopClock();
    this.subscribers.clear();
    this.publications = [];
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('Fixture transport is disposed');
  }

  private startClock(): void {
    if (this.autoTick && !this.disposed && this.snapshot.status === 'running' && this.timer === undefined) {
      this.timer = setInterval(() => this.advanceTime(250), 250);
    }
  }

  private stopClock(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private id(prefix: string): string { return `${this.snapshot.runId}:${prefix}:${++this.nextId}`; }

  private log(kind: string, title: string, detail: string, evidenceIds: string[] = []): string {
    const id = this.id('event');
    this.snapshot.feed.push({ id, day: this.snapshot.day, kind, title, detail, evidenceIds: [...evidenceIds] });
    return id;
  }

  private memory(op: MemoryOp['op'], fact: Fact, why: string): void {
    this.snapshot.memoryOps.push({ id: this.id('memory'), day: this.snapshot.day, op, factIds: [fact.id], why });
    this.log('memory', `${op}: ${fact.id}`, why, [fact.id]);
  }

  private availability(): Fact | undefined { return this.snapshot.facts.find(fact => fact.id === LEAVE_ID); }
  private visuals(): Task { return this.snapshot.tasks.find(task => task.id === 'launch-visuals')!; }
  private planLabel(): string {
    const task = this.visuals();
    return `${task.title}: ${task.ownerId}, days ${task.startDay}-${task.dueDay}`;
  }

  private learnAvailability(source: string): void {
    if (this.availability()) return;
    const sourceEventId = this.log('fact', 'Synthetic availability note', `Sarah is unavailable on working days 41-45. Source: ${source}.`, [LEAVE_ID]);
    const fact: Fact = {
      id: LEAVE_ID, text: 'Synthetic team: Sarah is unavailable on working days 41-45.', personId: 'sarah',
      learnedDay: this.snapshot.day, effectiveFrom: 41, effectiveTo: 45, state: 'active', source, sourceEventId,
    };
    this.snapshot.facts.push(fact);
    this.memory('keep', fact, 'Keep the availability note as a future scheduling constraint.');
    const before = this.planLabel();
    this.replan(Math.max(1, this.snapshot.day + 1));
    this.memory('promote', fact, 'Promote availability into the working plan before assigning launch visuals.');
    const after = this.planLabel();
    if (before !== after) {
      this.snapshot.decisions.push({
        id: this.id('decision'), day: this.snapshot.day, summary: 'Prevent an assignment during Sarah\'s absence',
        before, after, evidenceIds: [fact.id], state: 'prevented',
      });
      this.log('decision', 'Availability conflict prevented', `${before} -> ${after}`, [fact.id]);
    }
  }

  private foldSprintNote(): void {
    const completed = this.snapshot.tasks.filter(task => task.sprint === 1 && task.completedDay !== null);
    const id = 'fact-sprint-1-summary';
    const text = `Synthetic sprint 1 review: ${completed.map(task => task.title).join(' and ')} completed. Detailed work remains in the feed.`;
    const sourceEventId = this.log('fact', 'Scripted sprint review', text, [id, ...completed.map(task => task.id)]);
    const fact: Fact = {
      id, text, personId: null, learnedDay: this.snapshot.day, effectiveFrom: 1, effectiveTo: 10,
      state: 'folded', source: 'scripted sprint review', sourceEventId,
    };
    this.snapshot.facts.push(fact);
    this.memory('fold', fact, 'Fold completed sprint details into a retained, source-linked summary. Folding is not forgetting; future availability remains in the working plan.');
  }

  private inject(preset: Preset): void {
    if (preset === 'sarah-leave') {
      this.log('injection', 'Player availability preset', 'Synthetic Sarah leave, working days 41-45. Existing standup evidence is retained, not duplicated.', [LEAVE_ID]);
      this.learnAvailability('player preset (simulation)');
      return;
    }
    const factId = `fact-${preset}`;
    const sourceEventId = this.log('injection', preset === 'deadline-shift' ? 'Deadline moved to day 50' : 'Dependency delayed', 'Player changed the synthetic schedule; completion still requires actual work.', [factId]);
    let description = 'Synthetic project deadline is now working day 50.';
    if (preset === 'deadline-shift') this.snapshot.deadlineDay = 50;
    else {
      const target = ['release-qa', 'polish', 'handoff'].find(id => this.snapshot.tasks.find(task => task.id === id)!.status !== 'done')!;
      const work = workFor(this.snapshot.seed).find(item => item.id === target)!;
      const availableDay = Math.max(work.earliest, this.snapshot.day + 1) + 12;
      this.releaseGates.set(target, availableDay);
      description = `Synthetic external dependency for ${target} is delayed 12 working days; work can resume on day ${availableDay}.`;
    }
    const fact: Fact = {
      id: factId, text: description, personId: null, learnedDay: this.snapshot.day,
      effectiveFrom: this.snapshot.day, effectiveTo: 60, state: 'active', source: 'player preset (simulation)', sourceEventId,
    };
    this.snapshot.facts.push(fact);
    this.memory('keep', fact, description);
    this.replan(this.snapshot.day + 1);
    this.log('planning', 'Schedule recalculated', `${description} Forecast handoff: day ${this.snapshot.tasks.at(-1)!.dueDay}.`, [factId]);
  }

  // Topological, finite-work scheduler. Forecasts reserve one task per owner per day.
  // The doer sees retained facts; execution always obeys the synthetic world's absence.
  private replan(fromDay: number): void {
    const ownerDays = new Set<string>();
    const availability = this.availability();
    const knowsLeave = availability !== undefined && availability.state !== 'archived';
    for (const work of workFor(this.snapshot.seed)) {
      const task = this.snapshot.tasks.find(item => item.id === work.id)!;
      const progress = this.progress.get(work.id)!;
      if (task.completedDay !== null) continue;
      const dependencyDay = Math.max(0, ...task.dependsOn.map(id => {
        const dependency = this.snapshot.tasks.find(item => item.id === id)!;
        return dependency.completedDay ?? dependency.dueDay;
      })) + 1;
      let earliest = progress.started === null ? work.earliest : fromDay;
      let owner = progress.started === null ? work.owner : task.ownerId;
      if (work.id === 'launch-visuals' && knowsLeave && progress.started === null) {
        if (Math.max(fromDay, dependencyDay, 36) <= 36) earliest = 36;
        else owner = 'max';
      }
      let day = Math.max(fromDay, earliest, dependencyDay, this.releaseGates.get(work.id) ?? 1);
      let start = 0;
      let remaining = work.days - progress.done;
      while (remaining > 0) {
        const absent = knowsLeave && owner === 'sarah' && day >= 41 && day <= 45;
        if (!absent && !ownerDays.has(`${owner}:${day}`)) {
          ownerDays.add(`${owner}:${day}`);
          if (start === 0) start = day;
          remaining--;
        }
        day++;
      }
      task.ownerId = owner;
      task.startDay = progress.started ?? start;
      task.dueDay = day - 1;
      task.sprint = Math.min(6, Math.ceil(task.startDay / 10));
      const waiting = this.snapshot.day >= work.earliest && (
        (this.releaseGates.get(work.id) ?? 1) > this.snapshot.day ||
        task.dependsOn.some(id => this.snapshot.tasks.find(item => item.id === id)!.completedDay === null)
      );
      task.status = waiting ? 'blocked' : progress.done > 0 ? 'active' : 'planned';
    }
  }

  private workDay(): void {
    const owners = new Set<string>();
    const worked: string[] = [];
    for (const work of workFor(this.snapshot.seed)) {
      const task = this.snapshot.tasks.find(item => item.id === work.id)!;
      if (task.completedDay !== null || task.startDay > this.snapshot.day) continue;
      const dependenciesReady = task.dependsOn.every(id => {
        const completed = this.snapshot.tasks.find(item => item.id === id)!.completedDay;
        return completed !== null && completed < this.snapshot.day;
      });
      if (!dependenciesReady || (this.releaseGates.get(task.id) ?? 1) > this.snapshot.day ||
        (task.ownerId === 'sarah' && this.snapshot.day >= 41 && this.snapshot.day <= 45) || owners.has(task.ownerId)) {
        task.status = 'blocked';
        continue;
      }
      const progress = this.progress.get(task.id)!;
      if (progress.started === null) {
        progress.started = this.snapshot.day;
        this.log('task', `Started: ${task.title}`, `${task.ownerId} started ${task.id}; all dependencies completed on earlier days.`, task.dependsOn);
      }
      owners.add(task.ownerId);
      progress.done++;
      task.status = 'active';
      worked.push(`${task.id} (${task.ownerId}, ${progress.done}/${work.days})`);
      if (progress.done === work.days) {
        task.status = 'done';
        task.completedDay = this.snapshot.day;
        task.dueDay = this.snapshot.day;
        this.log('task', `Completed: ${task.title}`, `${work.days} working days completed by ${task.ownerId}.`, [task.id]);
      }
    }
    this.log('work', `Working day ${this.snapshot.day}`, worked.length ? worked.join('; ') : 'No runnable work; waiting for scheduled starts or dependencies.');
  }

  private check(verdict: 'same' | 'divergence' | 'restored', before?: string): void {
    const fact = this.availability();
    const summary = verdict === 'divergence'
      ? 'Scripted checker: the doer lost availability; retained source evidence rejects Sarah on days 41-45. Repair waits until day 32.'
      : verdict === 'restored'
        ? 'Scripted recovery restored the actual archived fact and recalculated the assignment.'
        : 'Local schedule check: working memory and retained availability evidence agree.';
    this.snapshot.checks.push({
      id: this.id('check'), day: this.snapshot.day, doer: before ?? this.planLabel(),
      shadow: verdict === 'divergence' ? 'Move launch visuals before day 41 or assign Max; Sarah is absent days 41-45.' : this.planLabel(),
      verdict, factIds: fact ? [fact.id] : [], summary,
    });
    if (verdict !== 'same') this.log('check', `Scripted checker: ${verdict}`, summary, fact ? [fact.id] : []);
  }

  private restore(): void {
    const fact = this.availability()!;
    const before = this.planLabel();
    fact.state = 'active';
    this.pendingRepair = false;
    this.memory('restore', fact, 'Scripted stress recovery on day 32: restore the archived availability from retained evidence.');
    this.replan(this.snapshot.day);
    this.snapshot.decisions.push({
      id: this.id('decision'), day: this.snapshot.day, summary: 'Scripted recovery applied to the launch plan',
      before, after: this.planLabel(), evidenceIds: [fact.id], state: 'applied',
    });
    this.log('decision', 'Launch assignment repaired', `${before} -> ${this.planLabel()}`, [fact.id]);
    this.check('restored', before);
  }

  private advanceDay(): void {
    this.snapshot.day++;
    this.snapshot.phase = 'working';
    if (this.snapshot.day === 7) this.learnAvailability('scripted standup');
    const repairing = this.pendingRepair && this.snapshot.day === 32;
    if (repairing) this.restore();
    this.replan(this.snapshot.day);
    this.workDay();
    this.replan(this.snapshot.day + 1);
    if (this.snapshot.day === 10) this.foldSprintNote();
    const fact = this.availability();
    if (this.snapshot.stressTest && this.snapshot.day === 30 && fact) {
      this.snapshot.phase = 'night';
      const before = this.planLabel();
      fact.state = 'archived';
      this.memory('archive', fact, 'Explicit scripted stress fault on night 30: deliberately remove future availability from working memory, not from retained evidence.');
      this.replan(this.snapshot.day + 1);
      this.log('planning', 'Scripted fault changed the plan', `${before} -> ${this.planLabel()}`, [fact.id]);
    } else if (this.snapshot.stressTest && this.snapshot.day === 31 && fact?.state === 'archived') {
      this.snapshot.phase = 'checking';
      this.pendingRepair = true;
      this.check('divergence');
      this.snapshot.decisions.push({
        id: this.id('decision'), day: this.snapshot.day, summary: 'Scripted checker proposes restoring availability on the next day',
        before: this.planLabel(), after: 'Restore availability, then move visuals earlier or assign Max.', evidenceIds: [fact.id], state: 'proposed',
      });
    } else if (repairing) this.snapshot.phase = 'restoring';
    else {
      this.check('same');
      if (this.snapshot.day % 10 === 0) {
        this.snapshot.phase = 'night';
        if (fact) this.memory('keep', fact, 'Routine scripted cleanup retains availability; no memory fault or restore occurred.');
      } else if (this.snapshot.day % 5 === 0) this.snapshot.phase = 'checking';
    }
    if (this.snapshot.day >= this.snapshot.deadlineDay) this.finish();
    this.publish();
  }

  private finish(): void {
    const unfinished = this.snapshot.tasks.filter(task => task.completedDay === null);
    const success = unfinished.length === 0;
    this.snapshot.status = 'completed';
    this.snapshot.phase = 'finished';
    this.snapshot.outcome = {
      success, title: success ? 'Simulation delivered on time' : 'Simulation missed the deadline',
      reason: success ? `All 12 tasks completed through dependency-ordered work by day ${this.snapshot.day}.`
        : `${unfinished.length} tasks unfinished at deadline ${this.snapshot.deadlineDay}: ${unfinished.map(task => task.title).join(', ')}. Current handoff forecast: day ${this.snapshot.tasks.at(-1)!.dueDay}.`,
    };
    this.log('outcome', this.snapshot.outcome.title, this.snapshot.outcome.reason);
    this.stopClock();
  }

  private deliver(subscriber: Subscriber, snapshot: Snapshot): void {
    if (!this.subscribers.has(subscriber) || (subscriber.runId === snapshot.runId && subscriber.seq >= snapshot.seq)) return;
    subscriber.runId = snapshot.runId;
    subscriber.seq = snapshot.seq;
    // A broken or mutating UI listener cannot alter the simulation or another listener.
    try { subscriber.listener({ kind: 'state', snapshot: structuredClone(snapshot) }); } catch { /* Isolate observers. */ }
  }

  private publish(): void {
    const snapshot = this.snapshot;
    snapshot.metrics = {
      completedTasks: snapshot.tasks.filter(task => task.status === 'done').length, totalTasks: snapshot.tasks.length,
      conflictsDetected: snapshot.checks.filter(check => check.verdict === 'divergence').length,
      restores: snapshot.memoryOps.filter(op => op.op === 'restore').length,
      protectedFacts: snapshot.facts.filter(fact => fact.state !== 'archived').length, contextTokens: null,
    };
    // A normal 180-second session retains the complete story; runaway UI input stays bounded.
    snapshot.feed = snapshot.feed.slice(-512);
    snapshot.memoryOps = snapshot.memoryOps.slice(-128);
    snapshot.decisions = snapshot.decisions.slice(-128);
    snapshot.checks = snapshot.checks.slice(-128);
    snapshot.seq++;
    this.publications.push(this.getSnapshot());
    if (this.publishing) return;
    this.publishing = true;
    try {
      while (this.publications.length && !this.disposed) {
        const next = this.publications.shift()!;
        for (const subscriber of this.subscribers) {
          if (next.runId !== this.snapshot.runId) break;
          this.deliver(subscriber, next);
        }
      }
    } finally { this.publishing = false; }
  }
}
