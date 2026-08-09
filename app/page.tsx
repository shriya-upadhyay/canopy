"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  OutcomeHistoryChart,
  MarketShareDonut,
  CHART_PINK,
  CHART_LIME,
  type OutcomePoint,
  type ShareSlice,
} from "./charts";

type Strategy = {
  id: string;
  seller: string;
  strategyName?: string;
  asset: string;
  direction: "up" | "down";
  confidence: number;
  priceAtIssue: number;
  issuedAt: number;
  resolvesAt: number;
  status: "pending" | "zero" | "partial" | "full";
  accuracy?: number;
  authorizedMax: string;
  authorizedMaxUsd?: number;
  settled: string | null;
  pct: string | null;
  txHash: string | null;
  txUrl: string | null;
  onChain: boolean;
  /** Score was pinned for the demo rather than read off the market. */
  forced?: boolean;
  bond: { amount: string; status: "posted" | "slashed" | "released"; txHash: string | null; txUrl: string | null } | null;
};

type Credit = {
  limitUsd: string;
  earnedCents: number;
  baseCents: number;
  reason: string;
  record: {
    resolved: number;
    hits: number;
    spentUsd: number;
    authorizedUsd: number;
    savedUsd: number;
    hitRate: number;
  };
};

type RainResult = {
  outcome?: string;
  reason?: string;
  merchant?: string;
  mcc?: string;
  amountUsd?: string;
  attemptedUsd?: string;
  card?: { last4: string };
  policy?: { limitUsd: string; allowedMccs: string[]; rainCeilingUsd: string };
  error?: string;
};

type Preferences = {
  assets: string[];
  maxPerStrategy: number;
  sessionBudget: number;
  minSellerHitRate: number;
  intervalSec: number;
  /** Every Nth buy, sample the least-tested seller instead of the leader. */
  exploreEvery: number;
  running: boolean;
};

type AgentLog = {
  id: string;
  at: number;
  act: "observe" | "decide" | "buy" | "skip" | "settle" | "procure" | "list" | "halt";
  text: string;
  detail?: string;
};

type AgentListing = {
  id: string;
  asset: string;
  direction: "up" | "down";
  confidence: number;
  rationale: string;
  askUsd: number;
  bondUsd: number;
  createdAt: number;
  status: "draft" | "listed";
  source: "momentum" | "external";
};

const SELLERS = [
  { key: "a", name: "Intelligent", blurb: "Short-horizon momentum on majors. Sells capacity it can't deploy.", color: CHART_PINK },
  { key: "b", name: "Random", blurb: "Claims a proprietary orderflow edge. The record disagrees.", color: CHART_LIME },
];

