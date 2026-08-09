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
import type { Call } from "./strategy";

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
  /**
   * Every Nth cycle, buy from the seller it has sampled LEAST rather than the
   * one currently leading. 0 disables it.
   *
   * Without this the agent is purely greedy: it sorts by hit rate, takes the
   * top one, and that seller's lead becomes self-reinforcing because it is the
   * only one still being sampled. Simulated over 8 cycles, the runner-up was
   * bought exactly zero times. That is a broken agent, not a cautious one —
   * it cannot notice a seller that improved, and it cannot notice its own
   * favourite degrading, because it stopped collecting evidence about both.
   *
   * A track record is only worth anything if you keep paying to refresh it.
   * Exploration is what that costs.
   */
  exploreEvery: number;
  running: boolean;
}

export const DEFAULT_PREFS: Preferences = {
  assets: ["ETH"],
  maxPerStrategy: 0.5,
  sessionBudget: 3.0,
  minSellerHitRate: 0.3,
  intervalSec: 20,
  exploreEvery: 3,
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
  /** Buy decisions made this session. Drives the exploration cadence. */
  buyCycles: number;
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
  /** "momentum" = derived in-house from the marketplace's own feed.
   *  "external" = derived from data just bought via the Rain boundary —
   *  closes the loop between paying for outside data and reselling insight. */
  source: "momentum" | "external";
}

const g = globalThis as unknown as { __canopyAgent?: State };
const state: State = (g.__canopyAgent ??= {
  prefs: { ...DEFAULT_PREFS },
  log: [],
  lastTick: 0,
  spentThisSession: 0,
  listings: [],
  buyCycles: 0,
});
// Older persisted state may predate these fields.
state.buyCycles ??= 0;
state.prefs.exploreEvery ??= DEFAULT_PREFS.exploreEvery;

/** Called once per buy decision, so exploration runs on a countable cadence. */
export const countBuyCycle = () => ++state.buyCycles;

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

/**
 * Settled samples after which a below-bar seller stops being explored.
 *
 * Tuned for a live demo rather than for statistics: at the default 20s cycle
 * and exploreEvery=3, a cap of 2 puts the write-off at roughly the 3.5 minute
 * mark, so it lands inside a four-minute slot. A cap of 3 pushes it past 4
 * minutes and the audience never sees the agent finish learning.
 *
 * Two samples is thin evidence in reality. That is an honest limitation of a
 * hackathon demo, not a claim about how you would tune this for real money.
 */
export const EXPLORE_SAMPLE_CAP = 2;

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

  // EXPLOIT vs EXPLORE.
  //
  // Exploiting means buying from the leader. Doing only that is what makes the
  // leader permanently the leader: it is the only seller still generating
  // evidence, so nobody else's estimate can ever move. Every so often the
  // agent deliberately spends on its least-sampled seller to keep the
  // comparison honest.
  //
  // The cost is bounded and known: one ceiling of maxPerStrategy, and under
  // `upto` a wrong strategy settles that at $0 anyway. Exploration is close to
  // free here precisely because payment is conditional, which is not true of
  // any marketplace that charges up front.
  const explore =
    p.exploreEvery > 0 && state.buyCycles > 0 && state.buyCycles % p.exploreEvery === 0;

  if (explore) {
    const probe = [...ranked]
      .filter((s) => s.key !== best.key)
      // DECAY. Exploration is for reducing uncertainty, and past a few samples
      // there isn't much left to reduce. Once a seller has been tested this
      // many times and is still under the mandate's bar, the agent stops
      // paying to re-learn the same thing and writes it off.
      //
      // This is the difference between an agent that explores and an agent
      // that just has a random tic. Judges will ask why it keeps buying from
      // a seller it has already established is bad — this is the answer, and
      // the cut-off is visible in the activity log when it happens.
      .filter((s) => s.resolved < EXPLORE_SAMPLE_CAP || s.hitRate >= p.minSellerHitRate)
      // Least-sampled first; ties broken toward the weaker record, since that
      // is the estimate we know least about.
      .sort((x, y) => x.resolved - y.resolved || x.hitRate - y.hitRate)[0];

    if (probe) {
      const seen = probe.resolved
        ? `${probe.resolved} settled, ${(probe.hitRate * 100).toFixed(0)}% hit rate`
        : "never sampled";
      return {
        action: "buy",
        seller: probe.key,
        reason:
          `Exploring: buying ${probe.name} (${seen}) instead of ${best.name}, ` +
          `to keep its track record current rather than assume it. ` +
          `Risking a $${p.maxPerStrategy.toFixed(2)} ceiling; if it is wrong that settles at $0`,
      };
    }

    // Everyone else is written off. Worth saying out loud once, because this
    // is the agent reporting that it has finished learning something.
    const done = ranked
      .filter((s) => s.key !== best.key)
      .map((s) => `${s.name} ${(s.hitRate * 100).toFixed(0)}% over ${s.resolved}`)
      .join(", ");
    say(
      "decide",
      "Stopped exploring",
      `${done} — below my ${(p.minSellerHitRate * 100).toFixed(0)}% bar after ${EXPLORE_SAMPLE_CAP}+ settled strategies. ` +
        `Consolidating on ${best.name}.`,
    );
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
  // Otherwise a second demo run starts mid-cadence and explores at an
  // unpredictable point, which is exactly what you don't want on stage.
  state.buyCycles = 0;
};

