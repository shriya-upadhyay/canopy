// Resolve-now control for the stage.
//
// You cannot stand in front of judges for 180 seconds waiting on a horizon.
// This settles a specific strategy immediately.
//
//   POST /api/demo/resolve?id=<strategyId>              -> score it against the
//                                                        real spot price now
//   POST /api/demo/resolve?id=<strategyId>&accuracy=0   -> force the $0 path
//
// The forced variant is not a fake market. It's a manual settlement trigger,
// so you can demonstrate the zero-settlement path on demand instead of hoping
// a coin flip goes your way inside a four-minute slot. Say that out loud —
// judges respect "here is the mechanism, fired deliberately" far more than a
// rigged outcome presented as luck.

import { NextRequest } from "next/server";
import { get, markSettled, markBondSettled, markBondError } from "@/lib/pending";
import { spot, accuracy as score } from "@/lib/prices";
import { settleForAccuracy, initialized } from "@/lib/x402";
import { resolveBond } from "@/lib/bond";
import { SELLERS } from "@/lib/sellers";
import { giveFeedback, agentId as erc8004AgentId } from "@/lib/erc8004";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await initialized();

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    const p = get(id);
    if (!p) return Response.json({ error: "unknown strategy" }, { status: 404 });
    if (p.settled) return Response.json({ error: "already settled", strategy: p }, { status: 409 });

    const forced = req.nextUrl.searchParams.get("accuracy");
    const priceNow = await spot(p.asset);
    const acc =
      forced !== null
        ? Math.max(0, Math.min(1, Number(forced)))
        : score(p.direction, p.priceAtIssue, priceNow, p.confidence);

    const res = await settleForAccuracy(p.payload, p.requirements, acc);
    const txHash = (res as { transaction?: string })?.transaction;

    const settled = {
      accuracy: acc,
      amountPct: `${(acc * 100).toFixed(2)}%`,
      txHash,
      at: Date.now(),
    };
    markSettled(id, settled);

    // Same accuracy score slashes or releases the seller's bond, if this
    // signal has one (bond creation is disabled going forward — see
    // app/api/strategy/route.ts — so this only fires for signals already in
    // memory from before that change). Own try/catch: the auto-resolve loop
    // in app/page.tsx calls this endpoint on a timer, and an uncaught bond
    // failure here was surfacing as "Auto-resolve failed: unsupported_scheme"
    // in the dashboard on every poll.
    let bondSettled;
    if (p.bond) {
      try {
        const b = await resolveBond(p.bond.payload, p.bond.requirements, acc);
        bondSettled = { slashed: b.slashed, amountPct: b.amountPct, txHash: b.txHash, at: Date.now() };
        markBondSettled(id, bondSettled);
      } catch (e) {
        markBondError(id, e instanceof Error ? e.message : String(e));
        console.error(`bond resolution failed for ${id}:`, e);
      }
    }

    // ERC-8004: buyer reviews the seller off the same accuracy score. Skipped
    // (not failed) if the seller has no registered agent yet — see
    // scripts/register-agents.mjs.
    const seller = Object.values(SELLERS).find(
      (s) => s.wallet.toLowerCase() === p.seller.toLowerCase()
    );
    const feedback = seller?.erc8004TokenId
      ? await giveFeedback(erc8004AgentId(seller.erc8004TokenId), acc, p.asset)
      : null;

    return Response.json({
      id,
      forced: forced !== null,
      priceAtIssue: p.priceAtIssue,
      priceNow,
      ...settled,
      settledUsd: `$${((p.authorizedMaxUsd ?? 0.5) * acc).toFixed(4)}`,
      // acc === 0 -> no txHash, because nothing settled on-chain. The demo.
      onChain: Boolean(txHash),
      success: (res as { success?: boolean })?.success,
      bond: bondSettled ?? null,
      feedback,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
