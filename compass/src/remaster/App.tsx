import { Component, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { FixtureTransport } from "./fixture";
import { LiveTransport } from "./live";
import type {
  Command,
  Preset,
  Snapshot,
  Transport,
  TransportUpdate,
} from "./types";
import {
  ChangeSheet,
  DetailDrawer,
  Icon,
  MemoryXray,
  Outcome,
  Overlay,
  SprintPath,
} from "./components";
import type { AssignmentChange, DrawerTarget } from "./components";
import "./styles.css";
import { StudioExperience } from './Studio';
import './studio.css';

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

const live = /^\/demo\/remaster\/app(?:\/|$)/.test(window.location.pathname);
const phaseLabels: Record<Snapshot["phase"], string> = {
  planning: "Planning the work",
  working: "Work in motion",
  night: "Nightly memory cleanup",
  checking: "Shadow is checking",
  restoring: "Memory is being restored",
  finished: "Quarter finished",
};
const manualClock =
  !live &&
  new URLSearchParams(window.location.search).get("clock") === "manual";
const makeTransport = (): Transport =>
  live ? new LiveTransport() : new FixtureTransport({ autoTick: !manualClock });
const currentSprint = (snapshot: Snapshot | null) =>
  Math.max(1, Math.min(6, Math.ceil(Math.max(1, snapshot?.day ?? 0) / 10)));
const getError = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The transport did not confirm this action.";

export default function App() {
  const [transport, setTransport] = useState<Transport>(makeTransport);
  const transportRef = useRef(transport);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() =>
    transport.getSnapshot(),
  );
  const snapshotRef = useRef(snapshot);
  const [connection, setConnection] = useState<{
    status: "connecting" | "connected" | "reconnecting" | "blocked";
    message?: string;
  }>({
    status: live ? "connecting" : "connected",
    ...(live
      ? {
          message:
            "Live / not connected. Start explicitly to check the invited runtime.",
        }
      : {}),
  });
  const [stressTest, setStressTest] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [startLocked, setStartLocked] = useState(false);
  const [overlay, setOverlay] = useState<
    "change" | "memory" | "restart" | null
  >(null);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [inspectedSprint, setInspectedSprint] = useState<number | null>(null);
  const [changes, setChanges] = useState<AssignmentChange[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const sprint = inspectedSprint ?? currentSprint(snapshot);
  const current = currentSprint(snapshot);
  const status = snapshot?.status ?? "idle";
  const active = status === "running" || status === "paused";
  const finished = status === "completed";

  useEffect(() => {
    let disposed = false;
    transportRef.current = transport;
    function receive(update: TransportUpdate) {
      if (disposed) return;
      if (update.kind === "connection") {
        setConnection({ status: update.status, message: update.message });
        return;
      }
      const next = update.snapshot;
      if (
        next.executionMode !== (live ? "live" : "fixture") ||
        next.teamSource !== "simulated"
      ) {
        setError(
          "Unexpected execution mode. This snapshot is not displayed; no fixture fallback is used.",
        );
        return;
      }
      const previous = snapshotRef.current;
      if (previous?.runId === next.runId && next.seq < previous.seq) return;
      if (previous?.runId === next.runId) {
        const reassigned = next.tasks.flatMap((task) => {
          const old = previous.tasks.find((item) => item.id === task.id);
          return old && old.ownerId !== task.ownerId
            ? [
                {
                  taskId: task.id,
                  from: old.ownerId,
                  to: task.ownerId,
                  day: next.day,
                },
              ]
            : [];
        });
        if (reassigned.length)
          setChanges((old) => [
            ...reassigned,
            ...old.filter(
              (change) =>
                !reassigned.some((item) => item.taskId === change.taskId),
            ),
          ]);
      }
      snapshotRef.current = next;
      setSnapshot(next);
    }
    const unsubscribe = transport.subscribe(receive);
    const initial = transport.getSnapshot();
    if (initial) receive({ kind: "state", snapshot: initial });
    return () => {
      disposed = true;
      unsubscribe();
      transport.dispose();
    };
  }, [transport]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.current?.requestFullscreen();
    } catch {
      setNotice(
        "Fullscreen is not available in this browser. The board still works in this window.",
      );
    }
  }
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat)
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]'))
        return;
      if (event.key.toLowerCase() === "f" && !overlay && !drawer) {
        event.preventDefault();
        void toggleFullscreen();
      }
      if (
        event.key === "Escape" &&
        !overlay &&
        !drawer &&
        document.fullscreenElement
      )
        void document.exitFullscreen();
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [overlay, drawer]);

  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        coordinates:
          "Accessible DOM board. Origin top-left; x right, y down. No coordinate-controlled physics.",
        snapshot,
        mode: live ? "live" : "fixture",
        teamSource: snapshot?.teamSource ?? null,
        connection,
        pending,
        error: error || null,
        overlay,
        drawer,
        runId: snapshot?.runId ?? null,
        seq: snapshot?.seq ?? null,
        day: snapshot?.day ?? null,
        deadlineDay: snapshot?.deadlineDay ?? null,
        status: snapshot?.status ?? "no_snapshot",
        phase: snapshot?.phase ?? null,
        currentSprint: current,
        displayedSprint: sprint,
        seed: snapshot?.seed ?? 42,
        stressTest:
          snapshot?.status === "idle" || !snapshot
            ? !live && stressTest
            : snapshot.stressTest,
        team:
          snapshot?.team.map((person) => ({
            id: person.id,
            name: person.name,
            role: person.role,
            assignedActiveTaskIds: snapshot.tasks
              .filter(
                (task) =>
                  task.ownerId === person.id && task.status === "active",
              )
              .map((task) => task.id),
          })) ?? [],
        visibleTasks:
          snapshot?.tasks.filter((task) => task.sprint === sprint) ?? [],
        assignmentChanges: changes.filter((change) =>
          snapshot?.tasks.some(
            (task) => task.sprint === sprint && task.id === change.taskId,
          ),
        ),
        visibleDecisions: snapshot
          ? [...snapshot.decisions].reverse().sort((a, b) => b.day - a.day).slice(0, 1)
          : [],
        visibleSignals: [],
        metrics: snapshot?.metrics ?? null,
        outcome: snapshot?.outcome ?? null,
        memory:
          overlay === "memory" && snapshot
            ? {
                facts: snapshot.facts,
                operations: snapshot.memoryOps,
                checks: snapshot.checks,
                receipts: snapshot.receipts,
              }
            : null,
        inspected:
          !snapshot || !drawer
            ? null
            : drawer.kind === "person"
              ? snapshot.team.find((person) => person.id === drawer.id)
              : drawer.kind === "task"
                ? snapshot.tasks.find((task) => task.id === drawer.id)
                : snapshot.decisions.find(
                    (decision) => decision.id === drawer.id,
                  ),
        controls: {
          primary:
            status === "running"
              ? "Pause"
              : status === "paused"
                ? "Resume"
                : "Start the quarter",
          canIntroduceChange: active && !pending,
          canAdvanceTime: !live,
          manualClock,
          startLocked,
          fullscreen,
        },
      });
    if (!live)
      window.advanceTime = (ms: number) => {
        if (!Number.isFinite(ms) || ms < 0)
          throw new Error(
            "advanceTime requires a non-negative finite number of milliseconds.",
          );
        flushSync(() => transportRef.current.advanceTime?.(ms));
      };
    else delete window.advanceTime;
    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, [
    snapshot,
    connection,
    pending,
    error,
    overlay,
    drawer,
    current,
    sprint,
    stressTest,
    changes,
    fullscreen,
    status,
    active,
    startLocked,
  ]);

  async function perform(
    label: string,
    action: () => Promise<void>,
  ): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setPending(label);
    setError("");
    setNotice("");
    try {
      await action();
      return true;
    } catch (cause) {
      if (
        live &&
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        cause.code === "START_UNCERTAIN"
      )
        setStartLocked(true);
      setError(`${getError(cause)} No action was replayed automatically.`);
      return false;
    } finally {
      busy.current = false;
      setPending(null);
    }
  }
  async function primaryAction() {
    if (startLocked) return;
    const state = transportRef.current.getSnapshot();
    if (state?.status === "running" || state?.status === "paused") {
      const command: Command = {
        commandId: crypto.randomUUID(),
        type: state.status === "running" ? "pause" : "resume",
      };
      await perform(command.type, () => transportRef.current.command(command));
    } else if (state?.status !== "completed") {
      setInspectedSprint(null);
      await perform("start", () =>
        transportRef.current.start({
          seed: 42,
          stressTest: live ? false : stressTest,
        }),
      );
    }
  }
  async function inject(preset: Preset) {
    const command: Command = {
      commandId: crypto.randomUUID(),
      type: "inject_event",
      payload: { preset },
    };
    const confirmed = await perform("change", () =>
      transportRef.current.command(command),
    );
    if (confirmed) {
      setOverlay(null);
      setInspectedSprint(null);
      setNotice(
        "Change submitted. The board shows the transport response, not a local prediction.",
      );
    }
  }
  function reset() {
    if (busy.current) return;
    transportRef.current.dispose();
    const next = makeTransport();
    transportRef.current = next;
    snapshotRef.current = next.getSnapshot();
    setSnapshot(next.getSnapshot());
    setTransport(next);
    setChanges([]);
    setError("");
    setNotice("");
    setInspectedSprint(null);
    setOverlay(null);
    setDrawer(null);
    setStressTest(true);
    setConnection({
      status: live ? "connecting" : "connected",
      ...(live
        ? {
            message:
              "Live / not connected. Start explicitly to check the invited runtime.",
          }
        : {}),
    });
  }
  function nextDay() {
    if (live || !active || busy.current) return;
    flushSync(() => transportRef.current.advanceTime?.(2000));
  }
  const primaryLabel =
    pending === "start"
      ? "Starting..."
      : pending === "pause"
        ? "Pausing..."
        : pending === "resume"
          ? "Resuming..."
          : finished
            ? "Quarter complete"
            : status === "running"
              ? "Pause"
              : status === "paused"
                ? "Resume"
                : "Start the quarter";

  return (
    <div
      className={`rm-game rm-studio-game ${snapshot ? `phase-${snapshot.phase}` : ""} ${overlay === "memory" ? "xray-open" : ""}`}
      ref={stage}
    >
      <a className="rm-skip" href="#project-board">
        Skip to project board
      </a>
      <header className="rm-topbar">
        <a className="rm-brand" href="/" aria-label="COMPASS REMaster home">
          <span className="rm-brand-icon">
            <Icon name="mark" />
          </span>
          <span>
            RE<span className="rm-brand-light">Master</span>
            <span className="rm-brand-dot">.</span>
            <small className="rm-parent-brand">COMPASS</small>
          </span>
        </a>
        <span className="rm-topbar-caption">
          <strong>COMPASS</strong> / A working memory game
        </span>
        <div className="rm-topbar-actions">
          <span
            className={`rm-mode ${snapshot?.executionMode === "live" ? "live" : ""}`}
          >
            <i />
            {live
              ? snapshot?.executionMode === "live"
                ? "LIVE AI · SIMULATED TEAM"
                : "LIVE / NOT CONNECTED"
              : "SCRIPTED SIMULATION"}
          </span>
          <a className="rm-mode-link" href={live ? "/demo/remaster" : "/demo/remaster/app"}>
            {live ? "Public fixture" : "Live mode"}
            <Icon name="arrow" />
          </a>
          <button
            type="button"
            className="rm-icon-button rm-fullscreen-button"
            onClick={() => void toggleFullscreen()}
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title="Fullscreen (F)"
          >
            <Icon name="expand" />
          </button>
        </div>
      </header>
      <main className="rm-scene" id="project-board" tabIndex={-1}>
        <section className="rm-game-heading">
          <div>
            <p className="rm-kicker">
              A WORKING MEMORY GAME / COMPASS
            </p>
            <h1>
              Build a team <span>that remembers.</span>
            </h1>
            <p className="rm-game-subtitle">
              Six teammates. Sixty working days. Can your team make Demo Day?
            </p>
          </div>
          <div
            className="rm-clock-panel"
            aria-label={
              snapshot
                ? `Day ${snapshot.day}, deadline day ${snapshot.deadlineDay}`
                : "No live day reported yet"
            }
          >
            <span className="rm-clock-label">DAY</span>
            <strong key={snapshot?.day ?? "none"}>
              {snapshot ? String(snapshot.day).padStart(2, "0") : "--"}
            </strong>
            <span className="rm-clock-divider" />
            <div>
              <span>DEMO DAY</span>
              <strong>
                {snapshot ? `D${snapshot.deadlineDay}` : "Not reported"}
              </strong>
            </div>
          </div>
        </section>
        <div className="rm-truth-line">
          <span>
            <i className={status === "running" ? "running" : ""} />
            {live
              ? (connection.message ??
                `Runtime ${connection.status}. No fixture fallback.`)
              : `Scripted simulation · synthetic team · no AI calls. ${manualClock ? "Manual clock for QA." : "1 day = 2 seconds."}`}
          </span>
          <span>
            {snapshot
              ? `Week ${Math.max(1, Math.ceil(snapshot.day / 5))} / 12 · Seed ${snapshot.seed} · ${phaseLabels[snapshot.phase]}`
              : "Start is always explicit"}
          </span>
        </div>
        {(error || notice) && (
          <div
            className={`rm-notice ${error ? "error" : ""}`}
            role={error ? "alert" : "status"}
          >
            <Icon name="info" />
            <span>{error || notice}</span>
            <button
              className="rm-icon-button"
              aria-label="Dismiss notice"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        {snapshot ? (
          <>
            <Outcome
              snapshot={snapshot}
              onMemory={() => setOverlay("memory")}
            />
            <SprintPath
              snapshot={snapshot}
              selected={sprint}
              current={current}
              onSelect={setInspectedSprint}
            />
            <div className="rm-mobile-sprint">
              <span className="rm-kicker">CURRENT SPRINT</span>
              <strong>{String(current).padStart(2, "0")} / 06</strong>
              {sprint !== current && (
                <button
                  onClick={() => setInspectedSprint(null)}
                  className="rm-text-button"
                >
                  Follow current
                  <Icon name="arrow" />
                </button>
              )}
            </div>
            <StudioExperience snapshot={snapshot} sprint={sprint} changes={changes}
              onPerson={(id) => setDrawer({ kind: 'person', id })}
              onTask={(id) => setDrawer({ kind: 'task', id })}
              onDecision={(id) => setDrawer({ kind: 'decision', id })}
              onMemory={() => setOverlay('memory')} />
            <section
              className="rm-metrics-strip"
              aria-label="Reported run metrics"
            >
              <span>
                <Icon name="check" />
                <strong>
                  {snapshot.metrics.completedTasks}
                  <small>/{snapshot.metrics.totalTasks}</small>
                </strong>{" "}
                tasks complete
              </span>
              <span>
                <Icon name="shield" />
                <strong>{snapshot.metrics.protectedFacts}</strong> protected
                facts
              </span>
              <span>
                <Icon name="change" />
                <strong>{snapshot.metrics.conflictsDetected}</strong> conflicts
              </span>
              <span>
                <Icon name="reset" />
                <strong>{snapshot.metrics.restores}</strong> restores
              </span>
              {snapshot.metrics.contextTokens !== null && (
                <span className="rm-token-metric">
                  <strong>
                    {snapshot.metrics.contextTokens.toLocaleString()}
                  </strong>{" "}
                  context tokens
                </span>
              )}
              <button
                className="rm-text-button"
                onClick={() => setOverlay("memory")}
              >
                Follow the evidence
                <Icon name="arrow" />
              </button>
            </section>
          </>
        ) : (
          <section
            className="rm-no-snapshot"
            aria-label="Live workspace awaiting snapshot"
          >
            <div className="rm-empty-board-art" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span className="rm-kicker">
              {connection.status === "blocked"
                ? "RUNTIME BLOCKED"
                : "LIVE / NOT CONNECTED"}
            </span>
            <h2>
              {connection.status === "blocked"
                ? "No connection. No pretend team."
                : "Your quarter starts with a real response."}
            </h2>
            <p>
              {connection.message ??
                "Start explicitly to request a run from the invited runtime. The team, plan, and outcomes will appear only after an authoritative snapshot arrives."}
            </p>
            <small>
              No automatic provider call. No fallback to synthetic fixture
              results.
            </small>
            {live && (
              <a href="/login?returnTo=/demo/remaster/app" className="rm-text-button">
                Invited account sign-in
                <Icon name="arrow" />
              </a>
            )}
          </section>
        )}
      </main>
      <footer className="rm-controls">
        <div className="rm-control-options">
          {live ? (
            <div className="rm-live-guard">
              <Icon name="shield" />
              <span>
                {snapshot?.executionMode === "live"
                  ? "Live AI execution · simulated team"
                  : "Live / not connected"}
                <small>
                  Deliberate faults off. No run starts automatically.
                </small>
              </span>
            </div>
          ) : (
            <label className="rm-stress-control">
              <input
                type="checkbox"
                aria-label="Memory stress test · deliberate fault"
                checked={
                  status === "idle"
                    ? stressTest
                    : (snapshot?.stressTest ?? stressTest)
                }
                disabled={status !== "idle" || Boolean(pending)}
                onChange={(event) => setStressTest(event.target.checked)}
              />
              <span>
                Memory stress test{" "}
                <span className="rm-deliberate">· deliberate fault</span>
                <small>
                  {status === "idle"
                    ? "Scripted fault & recovery. Uncheck for the clean run."
                    : snapshot?.stressTest
                      ? "Scripted fault enabled for this run."
                      : "Clean run. No deliberate corruption."}
                </small>
              </span>
            </label>
          )}
        </div>
        <div className={`rm-control-buttons ${live ? 'studio-live-controls' : ''}`}>
          <button
            className="rm-icon-button rm-restart"
            type="button"
            aria-label="Restart quarter"
            title={
              live && status === "running"
                ? "Pause the live run before resetting the view"
                : "Reset to day zero; does not start a run"
            }
            disabled={
              Boolean(pending) ||
              (live && (status === "running" || startLocked))
            }
            onClick={() => setOverlay("restart")}
          >
            <Icon name="reset" />
          </button>
          {!live && (
            <button
              className="rm-step-button"
              onClick={nextDay}
              disabled={status !== "running" || Boolean(pending)}
              title="Advance the fixture by one simulated day"
            >
              +1 day
            </button>
          )}
          <button
            className="rm-button rm-memory-button"
            data-testid="memory-xray"
            onClick={() => setOverlay("memory")}
            disabled={!snapshot}
          >
            <Icon name="memory" />
            <span>Memory X-ray</span>
          </button>
          <button
            className="rm-button rm-secondary rm-change-button"
            onClick={() => setOverlay("change")}
            disabled={!active || Boolean(pending)}
          >
            <Icon name="change" />
            <span>Introduce a change</span>
          </button>
          <button
            className="rm-button rm-primary"
            id="start-btn"
            onClick={() => void primaryAction()}
            disabled={Boolean(pending) || finished || startLocked}
          >
            <Icon name={status === "running" ? "pause" : "play"} />
            <span>{startLocked ? "Start unconfirmed" : primaryLabel}</span>
          </button>
        </div>
      </footer>
      {snapshot && overlay === "change" && (
        <ChangeSheet
          snapshot={snapshot}
          pending={pending === "change"}
          error={error}
          onInject={(preset) => void inject(preset)}
          onClose={() => setOverlay(null)}
        />
      )}
      {snapshot && overlay === "memory" && (
        <MemoryXray snapshot={snapshot} onClose={() => setOverlay(null)} />
      )}
      {snapshot && drawer && (
        <DetailDrawer
          target={drawer}
          snapshot={snapshot}
          changes={changes}
          onClose={() => setDrawer(null)}
          onSelect={setDrawer}
        />
      )}
      {overlay === "restart" && (
        <Overlay
          title={live ? "Reset this view?" : "A fresh quarter?"}
          kicker="RESET / NO AUTOMATIC START"
          onClose={() => setOverlay(null)}
          variant="sheet"
        >
          <p className="rm-overlay-intro">
            {live
              ? "This disconnects the current view. It does not delete or cancel a server run. A new live run is requested only when you explicitly press Start again."
              : "Return to day zero, seed 42. The local quarter and introduced changes will be reset. Press Start when you are ready."}
          </p>
          <div className="rm-reset-actions">
            <button
              className="rm-button rm-secondary"
              onClick={() => setOverlay(null)}
            >
              Keep this quarter
            </button>
            <button className="rm-button rm-primary" onClick={reset}>
              Reset without starting
              <Icon name="reset" />
            </button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

export class GameBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="rm-crash">
          <Icon name="info" />
          <h1>The board could not be displayed.</h1>
          <p>
            No run is restarted automatically. Reload to reconnect, or return to
            the public fixture.
          </p>
          <button
            className="rm-button rm-primary"
            onClick={() => window.location.reload()}
          >
            Reload view
          </button>
          <a href="/">Public fixture</a>
        </main>
      );
    return this.props.children;
  }
}
