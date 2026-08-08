// Dashboard feed: every strategy, what it settled for, and the agent's
// current earned credit limit. One poll, everything the demo needs on screen.

import { all } from "@/lib/pending";
import { creditLimit } from "@/lib/credit";
import { txUrl } from "@/lib/const";

const NAMES: Record<string, string> = {
  [(process.env.SELLER_A_ADDR ?? "a").toLowerCase()]: "Intelligent",
  [(process.env.SELLER_B_ADDR ?? "b").toLowerCase()]: "Random",
};

export async function GET() {
  const strategies = all().map((p) => {
    const acc = p.settled?.accuracy;
    const authorizedMaxUsd = p.authorizedMaxUsd ?? 0.5;
    return {
      id: p.id,
      seller: NAMES[p.seller?.toLowerCase()] ?? p.seller,
      strategyName: p.strategyName ?? NAMES[p.seller?.toLowerCase()] ?? p.seller,
      sellerAddr: p.seller,
      asset: p.asset,
      direction: p.direction,
      confidence: +p.confidence.toFixed(2),
      priceAtIssue: p.priceAtIssue,
      issuedAt: p.issuedAt,
      resolvesAt: p.issuedAt + p.horizonSec * 1000,
      status: p.settled
        ? acc === 0
          ? "zero"
          : acc! >= 0.999
            ? "full"
            : "partial"
        : "pending",
      accuracy: acc,
      authorizedMax: p.authorizedMax ?? `$${authorizedMaxUsd.toFixed(2)}`,
      authorizedMaxUsd,
      settled: p.settled ? `$${(authorizedMaxUsd * acc!).toFixed(4)}` : null,
      pct: p.settled?.amountPct ?? null,
      txHash: p.settled?.txHash ?? null,
      txUrl: p.settled?.txHash ? txUrl(p.settled.txHash) : null,
      // acc === 0 -> no txHash, because nothing settled on-chain. The demo.
      onChain: Boolean(p.settled?.txHash),
      bond: p.bond
        ? {
            amount: p.bond.amount,
            status: p.bondSettled ? (p.bondSettled.slashed ? "slashed" : "released") : "posted",
            txHash: p.bondSettled?.txHash ?? null,
            txUrl: p.bondSettled?.txHash ? txUrl(p.bondSettled.txHash) : null,
          }
        : null,
    };
  });

  return Response.json({ credit: creditLimit(), strategies });
}
