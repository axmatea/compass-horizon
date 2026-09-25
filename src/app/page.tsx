import type { Metadata } from "next";
import Link from "next/link";
import "@/components/landing/landing.css";
import { EarlyAccessForm } from "@/components/landing/EarlyAccessForm";
import { HorizonHero } from "@/components/landing/HorizonHero";
import { MockBadge } from "@/components/landing/MockBadge";
import { PrimitiveIcon, type PrimitiveKey } from "@/components/landing/PrimitiveIcon";
import { SponsorGrid } from "@/components/landing/SponsorGrid";

const TITLE = "Longview: the acquisition agent that waits for the truth";
const DESCRIPTION =
  "Ads are judged on day one. Customers arrive on day thirty. Longview keeps every experiment open until lead quality arrives, remembers what it believed and why, and changes its mind with receipts.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
  },
};

interface Primitive {
  key: PrimitiveKey;
  n: string;
  title: string;
  body: string;
  meta?: string;
  chips?: boolean;
}

const PRIMITIVES: Primitive[] = [
  {
    key: "ledger",
    n: "01",
    title: "Ledger",
    body: "Append-only and bitemporal. Every event keeps two times: occurredAt, when it happened, and learnedAt, when Longview learned it. Replaying a webhook changes nothing.",
    meta: "occurredAt vs learnedAt, idempotent by event id",
  },
  {
    key: "commitments",
    n: "02",
    title: "Commitments",
    body: "The agent schedules its own future work, then wakes up to keep those promises: ask for a missing budget in two days, check an outcome on day 14. When the answer arrives first, the commitment is cancelled.",
    meta: "open, kept, cancelled",
  },
  {
    key: "beliefs",
    n: "03",
    title: "Beliefs",
    body: "Every conclusion is versioned, with a status, a probability, the evidence and a diff against the last version. When it learns it was fooled, it records a lesson and raises its own decision policy version.",
    chips: true,
  },
  {
    key: "runs",
    n: "04",
    title: "Crash-safe runs",
    body: "Every wake-up is a run of checkpointed steps. Pull the plug mid-run and the next wake resumes from the last checkpoint.",
    meta: "checkpointed steps, exactly-once effects",
  },
  {
    key: "time",
    n: "05",
    title: "Time machine",
    body: "Scrub to any day and see the world exactly as the agent knew it then. Every view is rebuilt from the events it had learned by that day.",
    meta: "as of day n: learnedAt ≤ n",
  },
];

const STEPS: { name: string; body: string }[] = [
  { name: "Ingest", body: "Events due by now land in the ledger. Idempotent ids." },
  { name: "Extract", body: "Budget, timeline, decision maker and problem, with quotes." },
  { name: "Qualify", body: "Rules, not guesses: qualified, unresolved or not a fit." },
  { name: "Commitments", body: "Create, keep or cancel promises. Drafts are effects." },
  { name: "Metrics", body: "Cost per qualified lead, as known today." },
  { name: "Decide", body: "The belief gate, lessons and the policy version." },
  { name: "Market", body: "Competitor evidence with sources, when a scan is due." },
];

