// Resolver. Scores every due signal and settles it for a FRACTION of the
// authorized max. Poll from the dashboard every ~5s, or fire it live on
// stage — this is the moment the pitch turns on.
//
// accuracy 0 -> "0.00%" -> $0 settled, NO on-chain transaction.

import { due, markSettled, all } from "@/lib/pending";
import { spot, accuracy as score } from "@/lib/prices";
import { settleForAccuracy, initialized } from "@/lib/x402";

export async function POST() {
  await initialized();
  const results = [];

  for (const p of due()) {
    const priceNow = await spot(p.asset);
    const acc = score(p.direction, p.priceAtIssue, priceNow, p.confidence);

    const res = await settleForAccuracy(p.payload, p.requirements, acc);
    const txHash = (res as { transaction?: string })?.transaction;

    const settled = {
      accuracy: acc,
      amountPct: `${(acc * 100).toFixed(2)}%`,
      txHash,
      at: Date.now(),
    };
    markSettled(p.id, settled);

    results.push({
      id: p.id,
      asset: p.asset,
      direction: p.direction,
      priceAtIssue: p.priceAtIssue,
      priceNow,
      ...settled,
      // acc === 0 -> no txHash, because nothing settled on-chain. The demo.
      onChain: Boolean(txHash),
    });

    // TODO: ERC-8004 reputation feedback via agent0 SDK.
    // Reputation registry 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
    // value = acc, tags ["directional", p.asset]
  }

  return Response.json({ settled: results.length, results });
}

export async function GET() {
  return Response.json({ signals: all() });
}
