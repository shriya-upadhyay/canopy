/**
 * THE BUYER AGENT — autonomy.
 *
 * Before this, a human clicked "Buy" and the agent merely signed. That is a
 * vending machine, not an agent. Here the agent decides FOR ITSELF: when to
 * buy, who to buy from, when to stop, when to go outside the marketplace for
 * data, and what to list for sale.
 *
 * The dashboard is this agent's point of view. Every decision is logged with
 * its reasoning, so the demo is the agent narrating its own behaviour rather
 * than a person driving a UI.
 *
 * The human's only role is setting preferences once, up front — the mandate.
 * After that the agent operates inside it, and Rain enforces the edge.
 */

import { all } from "./pending";
import { creditLimit } from "./credit";
import { momentumBps } from "./strategy";

// ---------------------------------------------------------------------------
// The mandate — what the human sets once
// ---------------------------------------------------------------------------
export interface Preferences {
  assets: string[];
  /** Ceiling the agent may authorize on any single strategy, USD. */
  maxPerStrategy: number;
  /** Total it may authorize this session, USD. Independent of the Rain card. */
  sessionBudget: number;
  /** Won't buy from a seller whose observed hit rate is below this. */
  minSellerHitRate: number;
  /** Seconds between decision cycles. */
  intervalSec: number;
  running: boolean;
}

export const DEFAULT_PREFS: Preferences = {
  assets: ["ETH"],
  maxPerStrategy: 0.5,
  sessionBudget: 3.0,
  minSellerHitRate: 0.3,
  intervalSec: 20,
  running: false,
};

// ---------------------------------------------------------------------------
// Activity log — the agent thinking out loud
// ---------------------------------------------------------------------------
export type Act =
  | "observe"
  | "decide"
  | "buy"
  | "skip"
  | "settle"
  | "procure"
  | "list"
  | "halt";

export interface Entry {
  id: string;
  at: number;
  act: Act;
  text: string;
  detail?: string;
}

interface State {
  prefs: Preferences;
  log: Entry[];
  lastTick: number;
  spentThisSession: number;
  listings: Listing[];
}

/** A strategy the agent generated itself and would offer to other agents. */
export interface Listing {
  id: string;
  asset: string;
  direction: "up" | "down";
  confidence: number;
  rationale: string;
  askUsd: number;
  bondUsd: number;
  createdAt: number;
  status: "draft" | "listed";
}

const g = globalThis as unknown as { __canopyAgent?: State };
const state: State = (g.__canopyAgent ??= {
  prefs: { ...DEFAULT_PREFS },
  log: [],
  lastTick: 0,
  spentThisSession: 0,
  listings: [],
});

export const prefs = () => state.prefs;
export const setPrefs = (p: Partial<Preferences>) => {
  state.prefs = { ...state.prefs, ...p };
  return state.prefs;
};
export const log = (n = 60) => state.log.slice(0, n);
export const listings = () => state.listings;

function say(act: Act, text: string, detail?: string) {
  state.log.unshift({
    id: crypto.randomUUID(),
    at: Date.now(),
    act,
    text,
    detail,
  });
  if (state.log.length > 300) state.log.length = 300;
}
export { say };

// ---------------------------------------------------------------------------
// Seller ranking — from OBSERVED behaviour, not configuration
// ---------------------------------------------------------------------------
export interface SellerStat {
  key: string;
  name: string;
  resolved: number;
  hits: number;
  hitRate: number;
  earnedUsd: number;
}

const SELLER_KEYS: Record<string, string> = {
  [(process.env.SELLER_A_ADDR ?? "a").toLowerCase()]: "a",
  [(process.env.SELLER_B_ADDR ?? "b").toLowerCase()]: "b",
};
const SELLER_NAMES: Record<string, string> = { a: "Intelligent", b: "Random" };

