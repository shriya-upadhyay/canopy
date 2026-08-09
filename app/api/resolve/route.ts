// Resolver. Scores every due strategy and settles it for a FRACTION of the
// authorized max. Poll from the dashboard every ~5s, or fire it live on
// stage — this is the moment the pitch turns on.
//
// accuracy 0 -> "0.00%" -> $0 settled, NO on-chain transaction.

import { due, markSettled, markBondSettled, markBondError, all } from "@/lib/pending";
import { spot, accuracy as score } from "@/lib/prices";
import { settleForAccuracy, initialized } from "@/lib/x402";
import { resolveBond } from "@/lib/bond";
import { SELLERS } from "@/lib/sellers";
import { giveFeedback, agentId as erc8004AgentId } from "@/lib/erc8004";
import { forcedAccuracyFor } from "@/lib/demo";

export async function POST() {
  await initialized();
  const results = [];

  for (const p of due()) {
    const priceNow = await spot(p.asset, true);

    // DEMO_OUTCOMES can pin a seller's score so both settlement paths are
    // guaranteed to appear inside a four-minute slot. Everything downstream
    // of this line — signature, facilitator, on-chain tx — stays real. See
    // lib/demo.ts. Unset in .env.local and this is a no-op.
    const forced = forcedAccuracyFor(p.seller);
    const acc =
      forced ?? score(p.direction, p.priceAtIssue, priceNow, p.confidence);

    const res = await settleForAccuracy(p.payload, p.requirements, acc);
    const txHash = (res as { transaction?: string })?.transaction;

    const settled = {
      accuracy: acc,
      amountPct: `${(acc * 100).toFixed(2)}%`,
      txHash,
      at: Date.now(),
      forced: forced !== null,
    };
    markSettled(p.id, settled);

    // Resolve the seller's bond off the same accuracy score, if this signal
    // has one (bond creation is disabled going forward — see
    // app/api/strategy/route.ts — so this only fires for signals already in
    // memory from before that change). Own try/catch: the buyer's payment
    // above already committed, so a bond failure must not throw and 500 this
    // whole batch, stranding every other due() signal with it.
    let bondSettled;
    if (p.bond) {
      try {
        const b = await resolveBond(p.bond.payload, p.bond.requirements, acc);
        bondSettled = { slashed: b.slashed, amountPct: b.amountPct, txHash: b.txHash, at: Date.now() };
        markBondSettled(p.id, bondSettled);
      } catch (e) {
        markBondError(p.id, e instanceof Error ? e.message : String(e));
        console.error(`bond resolution failed for ${p.id}:`, e);
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

    results.push({
      id: p.id,
      asset: p.asset,
      direction: p.direction,
      priceAtIssue: p.priceAtIssue,
      priceNow,
      ...settled,
      // acc === 0 -> no txHash, because nothing settled on-chain. The demo.
      onChain: Boolean(txHash),
      bond: bondSettled ?? null,
      feedback,
    });
  }

  return Response.json({ settled: results.length, results });
}

export async function GET() {
  return Response.json({ strategies: all() });
}
