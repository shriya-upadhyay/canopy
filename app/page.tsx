"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Signal = {
  id: string;
  seller: string;
  asset: string;
  direction: "up" | "down";
  confidence: number;
  priceAtIssue: number;
  issuedAt: number;
  resolvesAt: number;
  status: "pending" | "zero" | "partial" | "full";
  accuracy?: number;
  authorizedMax: string;
  settled: string | null;
  pct: string | null;
  txHash: string | null;
  txUrl: string | null;
  onChain: boolean;
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

const SELLERS = [
  { key: "a", name: "Meridian Alpha", blurb: "Short-horizon momentum on majors. Sells capacity it can't deploy." },
  { key: "b", name: "Kestrel Signals", blurb: "Claims a proprietary orderflow edge. The record disagrees." },
];

export default function Dashboard() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [credit, setCredit] = useState<Credit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rain, setRain] = useState<RainResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const timer = useRef<NodeJS.Timeout | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ledger", { cache: "no-store" });
      const j = await r.json();
      setSignals(j.signals ?? []);
      setCredit(j.credit ?? null);
    } catch {
      /* keep last good state */
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(() => {
      load();
      setNow(Date.now());
    }, 2000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  async function buy(seller: string) {
    setBusy(`buy-${seller}`);
    setErr(null);
    try {
      const r = await fetch(`/api/buy?seller=${seller}`, { method: "POST" });
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
    try {
      const q = force !== undefined ? `&accuracy=${force}` : "";
      await fetch(`/api/demo/resolve?id=${id}${q}`, { method: "POST" });
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

  const rec = credit?.record;
  const pending = signals.filter((s) => s.status === "pending");

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
            A wrong signal settles at $0 — with no on-chain transaction.
          </p>
        </header>

        {err && (
          <div className="bg-red-950/60 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-200">
            {err}
          </div>
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
            label="Agent credit limit (earned)"
            value={`$${credit?.limitUsd ?? "5.00"}`}
            accent="text-sky-400"
          />
        </section>

        {/* ── sellers ────────────────────────────────────────────── */}
        <section className="grid md:grid-cols-2 gap-4">
          {SELLERS.map((s) => {
            const mine = signals.filter((x) => x.seller === s.name && x.status !== "pending");
            const paid = mine.filter((x) => (x.accuracy ?? 0) > 0);
            const earned = mine.reduce((t, x) => t + 0.5 * (x.accuracy ?? 0), 0);
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
                    {busy === `buy-${s.key}` ? "signing…" : "Buy signal"}
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

        {/* ── settlement feed ────────────────────────────────────── */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-neutral-800 flex justify-between items-center">
            <h2 className="font-semibold text-sm">Settlements</h2>
            <span className="text-xs text-neutral-500">
              {pending.length} pending · polling every 2s
            </span>
          </div>

          {signals.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-neutral-600">
              No purchases yet. Buy a signal to start.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-800">
              {signals.map((s) => {
                const left = Math.max(0, Math.ceil((s.resolvesAt - now) / 1000));
                return (
                  <li key={s.id} className="px-5 py-3 flex items-center gap-4 text-sm">
                    <Badge status={s.status} />

                    <div className="flex-1 min-w-0">
                      <div className="truncate">
                        <span className="text-neutral-300">{s.seller}</span>
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

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5">
      <div className="text-[10px] uppercase text-neutral-600">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function Badge({ status }: { status: Signal["status"] }) {
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