export function rankSellers(): SellerStat[] {
  const settled = all().filter((p) => p.settled);

  return ["a", "b"].map((key) => {
    const mine = settled.filter(
      (p) => SELLER_KEYS[p.seller?.toLowerCase()] === key,
    );
    const hits = mine.filter((p) => (p.settled?.accuracy ?? 0) > 0).length;
    return {
      key,
      name: SELLER_NAMES[key],
      resolved: mine.length,
      hits,
      // Unproven sellers get the benefit of the doubt — otherwise the agent
      // would never buy from anyone and the market could never form.
      hitRate: mine.length ? hits / mine.length : 0.5,
      earnedUsd: mine.reduce(
        (s, p) => s + (p.authorizedMaxUsd ?? 0.5) * (p.settled?.accuracy ?? 0),
        0,
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// The decision cycle
// ---------------------------------------------------------------------------
export interface Decision {
  action: "buy" | "skip" | "halt" | "procure";
  seller?: string;
  reason: string;
}

/**
 * Pure decision logic, separated so it can be reasoned about (and tested)
 * without side effects. The agent answers, in order:
 *   1. Am I still inside my mandate?
 *   2. Do I have unresolved exposure already?
 *   3. Who is worth buying from right now?
 */
export function decide(): Decision {
  const p = state.prefs;
  const credit = creditLimit();

  if (state.spentThisSession >= p.sessionBudget) {
    return {
      action: "halt",
      reason: `session budget exhausted ($${state.spentThisSession.toFixed(2)} of $${p.sessionBudget.toFixed(2)} authorized)`,
    };
  }

  const open = all().filter((x) => !x.settled).length;
  if (open >= 3) {
    return {
      action: "skip",
      reason: `${open} positions still unresolved — waiting rather than stacking exposure`,
    };
  }

  const ranked = rankSellers().sort((x, y) => y.hitRate - x.hitRate);
  const best = ranked[0];

  if (best.hitRate < p.minSellerHitRate) {
    return {
      action: "procure",
      reason: `no seller clears my ${(p.minSellerHitRate * 100).toFixed(0)}% bar (best: ${best.name} at ${(best.hitRate * 100).toFixed(0)}%) — sourcing data outside the marketplace instead`,
    };
  }

  const record = best.resolved
    ? `${(best.hitRate * 100).toFixed(0)}% hit rate over ${best.resolved} settled`
    : "no settled history yet — starting neutral";

  return {
    action: "buy",
    seller: best.key,
    reason:
      `${best.name} leads on track record (${record}). ` +
      `Authorizing up to $${p.maxPerStrategy.toFixed(2)}; my credit limit is $${credit.limitUsd}`,
  };
}

export const noteSpend = (usd: number) => {
  state.spentThisSession += usd;
};
export const spent = () => state.spentThisSession;
export const resetSession = () => {
  state.spentThisSession = 0;
  state.log = [];
  state.listings = [];
};

// ---------------------------------------------------------------------------
// Sell side — the agent generates its OWN strategies and offers them
// ---------------------------------------------------------------------------
/**
 * The agent forms a view from market data and prices it for sale. It only
 * lists when it genuinely has conviction — a flat tape produces no listing,
 * because listing a low-conviction call means posting a bond it expects to
 * lose. The bond is what stops an agent spamming the market.
 */
export async function generateListing(asset = "ETH"): Promise<Listing | null> {
  const bps = await momentumBps(asset, 5);
  const strength = Math.min(Math.abs(bps) / 8, 1);
  const confidence = Number((0.5 + strength * 0.45).toFixed(2));

  // ~1.4bps of 5-minute movement. Low enough that a normal tape produces
  // listings during a demo, high enough that a genuinely flat tape still
  // makes the agent abstain — which is the more interesting behaviour.
  if (confidence < 0.58) {
    say(
      "observe",
      `Formed a view on ${asset} but conviction is only ${(confidence * 100).toFixed(0)}% — not listing`,
      `5m momentum ${bps >= 0 ? "+" : ""}${bps.toFixed(2)}bps. Listing would mean posting a $2.00 bond against a call I don't believe.`,
    );
    return null;
  }

  const listing: Listing = {
    id: crypto.randomUUID(),
    asset,
    direction: bps >= 0 ? "up" : "down",
    confidence,
    rationale: `5m momentum ${bps >= 0 ? "+" : ""}${bps.toFixed(2)}bps → continuation`,
    // Prices its own strategy off conviction — it asks for less when less sure.
    askUsd: Number((0.25 + confidence * 0.35).toFixed(2)),
    bondUsd: 2.0,
    createdAt: Date.now(),
    status: "listed",
  };
  state.listings.unshift(listing);
  if (state.listings.length > 20) state.listings.length = 20;

  say(
    "list",
    `Listed ${asset} ${listing.direction.toUpperCase()} at $${listing.askUsd.toFixed(2)}, backed by a $${listing.bondUsd.toFixed(2)} bond`,
    `${listing.rationale} · conviction ${(confidence * 100).toFixed(0)}%. If I'm wrong, the buyer pays nothing and takes my bond.`,
  );
  return listing;
}