// ---------------------------------------------------------------------------
// Sell side — the agent generates its OWN strategies and offers them
// ---------------------------------------------------------------------------
/**
 * The agent forms a view and prices it for sale. It only lists when it
 * genuinely has conviction — a flat/uninformative view produces no listing.
 *
 * `boughtView`, when passed, is data just purchased via the Rain boundary
 * (see lib/external-data.ts) — the agent resells insight it paid for instead
 * of only ever reselling its own in-house momentum read. Omit it and this
 * falls back to deriving momentum itself, same as before.
 */
export async function generateListing(
  asset = "ETH",
  boughtView?: Call,
): Promise<Listing | null> {
  const source: Listing["source"] = boughtView ? "external" : "momentum";

  let call: Call;
  if (boughtView) {
    call = boughtView;
  } else {
    const bps = await momentumBps(asset, 5);
    const strength = Math.min(Math.abs(bps) / 8, 1);
    call = {
      direction: bps >= 0 ? "up" : "down",
      confidence: Number((0.5 + strength * 0.45).toFixed(2)),
      rationale: `5m momentum ${bps >= 0 ? "+" : ""}${bps.toFixed(2)}bps → continuation`,
    };
  }

  // ~1.4bps of 5-minute momentum clears this bar; the external order-book
  // signal is calibrated to the same floor. Low enough that a normal tape
  // produces listings during a demo, high enough that a genuinely flat/
  // balanced read still makes the agent abstain — the more interesting
  // behaviour either way.
  if (call.confidence < 0.58) {
    say(
      "observe",
      `Formed a view on ${asset} but conviction is only ${(call.confidence * 100).toFixed(0)}% — not listing`,
      `${call.rationale}. Listing would mean posting a $2.00 bond against a call I don't believe.`,
    );
    return null;
  }

  const listing: Listing = {
    id: crypto.randomUUID(),
    asset,
    direction: call.direction,
    confidence: call.confidence,
    rationale: call.rationale,
    source,
    // Prices its own strategy off conviction — it asks for less when less sure.
    askUsd: Number((0.25 + call.confidence * 0.35).toFixed(2)),
    bondUsd: 2.0,
    createdAt: Date.now(),
    status: "listed",
  };
  state.listings.unshift(listing);
  if (state.listings.length > 20) state.listings.length = 20;

  say(
    "list",
    `Listed ${asset} ${listing.direction.toUpperCase()} at $${listing.askUsd.toFixed(2)}, backed by a $${listing.bondUsd.toFixed(2)} bond`,
    source === "external"
      ? `${listing.rationale} · conviction ${(call.confidence * 100).toFixed(0)}%. Derived from data just bought via Rain — reselling purchased insight.`
      : `${listing.rationale} · conviction ${(call.confidence * 100).toFixed(0)}%. If I'm wrong, the buyer pays nothing and takes my bond.`,
  );
  return listing;
}
