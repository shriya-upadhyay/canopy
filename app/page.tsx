"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
};

const SELLERS = [
  { key: "a", name: "Intelligent", blurb: "Short-horizon momentum on majors. Sells capacity it can't deploy." },
  { key: "b", name: "Random", blurb: "Claims a proprietary orderflow edge. The record disagrees." },
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
  const timer = useRef<NodeJS.Timeout | null>(null);
  const agentTimer = useRef<NodeJS.Timeout | null>(null);
  const prefsDirty = useRef(false);
  const resolvingDue = useRef(false);
  const latestSignals = useRef<Strategy[]>([]);

  const load = useCallback(async () => {
    try {
      const [ledgerRes, agentRes] = await Promise.all([
        fetch("/api/ledger", { cache: "no-store" }),
        fetch("/api/agent", { cache: "no-store" }),
      ]);
      const ledger = await ledgerRes.json();
      const agent = await agentRes.json();
      const nextSignals = ledger.strategies ?? [];
      latestSignals.current = nextSignals;
      setSignals(nextSignals);
      setCredit(ledger.credit ?? null);
      if (!prefsDirty.current) setPrefs(agent.prefs ?? null);
      setAgentLog(agent.log ?? []);
      setAgentListings(agent.listings ?? []);
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

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* ── header ─────────────────────────────────────────────── */}
        <header className="border-b border-neutral-800 pb-5">
          <h1 className="text-2xl font-semibold tracking-tight">
            Agents pay for outcomes, not promises
          </h1>
          <p className="text-neutral-400 text-sm mt-1">
            Conditional settlement on Monad via x402 <code className="text-neutral-300">upto</code>.
            A wrong strategy settles at $0 — with no on-chain transaction.
          </p>
        </header>

        {err && (
          <div className="bg-red-950/60 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-200">
            {err}
          </div>
        )}

        {/* ── mandate ───────────────────────────────────────────── */}
        {prefs && (
          <section className="bg-neutral-900 border border-emerald-900/70 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="font-semibold text-sm">My Agent Mandate</h2>
                <p className="text-xs text-neutral-500 mt-1 max-w-2xl leading-relaxed">
                  The human sets these preferences once. After that, the agent buys,
                  waits, procures external data, and lists strategies inside this mandate.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => saveMandate({ ...prefs, running: !prefs.running })}
                  disabled={busy !== null || agentBusy}
                  className={`text-sm px-3 py-1.5 rounded-lg disabled:opacity-40 ${
                    prefs.running
                      ? "border border-amber-800 text-amber-300 hover:bg-amber-950"
                      : "bg-emerald-600 text-white hover:bg-emerald-500"
                  }`}
                >
                  {agentBusy ? "Thinking…" : prefs.running ? "Pause agent" : "Start agent"}
                </button>
                <button
                  onClick={() => saveMandate()}
                  disabled={busy !== null}
                  className="bg-neutral-100 text-neutral-900 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-white disabled:opacity-40"
                >
                  {busy === "mandate" ? "saving…" : "Save mandate"}
                </button>
              </div>
            </div>

            <div className="grid md:grid-cols-5 gap-3 mt-4">
              <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3">
                <label className="text-[10px] uppercase text-neutral-600">Market focus</label>
                <div className="flex gap-2 mt-2">
                  {["ETH", "BTC", "SOL"].map((asset) => {
                    const checked = prefs.assets[0] === asset;
                    return (
                      <button
                        key={asset}
                        onClick={() => chooseAsset(asset)}
                        disabled={busy !== null}
                        className={`text-xs px-2 py-1 rounded border ${
                          checked
                            ? "border-emerald-700 bg-emerald-950 text-emerald-300"
                            : "border-neutral-800 text-neutral-500"
                        }`}
                      >
                        {asset}
                      </button>
                    );
                  })}
                </div>
              </div>

              <MandateSlider
                label="Max per strategy"
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
                label="Strategy budget (you set)"
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
                label="Min hit rate"
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
                label="Cycle"
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
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-800 pt-3 text-xs text-neutral-500">
              <span>
                Status:{" "}
                <span className={prefs.running ? "text-emerald-300" : "text-neutral-300"}>
                  {prefs.running ? "running" : "paused"}
                </span>
                {lastAction && <> · last cycle: {lastAction}</>}
              </span>
              <button
                onClick={runAgentCycle}
                disabled={busy !== null || agentBusy}
                className="border border-neutral-700 text-neutral-300 px-2 py-1 rounded hover:bg-neutral-800 disabled:opacity-40"
              >
                {agentBusy ? "running cycle…" : "Run one cycle"}
              </button>
            </div>
          </section>
        )}

        {/* ── money strip ────────────────────────────────────────── */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Authorized (ceilings)" value={`$${(rec?.authorizedUsd ?? 0).toFixed(2)}`} />
          <Stat label="Actually paid" value={`$${(rec?.spentUsd ?? 0).toFixed(2)}`} accent="text-emerald-400" />
          <Stat
            label="Saved by conditional settlement"
            value={`$${(rec?.savedUsd ?? 0).toFixed(2)}`}
            accent="text-amber-400"
          />
          <Stat
            label="Card limit for outside data (earned)"
            value={`$${credit?.limitUsd ?? "5.00"}`}
            accent="text-sky-400"
          />
        </section>

        {/* ── sellers ────────────────────────────────────────────── */}
        <section className="grid md:grid-cols-2 gap-4">
          {SELLERS.map((s) => {
            const mine = strategies.filter((x) => x.seller === s.name && x.status !== "pending");
            const paid = mine.filter((x) => (x.accuracy ?? 0) > 0);
            const earned = mine.reduce(
              (t, x) => t + (x.authorizedMaxUsd ?? 0.5) * (x.accuracy ?? 0),
              0,
            );
            return (
              <div key={s.key} className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <h2 className="font-semibold">{s.name}</h2>
                    <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{s.blurb}</p>
                  </div>
                  <button
                    onClick={() => buy(s.key)}
                    disabled={busy !== null}
                    className="shrink-0 bg-neutral-100 text-neutral-900 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-white disabled:opacity-40"
                  >
                    {busy === `buy-${s.key}` ? "signing…" : "Buy strategy"}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-4 text-sm">
                  <Mini label="sold" value={String(mine.length)} />
                  <Mini
                    label="paid out"
                    value={mine.length ? `${Math.round((paid.length / mine.length) * 100)}%` : "—"}
                  />
                  <Mini label="earned" value={`$${earned.toFixed(2)}`} />
                </div>
              </div>
            );
          })}
        </section>

        {/* ── agent activity ─────────────────────────────────────── */}
        <section className="grid lg:grid-cols-2 gap-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-neutral-800 flex justify-between items-center">
              <h2 className="font-semibold text-sm">Agent Activity</h2>
              <span className="text-xs text-neutral-500">{agentLog.length} events</span>
            </div>
            {agentLog.length === 0 ? (
              <p className="px-5 py-8 text-sm text-neutral-600">
                Start the agent or run one cycle to see its decisions.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-800">
                {agentLog.slice(0, 8).map((entry) => (
                  <li key={entry.id} className="px-5 py-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium text-neutral-200">{entry.text}</span>
                      <span className="text-[10px] uppercase text-neutral-600">{entry.act}</span>
                    </div>
                    {entry.detail && (
                      <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{entry.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-neutral-800 flex justify-between items-center">
              <h2 className="font-semibold text-sm">Strategies My Agent Listed</h2>
              <span className="text-xs text-neutral-500">{agentListings.length} live</span>
            </div>
            {agentListings.length === 0 ? (
              <p className="px-5 py-8 text-sm text-neutral-600">
                No sell-side strategy yet. The agent lists only when market-data conviction clears its bar.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-800">
                {agentListings.slice(0, 6).map((listing) => (
                  <li key={listing.id} className="px-5 py-3 text-sm flex justify-between gap-4">
                    <div>
                      <div className="font-medium">
                        {listing.asset} {listing.direction === "up" ? "↑" : "↓"} · conf{" "}
                        {listing.confidence}
                      </div>
                      <p className="text-xs text-neutral-500 mt-1">{listing.rationale}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-emerald-400 font-semibold">${listing.askUsd.toFixed(2)}</div>
                      <div className="text-xs text-neutral-500">bond ${listing.bondUsd.toFixed(2)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ── settlement feed ────────────────────────────────────── */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-neutral-800 flex justify-between items-center">
            <h2 className="font-semibold text-sm">Settlements</h2>
            <span className="text-xs text-neutral-500">
              {pending.length} pending · polling every 2s
            </span>
          </div>

          {strategies.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-neutral-600">
              No purchases yet. Buy a strategy to start.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-800">
              {strategies.map((s) => {
                const left = Math.max(0, Math.ceil((s.resolvesAt - now) / 1000));
                return (
                  <li key={s.id} className="px-5 py-3 flex items-center gap-4 text-sm">
                    <Badge status={s.status} />

                    <div className="flex-1 min-w-0">
                      <div className="truncate">
                        <span className="text-neutral-300">{s.strategyName ?? s.seller}</span>
                        <span className="text-neutral-600"> · </span>
                        <span className="font-medium">
                          {s.asset} {s.direction === "up" ? "↑" : "↓"}
                        </span>
                        <span className="text-neutral-600">
                          {" "}conf {s.confidence} · @ ${s.priceAtIssue?.toFixed(2)}
                        </span>
                      </div>
                      {s.status === "zero" && (
                        <div className="text-xs text-red-400 mt-0.5 font-medium">
                          no on-chain transaction — nobody had to arbitrate this
                        </div>
                      )}
                      {s.bond && (
                        <div
                          className={`text-xs mt-0.5 ${
                            s.bond.status === "slashed"
                              ? "text-red-400 font-medium"
                              : "text-neutral-500"
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
                              <a
                                href={s.bond.txUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sky-400 hover:underline"
                              >
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
                          className="text-xs text-sky-400 hover:underline mt-0.5 inline-block"
                        >
                          {s.txHash?.slice(0, 18)}… ↗
                        </a>
                      )}
                    </div>

                    <div className="text-right shrink-0 w-32">
                      <div className="text-neutral-500 text-xs">
                        max {s.authorizedMax}
                        {s.pct && ` · ${s.pct}`}
                      </div>
                      <div
                        className={
                          s.status === "zero"
                            ? "text-red-400 font-semibold"
                            : s.status === "pending"
                              ? "text-neutral-500"
                              : "text-emerald-400 font-semibold"
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
                          className="text-xs border border-neutral-700 px-2 py-1 rounded hover:bg-neutral-800 disabled:opacity-40"
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

        {/* ── Rain boundary ──────────────────────────────────────── */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
          <div className="flex justify-between items-start gap-4 flex-wrap">
            <div>
              <h2 className="font-semibold text-sm">Rain boundary — external purchase</h2>
              <p className="text-xs text-neutral-500 mt-1 max-w-xl leading-relaxed">
                Data no marketplace agent sells. The agent buys it with a scoped card sized to the
                limit its track record earned. Rain enforces the cap, the merchant category, and
                the expiry <em>before</em> money moves.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => rainBuy("5734", "Kaiko Market Data")}
                disabled={busy !== null}
                className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-emerald-500 disabled:opacity-40"
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
          </div>

          {credit && (
            <p className="text-xs text-neutral-500 mt-3 border-l-2 border-neutral-700 pl-3">
              {credit.reason}
            </p>
          )}

          {rain && (
            <div
              className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
                rain.outcome === "declined"
                  ? "bg-red-950/50 border-red-800"
                  : rain.error
                    ? "bg-amber-950/50 border-amber-800"
                    : "bg-emerald-950/40 border-emerald-800"
              }`}
            >
              {rain.error ? (
                <span className="text-amber-300">{rain.error}</span>
              ) : rain.outcome === "declined" ? (
                <>
                  <div className="font-semibold text-red-300">
                    DECLINED — {rain.reason}
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">
                    {rain.merchant} (MCC {rain.mcc}) · attempted ${rain.attemptedUsd} · card ••{rain.card?.last4}
                    <br />
                    Rain enforced the policy before any money moved.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-emerald-300">
                    {String(rain.outcome).toUpperCase()} — ${rain.amountUsd} at {rain.merchant}
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">
                    card ••{rain.card?.last4} · limit ${rain.policy?.limitUsd} (Rain ceiling $
                    {rain.policy?.rainCeilingUsd}) · MCCs {rain.policy?.allowedMccs?.join(", ")}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <footer className="text-xs text-neutral-600 pb-8">
          Monad testnet · eip155:10143 · USDC 0x534b…43A3 · facilitator x402-facilitator.molandak.org
        </footer>
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${accent ?? ""}`}>{value}</div>
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
    <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3">
      <div className="flex justify-between gap-2">
        <label className="text-[10px] uppercase text-neutral-600">{label}</label>
        <span className="text-xs text-neutral-300">{format(value)}</span>
      </div>
      <input
        className="w-full mt-3 accent-emerald-500"
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
    <div className="bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5">
      <div className="text-[10px] uppercase text-neutral-600">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function Badge({ status }: { status: Strategy["status"] }) {
  const map = {
    pending: ["PENDING", "bg-neutral-800 text-neutral-400"],
    full: ["FULL", "bg-emerald-900 text-emerald-300"],
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
