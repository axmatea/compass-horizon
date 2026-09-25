import { Component, startTransition, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { api, ApiError, errorMessage } from "./api";
import { workspaceReturn } from "./login-return";
import {
  addDemoExperiment,
  addDemoLead,
  createDemo,
  delayedAnswer,
  receiveDemoAnswer,
  updateDemoProject,
} from "./demo";
import {
  AnswerForm,
  AuthForm,
  EarlyAccessForm,
  ExperimentForm,
  LeadForm,
  ProjectForm,
} from "./forms";
import {
  Experiments,
  Memory,
  Mission,
  Pipeline,
  RunsPanel,
  ServicePanel,
} from "./screens";
import type {
  AnswerInput,
  AnswerOutcome,
  Experiment,
  Lead,
  LeadInput,
  Notice,
  ProjectInput,
  ServiceStatus,
  Session,
  State,
  Tab,
} from "./types";
import { Icon, Modal } from "./ui";
import type { IconName } from "./ui";

const tabs: { id: Tab; label: string; icon: IconName; number: string }[] = [
  { id: "mission", label: "Mission", icon: "mission", number: "01" },
  {
    id: "experiments",
    label: "Experiments",
    icon: "experiments",
    number: "02",
  },
  { id: "pipeline", label: "Pipeline", icon: "pipeline", number: "03" },
  { id: "memory", label: "Memory", icon: "memory", number: "04" },
];
const tourSteps: { tab: Tab; title: string; body: string; next: string }[] = [
  {
    tab: "mission",
    title: "Sell the workflow. Learn who fits.",
    body: "AI Media Global sells AI workflow implementation. This scenario, its leads, and its research are synthetic. Follow a late reply from intake to a changed decision.",
    next: "Explore experiments",
  },
  {
    tab: "experiments",
    title: "Two ideas. No invented winner.",
    body: "Each creative has an audience and a hypothesis. These are synthetic concepts, not running ads. There is no spend.",
    next: "Meet the pipeline",
  },
  {
    tab: "pipeline",
    title: "Mira is missing one answer.",
    body: "The budget is unknown, not zero. COMPASS keeps her in Needs context and suggests one specific question.",
    next: "Jump 2 days: receive answer",
  },
  {
    tab: "pipeline",
    title: "The late answer changes the picture.",
    body: "Accelerated time: two days passed in one click. Mira replied with a synthetic $6,500 budget. She now meets the $5,000 minimum.",
    next: "Replay the same event",
  },
  {
    tab: "pipeline",
    title: "Same event. Not another lead.",
    body: "The exact source and event ID were replayed. The duplicate was ignored: one answer, one lead, unchanged counts.",
    next: "Change the business rules",
  },
  {
    tab: "memory",
    title: "A new rule. The same memory.",
    body: "We raised the minimum to $8,000. Mira no longer fits, Jonah still does, and the evidence remains in the timeline.",
    next: "Check the evidence",
  },
  {
    tab: "experiments",
    title: "Honesty is part of the product.",
    body: "Four synthetic leads are still a small sample. No winning campaign is declared. Keep exploring, add a lead, or change the brief yourself.",
    next: "Finish & explore",
  },
];
const legacyHashes = new Set([
  "#tour",
  "#film",
  "#say",
  "#intel",
  "#try",
  "#top",
  "#demo",
  "#how-it-works",
  "#presentation",
]);
const isLivePath = /^\/(?:acquisition\/app|login)(?:\/|$)/.test(window.location.pathname);
type Dialog =
  | "settings"
  | "experiment"
  | "lead"
  | "access"
  | "status"
  | "runs"
  | null;
function tabFromHash(): Tab {
  const candidate = window.location.hash.slice(1);
  return tabs.some((tab) => tab.id === candidate)
    ? (candidate as Tab)
    : "mission";
}
function tourState(step: number): State {
  let state = createDemo();
  if (step >= 3) state = receiveDemoAnswer(state, delayedAnswer).state;
  if (step >= 4) state = receiveDemoAnswer(state, delayedAnswer).state;
  if (step >= 5 && state.project)
    state = updateDemoProject(state, {
      ...state.project,
      rules: { ...state.project.rules, minBudget: 8000 },
    });
  return state;
}
function assertState(state: State): State {
  if (
    !state ||
    !["LIVE", "DEMO"].includes(state.mode) ||
    !Array.isArray(state.leads) ||
    !Array.isArray(state.experiments) ||
    !state.metrics ||
    !Array.isArray(state.events) ||
    !Array.isArray(state.decisions) ||
    !Array.isArray(state.runs)
  )
    throw new Error(
      "The server returned an incomplete workspace. Please refresh; no demo data has been substituted.",
    );
  if (isLivePath && state.mode !== "LIVE")
    throw new Error(
      "The invited workspace did not return LIVE state. Synthetic data is not shown here.",
    );
  return state;
}

export default function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [demoState, setDemoState] = useState(createDemo);
  const [liveState, setLiveState] = useState<State | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isLivePath);
  const [workspaceError, setWorkspaceError] = useState("");
  const [streamStatus, setStreamStatus] = useState("Connecting");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [answerLead, setAnswerLead] = useState<Lead | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>("mira");
  const [experimentFilter, setExperimentFilter] = useState("");
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);
  const [tour, setTour] = useState<number | null>(
    !isLivePath &&
      (legacyHashes.has(window.location.hash) ||
        new URLSearchParams(window.location.search).get("tour") === "1")
      ? 0
      : null,
  );
  const [signingOut, setSigningOut] = useState(false);
  const state = isLivePath ? liveState : demoState;

  async function loadStatus() {
    setStatusLoading(true);
    setStatusError("");
    try {
      setStatus(await api<ServiceStatus>("/api/acquisition/status"));
    } catch (error) {
      setStatus(null);
      setStatusError(errorMessage(error));
    } finally {
      setStatusLoading(false);
    }
  }
  async function loadWorkspace(signal?: AbortSignal) {
    setLoading(true);
    setWorkspaceError("");
    try {
      const account = await api<Session | null>(
        "/api/auth/get-session",
        undefined,
        signal,
      );
      setSession(account?.user ? account : null);
      const destination = workspaceReturn();
      if (account?.user && destination) {
        window.location.assign(destination);
        return;
      }
      if (account?.user)
        setLiveState(
          assertState(
            await api<State>("/api/acquisition/state", undefined, signal),
          ),
        );
      else setLiveState(null);
    } catch (error) {
      if (signal?.aborted) return;
      setWorkspaceError(errorMessage(error));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    void loadStatus();
  }, []);
  useEffect(() => {
    if (!isLivePath) return;
    const controller = new AbortController();
    void loadWorkspace(controller.signal);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!isLivePath || !session) return;
    const stream = new EventSource("/api/acquisition/events", {
      withCredentials: true,
    });
    let disposed = false;
    stream.onopen = () => setStreamStatus("Connected");
    stream.addEventListener("state", (event) => {
      try {
        const next = assertState(JSON.parse((event as MessageEvent).data));
        startTransition(() => setLiveState(next));
        setStreamStatus("Connected");
      } catch {
        setStreamStatus("Invalid update: refresh workspace");
      }
    });
    stream.onerror = () => {
      setStreamStatus("Disconnected · reconnecting");
      // SSE does not expose HTTP status, so recheck auth before retaining a stale private view.
      void api<Session | null>("/api/auth/get-session")
        .then((account) => {
          if (!disposed && !account?.user) {
            setSession(null);
            setLiveState(null);
            setNotice({
              tone: "info",
              message: "Your session ended. Sign in again to continue.",
            });
          }
        })
        .catch(() => {
          /* The visible disconnected state remains until recovery. */
        });
    };
    return () => {
      disposed = true;
      stream.close();
    };
  }, [session]);
  useEffect(() => {
    function onHashChange() {
      if (window.location.hash === "#workspace") return;
      if (!isLivePath && legacyHashes.has(window.location.hash)) {
        setTour(0);
        setDemoState(createDemo());
        setTab("mission");
      } else setTab(tabFromHash());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  useEffect(() => {
    if (tour === null) return;
    const frame = requestAnimationFrame(() => {
      const target =
        tour >= 2 && tour <= 4
          ? document.querySelector(".lead-detail")
          : document.querySelector(".page-heading");
      target?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [tour]);
  function navigate(next: Tab) {
    startTransition(() => setTab(next));
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${next}`,
    );
  }
  function selectLead(id: string) {
    setSelectedId(id);
    setExperimentFilter("");
    navigate("pipeline");
  }
  function startTour() {
    setDemoState(createDemo());
    setTour(0);
    setNotice(null);
    setSelectedId("mira");
    setExperimentFilter("");
    navigate("mission");
  }
  function advanceTour(step: number) {
    if (step >= tourSteps.length) {
      setTour(null);
      setNotice({
        tone: "success",
        message:
          "Tour complete. This workspace is yours to explore. All demo changes remain local.",
      });
      return;
    }
    setDemoState(tourState(step));
    setTour(step);
    setSelectedId("mira");
    setExperimentFilter("");
    navigate(tourSteps[step].tab);
    setNotice(
      step === 4
        ? {
            tone: "success",
            message:
              "Duplicate ignored: demo.form / mira-budget-reply. Still 4 leads and 2 unique events.",
          }
        : step === 3
          ? {
              tone: "info",
              message:
                "Synthetic time jump: +2 days. Mira replied with a $6,500 budget and is now Qualified.",
            }
          : null,
    );
  }
  function simulateAnswer(replay = false) {
    const result = receiveDemoAnswer(demoState, delayedAnswer);
    setDemoState(result.state);
    selectLead("mira");
    setNotice({
      tone: result.duplicate ? "success" : "info",
      message: result.duplicate
        ? `Duplicate ignored. ${result.state.leads.length} leads, ${result.state.events.length} unique events. No extra lead or signal was created.`
        : "Synthetic time jump: +2 days. Mira answered with a $6,500 budget. Qualification has been re-evaluated.",
    });
    if (replay && !result.duplicate)
      setNotice({
        tone: "info",
        message:
          "The first synthetic answer was received. Replay it again to see deduplication.",
      });
  }
  function raiseBudget() {
    if (!demoState.project) return;
    setDemoState(
      updateDemoProject(demoState, {
        ...demoState.project,
        rules: { ...demoState.project.rules, minBudget: 8000 },
      }),
    );
    navigate("memory");
    setNotice({
      tone: "success",
      message:
        "Demo memory updated to an $8,000 minimum. Existing leads were re-evaluated; the evidence remains.",
    });
  }
  async function mutate(path: string, input: unknown): Promise<AnswerOutcome> {
    let result: { state?: State } & AnswerOutcome;
    try {
      result = await api(path, input);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession(null);
        setLiveState(null);
      }
      throw error;
    }
    try {
      setLiveState(
        assertState(
          result?.state ?? (await api<State>("/api/acquisition/state")),
        ),
      );
    } catch (error) {
      const message = `The server accepted the action, but refreshing failed. Refresh before repeating it. ${errorMessage(error)}`;
      setNotice({ tone: "error", message });
      throw new Error(message);
    }
    return result ?? {};
  }
  async function saveProject(input: ProjectInput) {
    if (isLivePath) await mutate("/api/acquisition/projects", input);
    else setDemoState(updateDemoProject(demoState, input));
    setDialog(null);
  }
  async function saveExperiment(input: Omit<Experiment, "id">) {
    if (isLivePath) await mutate("/api/acquisition/experiments", input);
    else setDemoState(addDemoExperiment(demoState, input));
    setDialog(null);
    navigate("experiments");
  }
  async function saveLead(input: LeadInput) {
    if (isLivePath) await mutate("/api/acquisition/leads", input);
    else {
      const next = addDemoLead(demoState, input);
      setDemoState(next);
      setSelectedId(next.leads.at(-1)!.id);
    }
    setDialog(null);
    navigate("pipeline");
  }
  async function saveAnswer(input: AnswerInput): Promise<AnswerOutcome> {
    const result = isLivePath
      ? await mutate("/api/acquisition/events", input)
      : receiveDemoAnswer(demoState, input);
    if (!isLivePath && "state" in result) setDemoState(result.state as State);
    if (result.duplicate)
      setNotice({
        tone: "info",
        message:
          "Duplicate event ignored. Current facts were not changed again.",
      });
    else if (result.changed?.length === 0)
      setNotice({
        tone: "info",
        message:
          "Evidence recorded, but no current facts changed. Newer or identical evidence was retained. Inspect the lead before another update.",
      });
    else if (isLivePath)
      setNotice({
        tone: "success",
        message: `${result.changed?.length ?? "Selected"} field(s) changed by the server. Qualification re-evaluated using current rules.`,
      });
    setAnswerLead(null);
    return result;
  }
  async function signOut() {
    setSigningOut(true);
    try {
      await api("/api/auth/sign-out", {});
      setSession(null);
      setLiveState(null);
      setDialog(null);
    } catch (error) {
      setNotice({ tone: "error", message: errorMessage(error) });
    } finally {
      setSigningOut(false);
    }
  }
  const requestProjectDialog = (next: Dialog) => {
    if (isLivePath && !state?.project) setDialog("settings");
    else setDialog(next);
  };

  return (
    <div className={`app-shell ${tour !== null ? "tour-active" : ""}`}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="COMPASS home">
          <Icon name="compass" />
          <span>
            compass<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-monogram">
            {(state?.project?.name ?? "Your workspace").slice(0, 1)}
          </span>
          <div>
            <strong>{state?.project?.name ?? "Your workspace"}</strong>
            <span>{isLivePath ? "Private workspace" : "Demo workspace"}</span>
          </div>
        </div>
        <p className="nav-eyebrow">YOUR ACQUISITION OS</p>
        <nav className="desktop-nav" aria-label="Workspace">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              <small>{item.number}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {!isLivePath && (
            <div className="tour-invite">
              <span className="tour-diagram" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <h3>
                Less noise.
                <br />
                More direction.
              </h3>
              <p>See one conversation change the whole picture.</p>
              <button className="text-button" onClick={startTour}>
                Take the guided tour
                <Icon name="arrow" />
              </button>
            </div>
          )}
          <button
            className="sidebar-utility"
            onClick={() => setDialog("status")}
          >
            <span
              className={`service-dot ${status?.database === "ready" ? "ready" : ""}`}
            />
            <span>System status</span>
            <Icon name="arrow" />
          </button>
          {isLivePath && session && (
            <button
              className="sidebar-utility"
              onClick={() => setDialog("settings")}
            >
              <Icon name="settings" />
              <span>Profile & settings</span>
            </button>
          )}
          <span className="sidebar-footnote">A little more intentional.</span>
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <a className="brand mobile-brand" href="/" aria-label="COMPASS home">
            <Icon name="compass" />
            <span>compass.</span>
          </a>
          <div className="breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <strong>{tabs.find((item) => item.id === tab)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <span
              className={`mode-badge ${isLivePath && session ? "live" : ""}`}
            >
              <span className="status-dot" />
              {isLivePath
                ? session
                  ? "LIVE WORKSPACE"
                  : "INVITED ACCESS"
                : "INTERACTIVE DEMO"}
            </span>
            {isLivePath ? (
              session && (
                <button
                  className="icon-button"
                  aria-label="Sign out"
                  disabled={signingOut}
                  onClick={() => void signOut()}
                >
                  <Icon name="logout" />
                </button>
              )
            ) : (
              <>
                <a className="text-button signin-link" href="/acquisition/app">
                  Sign in
                </a>
                <button
                  className="button small primary access-button"
                  onClick={() => setDialog("access")}
                >
                  Get early access
                  <Icon name="arrow" />
                </button>
              </>
            )}
          </div>
        </header>
        <div className="mode-strip">
          <span>
            {isLivePath
              ? session
                ? `Session-bound data · ${streamStatus}`
                : "Invitation-only · private workspace"
              : "Demo data. Real possibilities. Nothing sent, bought, or published."}
          </span>
          {!isLivePath ? (
            <button className="text-button" onClick={startTour}>
              <Icon name="play" />
              Guided tour
            </button>
          ) : (
            session && (
              <button
                className="text-button"
                onClick={() => void loadWorkspace()}
              >
                Refresh
                <Icon name="refresh" />
              </button>
            )
          )}
        </div>
        {notice && (
          <div
            className={`notice ${notice.tone}`}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            <Icon name={notice.tone === "error" ? "info" : "check"} />
            <span>{notice.message}</span>
            <button
              className="icon-button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss message"
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        <main className="workspace-content" id="workspace" tabIndex={-1}>
          {isLivePath && loading ? (
            <div className="loading-state" role="status">
              <span className="spinner" />
              <h2>Opening your workspace...</h2>
              <p>
                Reading your session and saved state. No demo data will be
                substituted.
              </p>
            </div>
          ) : isLivePath && workspaceError ? (
            <div className="load-error">
              <Icon name="info" />
              <h1>Your workspace could not be loaded.</h1>
              <p role="alert">{workspaceError}</p>
              <button
                className="button primary"
                onClick={() => void loadWorkspace()}
              >
                Try again
                <Icon name="refresh" />
              </button>
              <a className="text-button" href="/">
                Explore the offline demo instead
              </a>
            </div>
          ) : isLivePath && !session ? (
            <AuthForm
              onAuthenticated={() => {
                const destination = workspaceReturn();
                if (destination) {
                  window.location.assign(destination);
                  return Promise.resolve();
                }
                return loadWorkspace();
              }}
              onEarlyAccess={() => setDialog("access")}
            />
          ) : (
            state && (
              <div className="screen-enter" key={tab}>
                {tab === "mission" && (
                  <Mission
                    state={state}
                    onNavigate={navigate}
                    onSettings={() => setDialog("settings")}
                    onDelayed={() => simulateAnswer()}
                    onSelectLead={selectLead}
                    onExperiment={() => requestProjectDialog("experiment")}
                  />
                )}
                {tab === "experiments" && (
                  <Experiments
                    state={state}
                    onCreate={() => requestProjectDialog("experiment")}
                    onPipeline={(id) => {
                      setExperimentFilter(id);
                      navigate("pipeline");
                    }}
                  />
                )}
                {tab === "pipeline" && (
                  <Pipeline
                    state={state}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    experimentFilter={experimentFilter}
                    onExperimentFilter={setExperimentFilter}
                    onCreate={() => requestProjectDialog("lead")}
                    onAnswer={setAnswerLead}
                    onDelayed={() => simulateAnswer()}
                    onReplay={() => simulateAnswer(true)}
                  />
                )}
                {tab === "memory" && (
                  <Memory
                    state={state}
                    onSettings={() => setDialog("settings")}
                    onRaiseBudget={raiseBudget}
                  />
                )}
              </div>
            )
          )}
          <footer className="workspace-footer">
            <span>Built for the next useful move.</span>
            <div>
              <button
                className="text-button"
                onClick={() => setDialog("status")}
              >
                Integrations & status
              </button>
              {isLivePath && session && (
                <button
                  className="text-button"
                  onClick={() => requestProjectDialog("runs")}
                >
                  Provider operations
                </button>
              )}
              <span className="voice-status">
                <Icon name="mic" />
                Voice not connected · text works
              </span>
            </div>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile workspace">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      {tour !== null && !isLivePath && (
        <section className="tour-coach" aria-label="Guided demo tour">
          <div
            className="tour-progress"
            aria-label={`Step ${tour + 1} of ${tourSteps.length}`}
          >
            {tourSteps.map((_, index) => (
              <span key={index} className={index <= tour ? "complete" : ""} />
            ))}
          </div>
          <div className="tour-copy" aria-live="polite">
            <p className="eyebrow">
              GUIDED TOUR {tour + 1}/{tourSteps.length} · SYNTHETIC DATA ·
              ACCELERATED TIME
            </p>
            <h2>{tourSteps[tour].title}</h2>
            <p>{tourSteps[tour].body}</p>
          </div>
          <div className="tour-controls">
            <button className="text-button" onClick={() => setTour(null)}>
              Exit tour
            </button>
            <div>
              {tour > 0 && (
                <button
                  className="button secondary"
                  onClick={() => advanceTour(tour - 1)}
                >
                  Back
                </button>
              )}
              <button
                className="button primary"
                onClick={() => advanceTour(tour + 1)}
              >
                {tourSteps[tour].next}
                <Icon name="arrow" />
              </button>
            </div>
          </div>
        </section>
      )}
      {dialog === "access" && (
        <Modal
          title="Be part of what comes next."
          eyebrow="EARLY ACCESS"
          onClose={() => setDialog(null)}
        >
          <EarlyAccessForm />
        </Modal>
      )}
      {dialog === "status" && (
        <Modal
          title="Connected, or not. Clearly."
          eyebrow="SYSTEM STATUS"
          onClose={() => setDialog(null)}
        >
          <ServicePanel
            status={status}
            error={statusError}
            loading={statusLoading}
            onRefresh={() => void loadStatus()}
          />
        </Modal>
      )}
      {dialog === "settings" && state && (
        <Modal
          title="The shape of your business."
          eyebrow="PROFILE & BUSINESS MEMORY"
          onClose={() => setDialog(null)}
        >
          <ProjectForm state={state} session={session} onSave={saveProject} />
        </Modal>
      )}
      {dialog === "experiment" && (
        <Modal
          title="What is worth testing?"
          eyebrow="NEW EXPERIMENT"
          onClose={() => setDialog(null)}
        >
          <ExperimentForm onSave={saveExperiment} />
        </Modal>
      )}
      {dialog === "lead" && state && (
        <Modal
          title="A new conversation."
          eyebrow="MANUAL LEAD"
          onClose={() => setDialog(null)}
        >
          <LeadForm state={state} onSave={saveLead} />
        </Modal>
      )}
      {dialog === "runs" && state && isLivePath && (
        <Modal
          title="Real work. Visible checkpoints."
          eyebrow="PROVIDER OPERATIONS"
          onClose={() => setDialog(null)}
        >
          <RunsPanel
            state={state}
            onRun={async (input) => {
              await mutate("/api/acquisition/runs", input);
            }}
            onResume={async (id) => {
              await mutate(
                `/api/acquisition/runs/${encodeURIComponent(id)}/resume`,
                {},
              );
            }}
            onAccept={saveAnswer}
          />
        </Modal>
      )}
      {answerLead && (
        <Modal
          title={`New context for ${answerLead.name.split(" ")[0]}.`}
          eyebrow="QUALIFICATION UPDATE"
          onClose={() => setAnswerLead(null)}
        >
          <AnswerForm
            lead={answerLead}
            onSave={async (input) => {
              await saveAnswer(input);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

export class AppBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Acquisition UI error", error.message, info.componentStack);
  }
  render() {
    if (this.state.failed)
      return (
        <main className="load-error">
          <h1>The workspace hit a snag.</h1>
          <p>Reload to reconnect. No action is automatically retried.</p>
          <button
            className="button primary"
            onClick={() => window.location.reload()}
          >
            Reload workspace
          </button>
        </main>
      );
    return this.props.children;
  }
}
