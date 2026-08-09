// THE AGENT LOOP.
//
// GET   → agent state: preferences, activity log, seller rankings, listings
// POST  → run ONE decision cycle (the dashboard drives this on a timer)
// PUT   → update preferences (the human's mandate)
//
// The dashboard is this agent's point of view. It shows what the agent
// decided and why — nobody is clicking "buy".

import { NextRequest } from "next/server";
import {
  prefs,
  setPrefs,
  log,
  say,
  decide,
  rankSellers,
  noteSpend,
  countBuyCycle,
  spent,
  listings,
  generateListing,
  resetSession,
} from "@/lib/agent";
import { creditLimit } from "@/lib/credit";
import { all } from "@/lib/pending";
import { procureExternalSignal } from "@/lib/external-data";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    prefs: prefs(),
    log: log(),
    sellers: rankSellers(),
    listings: listings(),
    spent: spent(),
    credit: creditLimit(),
    open: all().filter((p) => !p.settled).length,
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const updated = setPrefs(body);
  if (body.reset) resetSession();

  say(
    "observe",
    updated.running
      ? "Mandate accepted — operating autonomously"
      : "Paused by operator",
    `Assets ${updated.assets.join(", ")} · max $${updated.maxPerStrategy.toFixed(2)}/strategy · ` +
      `session budget $${updated.sessionBudget.toFixed(2)} · ` +
      `min seller hit rate ${(updated.minSellerHitRate * 100).toFixed(0)}% · ` +
      `cycle ${updated.intervalSec}s`,
  );
  return Response.json({ prefs: updated });
}

/** One decision cycle. */
export async function POST(req: NextRequest) {
  const p = prefs();
  if (!p.running) return Response.json({ skipped: "paused" });

  const origin = req.nextUrl.origin;
  const asset = p.assets[0] ?? "ETH";
  const d = decide();

  try {
    // ── BUY ────────────────────────────────────────────────────────────────
    if (d.action === "buy" && d.seller) {
      say("decide", `Chose ${d.seller === "a" ? "Intelligent" : "Random"}`, d.reason);

      const r = await fetch(
        `${origin}/api/buy?seller=${d.seller}&asset=${encodeURIComponent(asset)}&max=${p.maxPerStrategy.toFixed(2)}`,
        { method: "POST" },
      );
      const j = await r.json();

      if (j.error) {
        say("skip", "Purchase failed", j.hint ?? j.error);
        return Response.json({ action: "buy", error: j.error });
      }

      noteSpend(p.maxPerStrategy);
      // Only count purchases that actually went through, so a run of failed
      // buys can't silently advance the cadence and skip an exploration turn.
      countBuyCycle();
      say(
        "buy",
        `Bought ${j.asset} ${String(j.direction).toUpperCase()} — authorized up to $${p.maxPerStrategy.toFixed(2)}`,
        `${j.rationale ?? ""} · conviction ${(j.confidence * 100).toFixed(0)}% · ` +
          `resolves in ${j.horizonSec}s. Nothing has moved yet — settlement is scored on the outcome.`,
      );

      // The agent is not only a buyer. Each cycle it also forms a view from
      // market data and, when conviction clears the bar, lists its own strategy.
      await generateListing(asset);
      return Response.json({ action: "buy", strategy: j });
    }

    // ── PROCURE (Rain boundary) ────────────────────────────────────────────
    // No seller is worth buying from, so the agent goes OUTSIDE the
    // marketplace for data — with its own scoped card, inside policy.
    if (d.action === "procure") {
      say("decide", "No seller worth paying", d.reason);

      const r = await fetch(`${origin}/api/rain/purchase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountCents: 199,
          mcc: "5734",
          merchantName: "Kaiko Market Data",
        }),
      });
      const j = await r.json();

      if (j.outcome === "declined") {
        say("halt", `Blocked by policy — ${j.reason}`, "Rain declined before any money moved.");
      } else if (j.error) {
        say("skip", "External purchase failed", j.error);
      } else {
        say(
          "procure",
          `Bought external market data for $${j.amountUsd} with a scoped card`,
          `${j.merchant} · card ••${j.card?.last4} · limit $${j.policy?.limitUsd} earned from track record. ` +
            `Card was issued for this one purchase and is now spent.`,
        );
        // Closing the loop: form the view FROM the data just bought (an
        // order-book read the marketplace's own momentum feed never sees —
        // see lib/external-data.ts) and offer THAT for resale, instead of
        // independently re-deriving momentum like the default path does.
        try {
          const boughtView = await procureExternalSignal(asset);
          await generateListing(asset, boughtView);
        } catch (e) {
          say(
            "skip",
            "Purchased data unusable",
            e instanceof Error ? e.message : String(e),
          );
        }
      }
      return Response.json({ action: "procure", result: j });
    }

    // ── SKIP / HALT ────────────────────────────────────────────────────────
    say(d.action === "halt" ? "halt" : "skip", d.reason);
    return Response.json({ action: d.action, reason: d.reason });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say("skip", "Cycle error", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
