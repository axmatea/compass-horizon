"use client";

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { WorldView } from "@/contract";
import { api, ApiError, errorMessage, IS_MOCK, isWorkerDeath } from "@/lib/client/api";
import { BeliefCard, LessonCards } from "./BeliefCard";
import { CampaignCards } from "./CampaignCards";
import { StageBar, Toasts, TopBar, TravelBanner, WakeStrip, type Toast } from "./Chrome";
import { Horizon } from "./Horizon";
import { LeadDrawer, LeadsPanel } from "./LeadsPanel";
import { CommitmentsPanel, ReceiptsPanel, RunsPanel, StatsRow } from "./OpsPanels";
import { TruthCurves } from "./TruthCurves";

type Busy = null | "load" | "beat" | "chaos" | "wake" | "replay" | "reset";

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="dm-fatal" role="alert">
          <p className="lv-eyebrow">Display error</p>
          <h1>This view could not render.</h1>
          <p>The ledger is untouched. Reload the page to re-project it.</p>
          <code>{this.state.error.message}</code>
          <button type="button" className="lv-btn lv-btn--primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

function isInteractiveTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "button" || tag === "a" || el.getAttribute("role") === "slider";
}

function DemoInner() {
  const [world, setWorld] = useState<WorldView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>("load");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [handleDay, setHandleDay] = useState<number | null>(null);
  const [travelPending, setTravelPending] = useState(false);
  const chaosArmed = useRef(false);
  const lastOpener = useRef<HTMLElement | null>(null);
  const travelSeq = useRef(0);
  const travelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastSeq = useRef(0);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastSeq.current;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.tone === "bad" ? 7000 : 4500);
  }, []);

  const apply = useCallback((w: WorldView) => {
    setWorld(w);
    setHandleDay(null);
    setLoadError(null);
  }, []);

  const load = useCallback(
    async (opts: { stage?: string | null; asOf?: number | null } = {}) => {
      setBusy("load");
      try {
        const w = await api.state(opts);
        apply(w);
      } catch (e) {
        setLoadError(errorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [apply],
  );

  // First load: honour ?stage=KEY once (then strip it from the address bar), and mock QA params.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      if (IS_MOCK) {
        const m = await import("@/lib/client/mock");
        m.mockApi.applyQuery(params);
      }
      const stage = params.get("stage");
      const asOfRaw = params.get("asOf");
      const asOf = asOfRaw !== null && asOfRaw !== "" && Number.isFinite(Number(asOfRaw)) ? Number(asOfRaw) : null;
      if (stage) {
        params.delete("stage");
        const qs = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      }
      if (!cancelled) await load({ stage, asOf });
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refetchAfterDeath = useCallback(async () => {
    toast({ tone: "bad", title: "Worker died mid-run.", body: "Ledger intact. Resume." });
    try {
      const w = await api.state();
      apply(w);
    } catch (e) {
      toast({ tone: "bad", title: "Could not reload the ledger", body: errorMessage(e) });
    }
  }, [apply, toast]);

  const handleActionError = useCallback(
    async (e: unknown, what: string) => {
      if (isWorkerDeath(e, chaosArmed.current)) {
        await refetchAfterDeath();
        return;
      }
      if (e instanceof ApiError && e.interrupted) {
        await refetchAfterDeath();
        return;
      }
      toast({ tone: "bad", title: `${what} failed`, body: errorMessage(e) });
    },
    [refetchAfterDeath, toast],
  );

  const doBeat = useCallback(async () => {
    try {
      const r = await api.beat();
      apply(r.world);
      if (r.run?.state === "INTERRUPTED") toast({ tone: "bad", title: "Worker died mid-run.", body: "Ledger intact. Resume." });
    } catch (e) {
      await handleActionError(e, "Next beat");
    } finally {
      chaosArmed.current = false;
    }
  }, [apply, handleActionError, toast]);

  const latestRun = world?.runs?.[0];
  const canResume = latestRun?.state === "INTERRUPTED";
  const stage = world?.stage ?? null;
  const canNext = !!world && !!stage?.nextLabel && !canResume && !world.isTimeTravel;
  const canPlug = !!world && !!stage && stage.nextLabel !== null && stage.beat >= 4 && !canResume && !world.isTimeTravel;

  const next = useCallback(async () => {
    if (busy || !canNext) return;
    setBusy("beat");
    await doBeat();
    setBusy(null);
  }, [busy, canNext, doBeat]);

  const plug = useCallback(async () => {
    if (busy || !canPlug) return;
    setBusy("chaos");
    try {
      await api.chaos(3);
      chaosArmed.current = true;
      toast({ tone: "gold", title: "Chaos armed", body: "The next run will be killed after step 3." });
    } catch (e) {
      toast({ tone: "bad", title: "Could not arm chaos", body: errorMessage(e) });
      setBusy(null);
      return;
    }
    setBusy("beat");
    await doBeat();
    setBusy(null);
  }, [busy, canPlug, doBeat, toast]);

  const resume = useCallback(async () => {
    if (busy) return;
    setBusy("wake");
    try {
      const r = await api.wake();
      apply(r.world);
      const run = r.run ?? r.world.runs?.[0];
      const skipped = run?.effects?.filter((e) => e.state === "SKIPPED_DUPLICATE").length ?? 0;
      if (run?.state !== "INTERRUPTED") setToasts((ts) => ts.filter((x) => x.tone !== "bad"));
      if (run?.state === "INTERRUPTED") toast({ tone: "bad", title: "Worker died again.", body: "Ledger intact. Resume." });
      else
        toast({
          tone: "ok",
          title: run?.resumedFromStep !== undefined ? `Run resumed from step ${run.resumedFromStep}` : "Agent woke",
          body: skipped ? `${skipped} effect${skipped === 1 ? "" : "s"} skipped as duplicate${skipped === 1 ? "" : "s"}. Nothing happened twice.` : "Nothing was due twice.",
        });
    } catch (e) {
      await handleActionError(e, "Resume");
    } finally {
      setBusy(null);
    }
  }, [apply, busy, handleActionError, toast]);

  const replay = useCallback(async () => {
    if (busy || !world || world.isTimeTravel) return;
    setBusy("replay");
    try {
      const r = await api.replayWebhook();
      apply(r.world);
      toast({ tone: "gold", title: "Duplicate ignored: same externalId", body: "The ledger did not change. Replaying a webhook is safe." });
    } catch (e) {
      await handleActionError(e, "Replay webhook");
    } finally {
      setBusy(null);
    }
  }, [apply, busy, handleActionError, toast, world]);

  const reset = useCallback(async () => {
    if (busy) return;
    setBusy("reset");
    try {
      const r = await api.reset();
      apply(r.world);
      setLeadId(null);
      toast({ tone: "info", title: "Demo reset to Day 0" });
    } catch (e) {
      await handleActionError(e, "Reset");
    } finally {
      setBusy(null);
    }
  }, [apply, busy, handleActionError, toast]);

  // Time machine: move the handle immediately, fetch the projection shortly after.
  const scrub = useCallback(
    (day: number, final: boolean) => {
      if (!world) return;
      const clock = world.clock.day;
      const d = Math.max(0, Math.min(clock, day));
      setHandleDay(d);
      if (travelTimer.current) clearTimeout(travelTimer.current);
      const seq = ++travelSeq.current;
      const run = async () => {
        setTravelPending(true);
        try {
          const w = await api.state({ asOf: d >= clock ? null : d });
          if (seq === travelSeq.current) {
            setWorld(w);
            setHandleDay(null);
          }
        } catch (e) {
          if (seq === travelSeq.current) {
            setHandleDay(null);
            toast({ tone: "bad", title: "Time machine failed", body: errorMessage(e) });
          }
        } finally {
          if (seq === travelSeq.current) setTravelPending(false);
        }
      };
      travelTimer.current = setTimeout(run, final ? 0 : 140);
    },
    [toast, world],
  );

  const returnToNow = useCallback(() => {
    if (!world) return;
    scrub(world.clock.day, true);
  }, [scrub, world]);

  // Keyboard: ArrowRight / Space next beat, P pull the plug, R replay, End return to now.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (leadId) return;
      const k = e.key;
      if (k === "ArrowRight" || k === " ") {
        if (isInteractiveTarget(e.target) && k === " ") return;
        if ((e.target as HTMLElement)?.getAttribute?.("role") === "slider") return;
        e.preventDefault();
        if (world?.isTimeTravel) return;
        void next();
      } else if (k === "p" || k === "P") {
        e.preventDefault();
        void plug();
      } else if (k === "r" || k === "R") {
        e.preventDefault();
        void replay();
      } else if (k === "End" && world?.isTimeTravel) {
        e.preventDefault();
        returnToNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leadId, next, plug, replay, returnToNow, world?.isTimeTravel]);

  const openLead = useCallback((id: string, el: HTMLElement) => {
    lastOpener.current = el;
    setLeadId(id);
  }, []);
  const closeLead = useCallback(() => {
    setLeadId(null);
    setTimeout(() => lastOpener.current?.focus(), 0);
  }, []);

  if (!world) {
    return (
      <>
        <TopBar world={null} mock={IS_MOCK} />
        <main id="main" className="dm-main dm-main--center">
          {loadError ? (
            <div className="dm-fatal" role="alert">
              <p className="lv-eyebrow">API unreachable</p>
              <h1>Could not load the ledger.</h1>
              <p>{loadError}</p>
              <p className="dm-card-sub">The demo never falls back to invented data. Fix the API and retry.</p>
              <button type="button" className="lv-btn lv-btn--primary" onClick={() => void load()}>
                Retry
              </button>
            </div>
          ) : (
            <div className="dm-loading" role="status">
              <span className="dm-loading-line" aria-hidden="true" />
              <p>Projecting the ledger</p>
            </div>
          )}
        </main>
      </>
    );
  }

  const lead = leadId ? (world.leads ?? []).find((l) => l.id === leadId) ?? null : null;
  const hDay = handleDay ?? world.asOfDay;

  return (
    <>
      <TopBar world={world} mock={IS_MOCK} />
      <TravelBanner world={world} onReturn={returnToNow} busy={travelPending} />
      <main id="main" className={`dm-main${world.isTimeTravel ? " is-travel" : ""}${busy === "beat" ? " is-waking" : ""}`}>
        {loadError && (
          <div className="dm-inline-error" role="alert">
            {loadError}
          </div>
        )}
        <section className="dm-hz-section" aria-label="The Horizon">
          <h1 className="lv-sr-only">Longview demo: the Horizon, beliefs, campaigns and runs</h1>
          <Horizon world={world} handleDay={hDay} pending={travelPending || handleDay !== null} onScrub={scrub} />
        </section>

        <WakeStrip world={world} onResume={resume} busy={!!busy} />

        <div className="dm-hero-grid">
          <div className="dm-col">
            <BeliefCard world={world} />
            <LessonCards lessons={world.lessons ?? []} />
          </div>
          <div className="dm-col">
            <TruthCurves world={world} />
            <CampaignCards world={world} />
          </div>
        </div>

        <div className="dm-grid-2">
          <LeadsPanel world={world} onOpen={openLead} openId={leadId} />
          <CommitmentsPanel world={world} />
        </div>

        <section className="dm-ops" aria-label="Runs and receipts">
          <StatsRow world={world} />
          <div className="dm-grid-2">
            <RunsPanel world={world} />
            <ReceiptsPanel world={world} />
          </div>
        </section>

        <p className="dm-footnote">
          {world.workspace?.label ?? "Demo workspace"}. Synthetic leads and spend, simulated clock. Longview drafts; it never sends email, never buys ads and never
          touches Meta.
        </p>
      </main>
      <StageBar
        world={world}
        busy={busy}
        canPlug={canPlug}
        canResume={!!canResume}
        onNext={next}
        onPlug={plug}
        onResume={resume}
        onReplay={replay}
        onReset={reset}
      />
      <LeadDrawer world={world} lead={lead} onClose={closeLead} />
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
    </>
  );
}

export function DemoApp() {
  return (
    <Boundary>
      <DemoInner />
    </Boundary>
  );
}