export default function Home() {
  return (
    <div className="ld-page">
      <header className="ld-header">
        <div className="ld-wrap ld-header-row">
          <Link href="/" className="lv-wordmark" aria-label="Longview home">
            Longview
          </Link>
          <nav className="ld-nav" aria-label="Primary">
            <Link href="/demo" className="ld-nav-link">
              Demo
            </Link>
            <Link href="/deck" className="ld-nav-link">
              Deck
            </Link>
            <a href="#early-access" className="lv-btn ld-nav-cta">
              Early access
            </a>
          </nav>
        </div>
      </header>

      <main id="main" className="ld-main" tabIndex={-1}>
        {/* 1. Hero */}
        <section className="ld-hero" aria-labelledby="ld-hero-title">
          <div className="ld-wrap">
            <p className="lv-eyebrow ld-hero-eyebrow">
              <span className="ld-eyebrow-rule" aria-hidden="true" />
              Long horizon acquisition agent
            </p>
            <h1 id="ld-hero-title" className="ld-h1">
              <span className="ld-h1-line">Ads are judged on day one.</span>{" "}
              <span className="ld-h1-line ld-h1-line--gold">Customers arrive on day thirty.</span>
            </h1>
            <p className="ld-hero-sub">Longview is the acquisition agent that waits for the truth.</p>
            <div className="ld-cta-row">
              <Link href="/demo" className="lv-btn lv-btn--primary ld-cta">
                Watch it change its mind
              </Link>
              <Link href="/deck" className="lv-btn lv-btn--quiet ld-cta">
                See the deck
              </Link>
            </div>
          </div>
          <figure className="ld-wrap ld-wrap--wide ld-hero-figure">
            <HorizonHero />
            <figcaption className="ld-hz-caption">
              <span className="ld-legend">
                <span className="ld-swatch ld-swatch--a" aria-hidden="true" />A &nbsp;Free AI Audit
              </span>
              <span className="ld-legend">
                <span className="ld-swatch ld-swatch--b" aria-hidden="true" />B &nbsp;Close-the-books Autopilot
              </span>
              <span className="ld-legend">
                <span className="ld-swatch ld-swatch--arc" aria-hidden="true" />
                Late event: arc from learned back to occurred
              </span>
              <span className="ld-legend ld-legend--end">Illustration of the demo scenario, synthetic data</span>
            </figcaption>
          </figure>
        </section>

        {/* 2. Insight */}
        <section id="insight" className="ld-section" aria-labelledby="ld-insight-title">
          <div className="ld-wrap">
            <div className="ld-sechead">
              <p className="lv-eyebrow">The insight</p>
              <h2 id="ld-insight-title" className="ld-h2">
                Busy buyers answer late.
              </h2>
              <p className="ld-lede">
                Cheap, fast responders fill the first days of every test, so the early data lies. A dashboard, and a
                naive agent, learns the wrong lesson on day 3. Longview keeps the experiment open until lead quality
                actually arrives.
              </p>
            </div>

            <figure className="ld-compare">
              <figcaption className="ld-compare-cap">
                <span className="lv-pill lv-pill--warn">Demo data</span>
                <span>Demo scenario, synthetic data. Both campaigns spend $150 a day.</span>
              </figcaption>

              <div className="ld-compare-head" aria-hidden="true">
                <span />
                <span className="ld-camp">
                  <span className="ld-camp-key ld-camp-key--a">A</span>
                  <span className="ld-camp-name">Free AI Audit</span>
                </span>
                <span className="ld-camp">
                  <span className="ld-camp-key ld-camp-key--b">B</span>
                  <span className="ld-camp-name">Close-the-books Autopilot</span>
                </span>
                <span />
              </div>

              <ol className="ld-compare-rows">
                <li className="ld-crow">
                  <p className="ld-crow-day">
                    <span className="ld-crow-daynum">Day 3</span>
                    <span className="ld-crow-dayhint">The dashboard read</span>
                  </p>
                  <div className="ld-cell ld-cell--a">
                    <span className="lv-sr-only">A, Free AI Audit:</span>
                    <p className="ld-cell-big">
                      12 <span className="ld-cell-unit">leads</span>
                    </p>
                    <p className="ld-cell-sub">
                      <span className="lv-num">$50</span> cost per lead
                    </p>
                  </div>
                  <div className="ld-cell ld-cell--b">
                    <span className="lv-sr-only">B, Close-the-books Autopilot:</span>
                    <p className="ld-cell-big">
                      3 <span className="ld-cell-unit">leads</span>
                    </p>
                    <p className="ld-cell-sub">
                      <span className="lv-num">$200</span> cost per lead
                    </p>
                  </div>
                  <p className="ld-verdict">
                    Every dashboard crowns A.
                    <span className="ld-verdict-sub">Scaling A today would be the obvious move.</span>
                  </p>
                </li>
                <li className="ld-crow">
                  <p className="ld-crow-day">
                    <span className="ld-crow-daynum">Day 7</span>
                    <span className="ld-crow-dayhint">Around here, it flips</span>
                  </p>
                  <div className="ld-cell ld-cell--a">
                    <span className="lv-sr-only">A, Free AI Audit:</span>
                    <p className="ld-cell-text">Fast replies, mostly no budget, rarely the decision maker.</p>
                  </div>
                  <div className="ld-cell ld-cell--b">
                    <span className="lv-sr-only">B, Close-the-books Autopilot:</span>
                    <p className="ld-cell-text">Partners answer after busy season, with budgets and timelines.</p>
                  </div>
                  <p className="ld-verdict">
                    Cost per qualified lead flips to B.
                    <span className="ld-verdict-sub">The number the dashboard never shows.</span>
                  </p>
                </li>
                <li className="ld-crow">
                  <p className="ld-crow-day">
                    <span className="ld-crow-daynum">Day 21</span>
                    <span className="ld-crow-dayhint">The truth arrives</span>
                  </p>
                  <div className="ld-cell ld-cell--a">
                    <span className="lv-sr-only">A, Free AI Audit:</span>
                    <p className="ld-cell-big ld-cell-big--muted">Ghosted</p>
                    <p className="ld-cell-sub">Its only booked call</p>
                  </div>
                  <div className="ld-cell ld-cell--b">
                    <span className="lv-sr-only">B, Close-the-books Autopilot:</span>
                    <p className="ld-cell-big ld-cell-big--gold">$18,000</p>
                    <p className="ld-cell-sub">Deal closed</p>
                  </div>
                  <p className="ld-verdict">
                    The day 3 winner was the wrong lesson.
                    <span className="ld-verdict-sub">Longview kept the test open long enough to see it.</span>
                  </p>
                </li>
              </ol>
            </figure>
          </div>
        </section>

        {/* 3. Primitives */}
        <section id="primitives" className="ld-section" aria-labelledby="ld-prim-title">
          <div className="ld-wrap">
            <div className="ld-sechead">
              <p className="lv-eyebrow">Under the hood</p>
              <h2 id="ld-prim-title" className="ld-h2">
                Four primitives and a time machine.
              </h2>
              <p className="ld-lede">
                Long horizon work needs memory you can still trust weeks later. These are the parts that let the agent
                wait, remember and change its mind with receipts.
              </p>
            </div>
            <ul className="ld-prim-grid">
              {PRIMITIVES.map((p) => (
                <li key={p.key} className={`ld-prim ld-prim--${p.key}`}>
                  <div className="ld-prim-top">
                    <PrimitiveIcon name={p.key} />
                    <span className="ld-prim-n lv-num">{p.n}</span>
                  </div>
                  <h3 className="ld-h3">{p.title}</h3>
                  <p className="ld-prim-body">{p.body}</p>
                  {p.chips ? (
                    <p className="ld-prim-chips">
                      <span className="lv-pill lv-pill--faint">Insufficient</span>
                      <span className="lv-pill lv-pill--warn">Leaning</span>
                      <span className="lv-pill lv-pill--ok">Supported</span>
                    </p>
                  ) : null}
                  {p.meta ? <p className="ld-prim-meta">{p.meta}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 4. How one wake-up runs */}
        <section id="how" className="ld-section" aria-labelledby="ld-how-title">
          <div className="ld-wrap">
            <div className="ld-sechead">
              <p className="lv-eyebrow">How one wake-up runs</p>
              <h2 id="ld-how-title" className="ld-h2">
                Seven checkpointed steps, every time it wakes.
              </h2>
              <p className="ld-lede">
                Each step is written to the ledger before the next one starts. Effects use deterministic keys, so a
                resumed run never performs an effect twice: exactly-once effects.
              </p>
            </div>

            <ol className="ld-steps">
              {STEPS.map((s, i) => (
                <li key={s.name} className="ld-step">
                  <span className="ld-step-node lv-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="ld-step-text">
                    <h3 className="ld-step-name">
                      <span className="lv-sr-only">Step {i + 1}: </span>
                      {s.name}
                    </h3>
                    <p className="ld-step-body">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <figure className="ld-crash">
              <figcaption className="ld-crash-cap">
                <span className="ld-crash-title">Day 14, the plug is pulled</span>
                <span className="ld-crash-hint">Demo scenario</span>
              </figcaption>
              <div className="ld-crash-row">
                <p className="ld-crash-label">Wake 1</p>
                <ol className="ld-crash-cells" aria-label="Wake 1 steps">
                  {STEPS.map((s, i) => (
                    <li
                      key={s.name}
                      className={`ld-cc ${i < 3 ? "ld-cc--done" : "ld-cc--never"}${i === 3 ? " ld-cc--cut" : ""}`}
                    >
                      <span className="lv-sr-only">
                        Step {i + 1} {s.name}: {i < 3 ? "done" : "not reached"}
                      </span>
                      <span aria-hidden="true">{i + 1}</span>
                    </li>
                  ))}
                </ol>
                <p className="ld-crash-state">
                  <span className="lv-pill lv-pill--bad">
                    <span className="lv-dot" aria-hidden="true" />
                    Interrupted
                  </span>
                  <span className="ld-crash-note">Worker died after step 3</span>
                </p>
              </div>
              <div className="ld-crash-row">
                <p className="ld-crash-label">Wake 2</p>
                <ol className="ld-crash-cells" aria-label="Wake 2 steps">
                  {STEPS.map((s, i) => (
                    <li
                      key={s.name}
                      className={`ld-cc ${i < 3 ? "ld-cc--skip" : "ld-cc--done"}${i === 3 ? " ld-cc--resume" : ""}`}
                    >
                      <span className="lv-sr-only">
                        Step {i + 1} {s.name}: {i < 3 ? "skipped, already done" : "done"}
                      </span>
                      <span aria-hidden="true">{i + 1}</span>
                    </li>
                  ))}
                </ol>
                <p className="ld-crash-state">
                  <span className="lv-pill lv-pill--ok">
                    <span className="lv-dot" aria-hidden="true" />
                    Completed
                  </span>
                  <span className="ld-crash-note">Resumed at step 4</span>
                </p>
              </div>
              <p className="ld-crash-foot">
                Steps 1 to 3 are skipped because they are already in the ledger. Effects that already happened show{" "}
                <code className="ld-code">SKIPPED_DUPLICATE</code> instead of running again.
              </p>
            </figure>
          </div>
        </section>

        {/* 5. Sponsors */}
        <section id="sponsors" className="ld-section" aria-labelledby="ld-sponsors-title">
          <div className="ld-wrap">
            <div className="ld-sechead">
              <p className="lv-eyebrow">Sponsors, with live status</p>
              <h2 id="ld-sponsors-title" className="ld-h2">
                Three sponsors, one job each.
              </h2>
              <p className="ld-lede">
                Nimble finds market evidence, Liquid AI reads every reply, Tinybird answers metrics as of any day. Each
                card shows that adapter&rsquo;s status straight from the health check.
              </p>
            </div>
            <SponsorGrid />
          </div>
        </section>

        {/* 6. Real vs simulated */}
        <section id="real" className="ld-section" aria-labelledby="ld-real-title">
          <div className="ld-wrap">
            <div className="ld-sechead">
              <p className="lv-eyebrow">Honesty</p>
              <h2 id="ld-real-title" className="ld-h2">
                What is real, what is simulated.
              </h2>
            </div>
            <div className="ld-real">
              <div className="ld-real-col">
                <h3 className="ld-real-h">
                  <span className="lv-pill lv-pill--ok">
                    <span className="lv-dot" aria-hidden="true" />
                    Real
                  </span>
                </h3>
                <ul className="ld-real-list">
                  <li>The engine and its math</li>
                  <li>The append-only ledger in Postgres</li>
                  <li>Webhook idempotency</li>
                  <li>Crash-safe runs: the serverless process really dies and resumes</li>
                  <li>The belief gate</li>
                  <li>Sponsor adapters, shown LIVE only after a real call</li>
                </ul>
              </div>
              <div className="ld-real-col ld-real-col--sim">
                <h3 className="ld-real-h">
                  <span className="lv-pill lv-pill--warn">
                    <span className="lv-dot" aria-hidden="true" />
                    Simulated
                  </span>
                </h3>
                <ul className="ld-real-list">
                  <li>
                    <span>The clock: the presenter advances the days</span>
                    <span className="lv-pill lv-pill--faint">Simulated clock</span>
                  </li>
                  <li>
                    <span>The leads, the replies and the ad spend</span>
                    <span className="lv-pill lv-pill--faint">Demo data</span>
                  </li>
                </ul>
                <p className="ld-real-aside">
                  Both labels stay on screen for the whole demo, so nothing simulated can pass as real.
                </p>
              </div>
              <p className="ld-real-foot">
                Longview never sends email, never buys ads and never touches Meta: it drafts, you decide.
              </p>
            </div>
          </div>
        </section>

        {/* 7. Early access */}
        <section id="early-access" className="ld-section ld-section--last" aria-labelledby="ld-ea-title">
          <div className="ld-wrap ld-ea">
            <div className="ld-ea-text">
              <p className="lv-eyebrow">Early access</p>
              <h2 id="ld-ea-title" className="ld-h2">
                Let your next test wait for the truth.
              </h2>
              <p id="ld-pricing" className="ld-price">
                Early access: <span className="lv-num">$299</span>/month per business. Ad spend is separate. No
                automatic billing yet.
              </p>
              <p className="ld-ea-note">
                Join the list with your email. No payment details are collected here.
              </p>
            </div>
            <EarlyAccessForm />
          </div>
        </section>
      </main>

      <footer className="ld-footer">
        <div className="ld-wrap ld-footer-row">
          <div className="ld-footer-brand">
            <span className="lv-wordmark">Longview</span>
            <span className="ld-footer-by">Built by AI Media Global</span>
          </div>
          <nav className="ld-footer-nav" aria-label="Footer">
            <Link href="/demo" className="ld-nav-link">
              Demo
            </Link>
            <Link href="/deck" className="ld-nav-link">
              Deck
            </Link>
          </nav>
        </div>
        <div className="ld-wrap">
          <p className="ld-footer-honest">Demo data and simulated clock are labeled everywhere.</p>
        </div>
      </footer>

      <MockBadge />
    </div>
  );
}