export default function Dashboard() {
  const [strategies, setSignals] = useState<Strategy[]>([]);
  const [credit, setCredit] = useState<Credit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rain, setRain] = useState<RainResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [agentLog, setAgentLog] = useState<AgentLog[]>([]);
  const [agentListings, setAgentListings] = useState<AgentListing[]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sidebarTab, setSidebarTab] = useState<"mandate" | "reasoning">("mandate");
  const timer = useRef<NodeJS.Timeout | null>(null);
  const agentTimer = useRef<NodeJS.Timeout | null>(null);
  const prefsDirty = useRef(false);
  const resolvingDue = useRef(false);
  const latestSignals = useRef<Strategy[]>([]);

  /**
   * Poll server state.
   *
   * NEVER blank the UI on a bad response. A cycle self-calls /api/buy and can
   * run for several seconds while this poll keeps firing every 2s; under that
   * contention a poll can come back as an error body rather than the shape we
   * expect. The old code did `ledger.strategies ?? []` and
   * `setPrefs(agent.prefs ?? null)`, so one unhappy response wiped the
   * settlement feed AND flipped the agent to "paused" mid-run.
   *
   * So: only replace a piece of state when the response actually carried it.
   * A failed poll now changes nothing and the next one two seconds later
   * repaints. Stale beats empty.
   */
  const load = useCallback(async () => {
    try {
      const [ledgerRes, agentRes] = await Promise.all([
        fetch("/api/ledger", { cache: "no-store" }),
        fetch("/api/agent", { cache: "no-store" }),
      ]);

      if (ledgerRes.ok) {
        const ledger = await ledgerRes.json().catch(() => null);
        if (ledger && Array.isArray(ledger.strategies)) {
          latestSignals.current = ledger.strategies;
          setSignals(ledger.strategies);
        }
        if (ledger?.credit) setCredit(ledger.credit);
      }

      if (agentRes.ok) {
        const agent = await agentRes.json().catch(() => null);
        if (agent?.prefs && !prefsDirty.current) setPrefs(agent.prefs);
        if (Array.isArray(agent?.log)) setAgentLog(agent.log);
        if (Array.isArray(agent?.listings)) setAgentListings(agent.listings);
      }
    } catch {
      /* keep last good state */
    }
  }, []);

  const autoResolveDue = useCallback(async (items: Strategy[]) => {
    if (resolvingDue.current) return;
    const dueIds = items
      .filter((s) => s.status === "pending" && s.resolvesAt <= Date.now())
      .map((s) => s.id);
    if (dueIds.length === 0) return;

    resolvingDue.current = true;
    setLastAction(`resolving ${dueIds.length} due strategy${dueIds.length === 1 ? "" : "s"}`);
    try {
      for (const id of dueIds) {
        const r = await fetch(`/api/demo/resolve?id=${encodeURIComponent(id)}`, {
          method: "POST",
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok && j.error !== "already settled") {
          throw new Error(j.error ?? `resolve failed for ${id}`);
        }
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? `Auto-resolve failed: ${e.message}` : String(e));
    } finally {
      resolvingDue.current = false;
    }
  }, [load]);

  useEffect(() => {
    const firstLoad = setTimeout(() => {
      load();
    }, 0);
    timer.current = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      const currentSignals = latestSignals.current;
      const due = currentSignals.some((s) => s.status === "pending" && s.resolvesAt <= tick);
      if (due) {
        autoResolveDue(currentSignals);
      } else {
        load();
      }
    }, 2000);
    return () => {
      clearTimeout(firstLoad);
      if (timer.current) clearInterval(timer.current);
    };
  }, [autoResolveDue, load]);

  const runAgentCycle = useCallback(async () => {
    setAgentBusy(true);
    try {
      const r = await fetch("/api/agent", { method: "POST" });
      const j = await r.json();
      setLastAction(j.action ?? j.skipped ?? j.error ?? "cycle");
      if (j.error) setErr(j.error);
      // Autonomous procures use the same Rain boundary card the manual "Buy
      // data" button does — without this, a Rain purchase the agent made on
      // its own timer is invisible there, the most natural place to look.
      if (j.action === "procure" && j.result) setRain(j.result);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setAgentBusy(false);
    }
  }, [load]);

  useEffect(() => {
    if (agentTimer.current) clearInterval(agentTimer.current);
    if (!prefs?.running) return;

    agentTimer.current = setInterval(() => {
      runAgentCycle();
    }, Math.max(5, prefs.intervalSec) * 1000);

    return () => {
      if (agentTimer.current) clearInterval(agentTimer.current);
    };
  }, [prefs?.running, prefs?.intervalSec, runAgentCycle]);

  async function buy(seller: string) {
    setBusy(`buy-${seller}`);
    setErr(null);
    try {
      const asset = prefs?.assets[0] ?? "ETH";
      const max = prefs?.maxPerStrategy ?? 0.5;
      const r = await fetch(
        `/api/buy?seller=${seller}&asset=${encodeURIComponent(asset)}&max=${max.toFixed(2)}`,
        { method: "POST" },
      );
      const j = await r.json();
      if (j.error) setErr(j.hint ? `${j.error} — ${j.hint}` : j.error);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
      load();
    }
  }

  async function resolve(id: string, force?: number) {
    setBusy(`res-${id}`);
    setErr(null);
    try {
      const q = force !== undefined ? `&accuracy=${force}` : "";
      const r = await fetch(`/api/demo/resolve?id=${encodeURIComponent(id)}${q}`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error ?? "Resolve failed");
    } finally {
      setBusy(null);
      load();
    }
  }

  async function rainBuy(mcc: string, merchantName: string) {
    setBusy(`rain-${mcc}`);
    setRain(null);
    try {
      const r = await fetch("/api/rain/purchase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents: 199, mcc, merchantName }),
      });
      setRain(await r.json());
    } finally {
      setBusy(null);
      load();
    }
  }

  async function saveMandate(next = prefs) {
    if (!next) return;
    setBusy("mandate");
    try {
      const r = await fetch("/api/agent", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const j = await r.json();
      prefsDirty.current = false;
      setPrefs(j.prefs ?? next);
      if (next.running && !prefs?.running) {
        await runAgentCycle();
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function chooseAsset(asset: string) {
    if (!prefs) return;
    const next = { ...prefs, assets: [asset] };
    prefsDirty.current = true;
    setPrefs(next);
    await saveMandate(next);
  }

  const rec = credit?.record;
  const pending = strategies.filter((s) => s.status === "pending");

  // ── derived, real data for the two charts (no fabricated series) ────────
  const resolvedChrono = strategies.filter((s) => s.status !== "pending").slice().reverse();
  const outcomePoints: OutcomePoint[] = resolvedChrono.map((s, i) => ({
    label: `#${i + 1} ${s.strategyName ?? s.seller}`,
    authorizedUsd: s.authorizedMaxUsd ?? 0.5,
    paidUsd: (s.authorizedMaxUsd ?? 0.5) * (s.accuracy ?? 0),
  }));

  const sellerStats = SELLERS.map((s) => {
    const mine = strategies.filter((x) => x.seller === s.name && x.status !== "pending");
    const paid = mine.filter((x) => (x.accuracy ?? 0) > 0);
    const earned = mine.reduce((t, x) => t + (x.authorizedMaxUsd ?? 0.5) * (x.accuracy ?? 0), 0);
    const hitRate = mine.length ? paid.length / mine.length : null;
    return { ...s, sold: mine.length, hitRate, earned };
  });
  const shareSlices: ShareSlice[] = sellerStats.map((s) => ({
    name: s.name,
    valueUsd: s.earned,
    color: s.color,
  }));

  return (
    <div className="min-h-screen bg-canopy-bg text-canopy-ink font-sans flex">
      {/* ── sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 border-r border-canopy-border p-5 flex flex-col gap-5 h-screen sticky top-0 overflow-y-auto">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wide text-canopy-muted">
            Autonomous agent
          </span>
          {prefs && (
            <div className="flex rounded-lg border border-canopy-border overflow-hidden text-xs font-semibold mt-2">
              <button
                onClick={() => prefs.running && saveMandate({ ...prefs, running: false })}
                disabled={busy !== null || agentBusy}
                className={`flex-1 py-1.5 disabled:opacity-40 ${
                  !prefs.running ? "bg-canopy-surface-2 text-canopy-ink" : "text-canopy-muted hover:text-canopy-ink"
                }`}
              >
                Paused
              </button>
              <button
                onClick={() => !prefs.running && saveMandate({ ...prefs, running: true })}
                disabled={busy !== null || agentBusy}
                className={`flex-1 py-1.5 disabled:opacity-40 flex items-center justify-center gap-1.5 ${
                  prefs.running ? "bg-canopy-lime-dim/50 text-canopy-lime" : "text-canopy-muted hover:text-canopy-ink"
                }`}
              >
                {prefs.running && <span className="w-1.5 h-1.5 rounded-full bg-canopy-lime animate-pulse" />}
                {agentBusy ? "…" : "Running"}
              </button>
            </div>
          )}
        </div>

        <div className="flex rounded-lg border border-canopy-border overflow-hidden text-xs font-medium">
          {(["mandate", "reasoning"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSidebarTab(tab)}
              className={`flex-1 py-1.5 capitalize ${
                sidebarTab === tab
                  ? "bg-canopy-surface-2 text-canopy-ink"
                  : "text-canopy-muted hover:text-canopy-ink"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {!prefs ? (
          <p className="text-xs text-canopy-muted">Loading mandate…</p>
        ) : sidebarTab === "mandate" ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-canopy-dim">Asset scope</label>
              <div className="flex gap-1.5 mt-2">
                {["SOL", "ETH", "BTC"].map((asset) => {
                  const checked = prefs.assets[0] === asset;
                  return (
                    <button
                      key={asset}
                      onClick={() => chooseAsset(asset)}
                      disabled={busy !== null}
                      className={`flex-1 text-xs px-2 py-1.5 rounded border font-medium ${
                        checked
                          ? "border-canopy-lime bg-canopy-lime-dim/40 text-canopy-lime"
                          : "border-canopy-border text-canopy-muted"
                      }`}
                    >
                      {asset}
                    </button>
                  );
                })}
              </div>
            </div>

            <MandateSlider
              label="Per-strategy ceiling"
              value={prefs.maxPerStrategy}
              min={0.1}
              max={2}
              step={0.1}
              format={(v) => `$${v.toFixed(2)}`}
              onChange={(maxPerStrategy) => {
                prefsDirty.current = true;
                setPrefs({ ...prefs, maxPerStrategy });
              }}
            />
            <MandateSlider
              label="Session budget"
              value={prefs.sessionBudget}
              min={0.5}
              max={10}
              step={0.5}
              format={(v) => `$${v.toFixed(2)}`}
              onChange={(sessionBudget) => {
                prefsDirty.current = true;
                setPrefs({ ...prefs, sessionBudget });
              }}
            />
            <MandateSlider
              label="Min seller hit rate"
              value={prefs.minSellerHitRate}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(minSellerHitRate) => {
                prefsDirty.current = true;
                setPrefs({ ...prefs, minSellerHitRate });
              }}
            />
            <MandateSlider
              label="Cycle interval"
              value={prefs.intervalSec}
              min={5}
              max={60}
              step={5}
              format={(v) => `${v}s`}
              onChange={(intervalSec) => {
                prefsDirty.current = true;
                setPrefs({ ...prefs, intervalSec });
              }}
            />
            <MandateSlider
              label="Explore every"
              value={prefs.exploreEvery ?? 3}
              min={0}
              max={6}
              step={1}
              format={(v) => (v === 0 ? "never" : `${v} buys`)}
              onChange={(exploreEvery) => {
                prefsDirty.current = true;
                setPrefs({ ...prefs, exploreEvery });
              }}
            />

            <button
              onClick={() => saveMandate()}
              disabled={busy !== null}
              className="bg-canopy-pink text-white text-sm font-medium py-2 rounded-lg hover:opacity-90 disabled:opacity-40"
            >
              {busy === "mandate" ? "Saving…" : "Save mandate"}
            </button>
            <button
              onClick={runAgentCycle}
              disabled={busy !== null || agentBusy}
              className="border border-canopy-border text-canopy-muted text-xs py-1.5 rounded-lg hover:text-canopy-ink disabled:opacity-40"
            >
              {agentBusy ? "Running cycle…" : "Run one cycle"}
            </button>
            <p className="text-[11px] text-canopy-dim leading-relaxed">
              Status: <span className={prefs.running ? "text-canopy-lime" : "text-canopy-muted"}>
                {prefs.running ? "running" : "paused"}
              </span>
              {lastAction && <> · last cycle: {lastAction}</>}
            </p>
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto space-y-3 text-xs">
            {agentLog.length === 0 ? (
              <p className="text-canopy-muted">Start the agent or run one cycle to see its reasoning.</p>
            ) : (
              agentLog.map((entry) => (
                <li key={entry.id} className="border-l-2 border-canopy-border pl-2.5">
                  <div className="flex justify-between gap-2">
                    <span className="text-canopy-ink font-medium">{entry.text}</span>
                  </div>
                  <span className="text-[9px] uppercase text-canopy-dim">{entry.act}</span>
                  {entry.detail && <p className="text-canopy-muted mt-0.5 leading-relaxed">{entry.detail}</p>}
                </li>
              ))
            )}
          </ul>
        )}
      </aside>

      {/* ── main ────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 p-6">
        <div className="max-w-6xl mx-auto space-y-5">
          {/* ── header ──────────────────────────────────────────────── */}
          <header className="flex items-start justify-between gap-4 flex-wrap pb-4 border-b border-canopy-border">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-canopy-pink" style={{ fontStyle: "italic" }}>
                Canopy
              </h1>
              <p className="text-sm font-medium text-canopy-ink mt-1">Agents pay for outcomes, not promises</p>
              <p className="text-xs text-canopy-muted mt-0.5">
                Conditional settlement on Monad via x402 <code>upto</code> — active on-chain.
              </p>
            </div>
            <div className="flex items-center gap-2 bg-canopy-surface border border-canopy-border rounded-full px-3 py-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${prefs?.running ? "bg-canopy-lime" : "bg-canopy-dim"}`} />
              <span className="text-[10px] uppercase tracking-wide text-canopy-muted">
                {prefs?.running ? "Active agent" : "Idle"}
              </span>
            </div>
          </header>

          {err && (
            <div className="bg-red-950/60 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-200">
              {err}
            </div>
          )}

          {/* ── money strip ─────────────────────────────────────────── */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Authorized ceilings" value={`$${(rec?.authorizedUsd ?? 0).toFixed(2)}`} />
            <Stat
              label="Actually paid out"
              value={`$${(rec?.spentUsd ?? 0).toFixed(2)}`}
              sub={rec && rec.authorizedUsd > 0 ? `${((rec.spentUsd / rec.authorizedUsd) * 100).toFixed(1)}%` : undefined}
              accent="text-canopy-lime"
            />
            <Stat
              label="Saved by settlement"
              value={`$${(rec?.savedUsd ?? 0).toFixed(2)}`}
              accent="text-amber-400"
            />
            <Stat
              label="Spending limit (earned)"
              value={`$${credit?.limitUsd ?? "5.00"}`}
              accent="text-canopy-pink"
            />
          </section>

          {/* ── charts ──────────────────────────────────────────────── */}
          <section className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-canopy-surface border border-canopy-border rounded-xl p-5">
              <h2 className="font-semibold text-sm mb-3">Outcome History</h2>
              <OutcomeHistoryChart points={outcomePoints} />
            </div>
            <div className="bg-canopy-surface border border-canopy-border rounded-xl p-5">
              <h2 className="font-semibold text-sm mb-3">Market Share</h2>
              <MarketShareDonut slices={shareSlices} />
            </div>
          </section>

          {/* ── sellers ─────────────────────────────────────────────── */}
          <section className="grid md:grid-cols-2 gap-4">
            {sellerStats.map((s) => (
              <div key={s.key} className="bg-canopy-surface border border-canopy-border rounded-xl p-5">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <h2 className="font-semibold flex items-center gap-2">
                      {s.name}
                      {s.hitRate !== null && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            s.hitRate >= 0.5
                              ? "bg-canopy-lime-dim/50 text-canopy-lime"
                              : "bg-red-950 text-red-300"
                          }`}
                        >
                          {(s.hitRate * 100).toFixed(0)}% HIT RATE
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-canopy-muted mt-1 leading-relaxed">{s.blurb}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-4 text-sm">
                  <Mini label="strategies sold" value={String(s.sold)} />
                  <Mini label="paid out" value={s.hitRate !== null ? `${Math.round(s.hitRate * 100)}%` : "—"} />
                  <Mini label="total earned" value={`$${s.earned.toFixed(2)}`} />
                </div>
                <button
                  onClick={() => buy(s.key)}
                  disabled={busy !== null}
                  className="w-full mt-4 bg-canopy-pink text-white text-sm font-semibold py-2 rounded-lg hover:opacity-90 disabled:opacity-40"
                >
                  {busy === `buy-${s.key}` ? "Signing…" : "Buy strategy"}
                </button>
              </div>
            ))}
          </section>

          {/* ── settlement feed ─────────────────────────────────────── */}
          <section className="bg-canopy-surface border border-canopy-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-canopy-border flex justify-between items-center">
              <h2 className="font-semibold text-sm">Settlement Feed</h2>
              <span className="text-xs text-canopy-muted">
                {pending.length} pending · real-time outcomes
              </span>
            </div>

            {strategies.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-canopy-muted">
                No purchases yet. Buy a strategy to start.
              </p>
            ) : (
              <ul className="divide-y divide-canopy-border max-h-96 overflow-y-auto">
                {strategies.map((s) => {
                  const left = Math.max(0, Math.ceil((s.resolvesAt - now) / 1000));
                  return (
                    <li key={s.id} className="px-5 py-3 flex items-center gap-4 text-sm">
                      <Badge status={s.status} />

                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          <span className="text-canopy-ink">{s.strategyName ?? s.seller}</span>
                          <span className="text-canopy-dim"> · </span>
                          <span className="font-medium">
                            {s.asset} {s.direction === "up" ? "↑" : "↓"}
                          </span>
                          <span className="text-canopy-dim">
                            {" "}conf {s.confidence} · @ ${s.priceAtIssue?.toFixed(2)}
                          </span>
                          {s.forced && (
                            <span
                              title="Score pinned by DEMO_OUTCOMES. The settlement itself is real."
                              className="ml-2 align-middle text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-400"
                            >
                              scripted
                            </span>
                          )}
                        </div>
                        {s.status === "zero" && (
                          <div className="text-xs text-red-400 mt-0.5 font-medium">
                            no on-chain transaction — nobody had to arbitrate this
                          </div>
                        )}
                        {s.bond && (
                          <div
                            className={`text-xs mt-0.5 ${
                              s.bond.status === "slashed" ? "text-red-400 font-medium" : "text-canopy-muted"
                            }`}
                          >
                            bond {s.bond.amount}{" "}
                            {s.bond.status === "posted"
                              ? "staked"
                              : s.bond.status === "slashed"
                                ? "— slashed, paid to buyer"
                                : "— released"}
                            {s.bond.txUrl && (
                              <>
                                {" "}
                                ·{" "}
                                <a href={s.bond.txUrl} target="_blank" rel="noreferrer" className="text-canopy-lime hover:underline">
                                  tx ↗
                                </a>
                              </>
                            )}
                          </div>
                        )}
                        {s.txUrl && (
                          <a
                            href={s.txUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-canopy-lime hover:underline mt-0.5 inline-block"
                          >
                            {s.txHash?.slice(0, 18)}… ↗
                          </a>
                        )}
                      </div>

                      <div className="text-right shrink-0 w-32">
                        <div className="text-canopy-muted text-xs">
                          max {s.authorizedMax}
                          {s.pct && ` · ${s.pct}`}
                        </div>
                        <div
                          className={
                            s.status === "zero"
                              ? "text-red-400 font-semibold"
                              : s.status === "pending"
                                ? "text-canopy-muted"
                                : "text-canopy-lime font-semibold"
                          }
                        >
                          {s.status === "pending" ? `${left}s` : (s.settled ?? "—")}
                        </div>
                      </div>

                      {s.status === "pending" && (
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => resolve(s.id)}
                            disabled={busy !== null}
                            className="text-xs border border-canopy-border px-2 py-1 rounded hover:bg-canopy-surface-2 disabled:opacity-40"
                          >
                            Resolve
                          </button>
                          <button
                            onClick={() => resolve(s.id, 0)}
                            disabled={busy !== null}
                            className="text-xs border border-red-900 text-red-400 px-2 py-1 rounded hover:bg-red-950 disabled:opacity-40"
                            title="Force the $0 path — demo control, not a fake market"
                          >
                            Force $0
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── agent activity + listings ───────────────────────────── */}
          <section className="grid lg:grid-cols-2 gap-4">
            <div className="bg-canopy-surface border border-canopy-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-canopy-border flex justify-between items-center">
                <h2 className="font-semibold text-sm">Agent Activity</h2>
                <span className="text-xs text-canopy-muted">{agentLog.length} events</span>
              </div>
              {agentLog.length === 0 ? (
                <p className="px-5 py-8 text-sm text-canopy-muted">
                  Start the agent or run one cycle to see its decisions.
                </p>
              ) : (
                <ul className="divide-y divide-canopy-border max-h-96 overflow-y-auto">
                  {agentLog.map((entry) => (
                    <li key={entry.id} className="px-5 py-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="font-medium text-canopy-ink">{entry.text}</span>
                        <span className="text-[10px] uppercase text-canopy-dim">{entry.act}</span>
                      </div>
                      {entry.detail && (
                        <p className="text-xs text-canopy-muted mt-1 leading-relaxed">{entry.detail}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-canopy-surface border border-canopy-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-canopy-border flex justify-between items-center">
                <h2 className="font-semibold text-sm">Strategies My Agent Listed</h2>
                <span className="text-xs text-canopy-muted">{agentListings.length} live</span>
              </div>
              {agentListings.length === 0 ? (
                <p className="px-5 py-8 text-sm text-canopy-muted">
                  No sell-side strategy yet. The agent lists only when market-data conviction clears its bar.
                </p>
              ) : (
                <ul className="divide-y divide-canopy-border max-h-96 overflow-y-auto">
                  {agentListings.map((listing) => (
                    <li key={listing.id} className="px-5 py-3 text-sm flex justify-between gap-4">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {listing.asset} {listing.direction === "up" ? "↑" : "↓"} · conf{" "}
                          {listing.confidence}
                          {listing.source === "external" && (
                            <span
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-canopy-pink-dim/50 text-canopy-pink"
                              title="Derived from data bought via the Rain boundary, not the marketplace's own feed"
                            >
                              FROM PURCHASED DATA
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-canopy-muted mt-1">{listing.rationale}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-canopy-lime font-semibold">${listing.askUsd.toFixed(2)}</div>
                        <div className="text-xs text-canopy-muted">bond ${listing.bondUsd.toFixed(2)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* ── Rain boundary ───────────────────────────────────────── */}
          <section className="bg-canopy-surface border border-canopy-border rounded-xl p-5">
            <div className="grid lg:grid-cols-2 gap-5">
              <div>
                <h2 className="font-semibold text-sm">The Boundary — external data gateway</h2>
                <p className="text-xs text-canopy-muted mt-1 leading-relaxed">
                  Data no marketplace agent sells. The agent buys it with a scoped card sized to the
                  limit its track record earned. Rain enforces the cap, the merchant category, and
                  the expiry <em>before</em> money moves.
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => rainBuy("5734", "Kaiko Market Data")}
                    disabled={busy !== null}
                    className="bg-canopy-pink text-white text-sm px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-40"
                  >
                    Buy data ($1.99)
                  </button>
                  <button
                    onClick={() => rainBuy("7995", "Offshore Casino")}
                    disabled={busy !== null}
                    className="border border-red-800 text-red-400 text-sm px-3 py-1.5 rounded-lg hover:bg-red-950 disabled:opacity-40"
                  >
                    Try disallowed merchant
                  </button>
                </div>

                {credit && (
                  <div className="mt-3 rounded-lg border border-sky-900/60 bg-sky-950/30 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-sky-400">
                      Credit status
                    </div>
                    <p className="text-sm text-canopy-ink/90 mt-1 leading-relaxed">{credit.reason}</p>
                  </div>
                )}

                {rain && (
                  <div
                    className={`mt-3 rounded-lg border px-4 py-3 text-sm ${
                      rain.outcome === "declined"
                        ? "bg-red-950/50 border-red-800"
                        : rain.error
                          ? "bg-amber-950/50 border-amber-800"
                          : "bg-canopy-lime-dim/30 border-canopy-lime/40"
                    }`}
                  >
                    {rain.error ? (
                      <span className="text-amber-300">{rain.error}</span>
                    ) : rain.outcome === "declined" ? (
                      <>
                        <div className="font-semibold text-red-300">DECLINED — {rain.reason}</div>
                        <div className="text-xs text-canopy-muted mt-1">
                          {rain.merchant} (MCC {rain.mcc}) · attempted ${rain.attemptedUsd} · card ••{rain.card?.last4}
                          <br />
                          Rain enforced the policy before any money moved.
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-semibold text-canopy-lime">
                          {String(rain.outcome).toUpperCase()} — ${rain.amountUsd} at {rain.merchant}
                        </div>
                        <div className="text-xs text-canopy-muted mt-1">
                          card ••{rain.card?.last4} · limit ${rain.policy?.limitUsd} (Rain ceiling $
                          {rain.policy?.rainCeilingUsd}) · MCCs {rain.policy?.allowedMccs?.join(", ")}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <AgentCard rain={rain} credit={credit} />
            </div>
          </section>

          <footer className="text-xs text-canopy-dim pb-8 flex justify-between flex-wrap gap-2">
            <span>
              Network: Monad testnet · eip155:10143 · USDC 0x534b…43A3 · facilitator
              x402-facilitator.molandak.org
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-canopy-lime" /> healthy
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}


function AgentCard({ rain, credit }: { rain: RainResult | null; credit: Credit | null }) {
  const last4 = rain?.card?.last4;
  const status = rain?.error ? "Error" : rain?.outcome === "declined" ? "Declined" : rain ? "Authorized" : "No card issued yet";
  const statusColor =
    status === "Authorized" ? "text-canopy-lime" : status === "Declined" ? "text-red-400" : "text-canopy-muted";

  return (
    <div className="flex flex-col justify-between rounded-xl border border-canopy-border bg-gradient-to-br from-canopy-surface-2 to-canopy-bg p-5 min-h-[180px]">
      <div className="flex justify-between items-start">
        <div>
          <span className="text-[10px] uppercase tracking-widest text-canopy-dim">Canopy agent card</span>
          <p className="text-[10px] text-canopy-dim mt-0.5 max-w-[220px] leading-relaxed">
            Rain issues one of these per external purchase, scoped to the agent's
            earned limit. Shows whichever was issued most recently.
          </p>
        </div>
        <span className="text-canopy-pink text-xs shrink-0">◆</span>
      </div>
      <div className={`font-mono text-lg tracking-widest my-3 ${last4 ? "text-canopy-ink/90" : "text-canopy-dim"}`}>
        •••• •••• •••• {last4 ?? "----"}
      </div>
      <div className="flex justify-between items-end text-[10px]">
        <div>
          <div className="uppercase text-canopy-dim">Autonomous holder</div>
          <div className="text-canopy-ink font-medium">CANOPY AGENT</div>
        </div>
        <div className="text-right">
          <div className="uppercase text-canopy-dim">Status</div>
          <div className={`font-medium ${statusColor}`}>{status}</div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-canopy-border/70 text-[11px] text-canopy-muted flex justify-between">
        <span>Next card's limit</span>
        <span className="text-canopy-ink">${credit?.limitUsd ?? "5.00"}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-canopy-surface border border-canopy-border rounded-xl px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-canopy-muted">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={`text-xl font-semibold ${accent ?? ""}`}>{value}</span>
        {sub && <span className="text-xs text-canopy-dim">{sub}</span>}
      </div>
    </div>
  );
}

function MandateSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between gap-2">
        <label className="text-[10px] uppercase tracking-wide text-canopy-dim">{label}</label>
        <span className="text-xs text-canopy-ink">{format(value)}</span>
      </div>
      <input
        className="w-full mt-2 accent-[var(--color-canopy-pink)]"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-canopy-surface-2 border border-canopy-border rounded-lg px-2 py-1.5">
      <div className="text-[10px] uppercase text-canopy-dim">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function Badge({ status }: { status: Strategy["status"] }) {
  const map = {
    pending: ["PENDING", "bg-canopy-surface-2 text-canopy-muted"],
    full: ["FULL", "bg-canopy-lime-dim/50 text-canopy-lime"],
    partial: ["PARTIAL", "bg-amber-900 text-amber-300"],
    zero: ["ZERO", "bg-red-900 text-red-300"],
  } as const;
  const [text, cls] = map[status];
  return (
    <span className={`text-[10px] font-bold px-2 py-1 rounded w-16 text-center shrink-0 ${cls}`}>
      {text}
    </span>
  );
}
