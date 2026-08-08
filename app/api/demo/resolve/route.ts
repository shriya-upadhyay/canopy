// Resolve-now control for the stage.
//
// You cannot stand in front of judges for 180 seconds waiting on a horizon.
// This settles a specific signal immediately.
//
//   POST /api/demo/resolve?id=<signalId>              -> score it against the
//                                                        real spot price now
//   POST /api/demo/resolve?id=<signalId>&accuracy=0   -> force the $0 path
//
// The forced variant is not a fake market. It's a manual settlement trigger,
// so you can demonstrate the zero-settlement path on demand instead of hoping
// a coin flip goes your way inside a four-minute slot. Say that out loud —
// judges respect "here is the mechanism, fired deliberately" far more than a
// rigged outcome presented as luck.

import { NextRequest } from "next/server";
import { get, markSettled } from "@/lib/pending";
import { spot, accuracy as score } from "@/lib/prices";
import { settleForAccuracy, initialized } from "@/lib/x402";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await initialized();

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    const p = get(id);
    if (!p) return Response.json({ error: "unknown signal" }, { status: 404 });
    if (p.settled) return Response.json({ error: "already settled", signal: p }, { status: 409 });

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

    return Response.json({
      id,
      forced: forced !== null,
      priceAtIssue: p.priceAtIssue,
      priceNow,
      ...settled,
      settledUsd: `$${(0.5 * acc).toFixed(4)}`,
      // acc === 0 -> no txHash, because nothing settled on-chain. The demo.
      onChain: Boolean(txHash),
      success: (res as { success?: boolean })?.success,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
