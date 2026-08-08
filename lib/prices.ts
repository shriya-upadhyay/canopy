// Spot prices. Crypto because it moves fast enough to resolve a
// 3-minute horizon during a live demo — equities won't.
// Swap for whatever's reachable on the venue wifi.

const CACHE = new Map<string, { p: number; t: number }>();

const IDS: Record<string, string> = {
  ETH: "ethereum",
  BTC: "bitcoin",
  SOL: "solana",
};

export async function spot(asset: string): Promise<number> {
  const hit = CACHE.get(asset);
  if (hit && Date.now() - hit.t < 5_000) return hit.p;

  const id = IDS[asset] ?? "ethereum";
  const r = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
    { cache: "no-store" }
  );
  if (!r.ok) throw new Error(`price feed ${r.status}`);
  const j = await r.json();
  const p = j[id].usd as number;

  CACHE.set(asset, { p, t: Date.now() });
  return p;
}

/**
 * Score a directional call.
 *   wrong direction        -> 0.0  (settles $0, no on-chain tx)
 *   right but tiny move    -> partial
 *   right and >=50bps move -> 1.0
 *
 * Scaled by the seller's stated confidence, so overconfident-and-wrong
 * is punished and hedged-and-right is only partially rewarded. That
 * asymmetry is what makes honest confidence the profit-maximising move —
 * worth saying out loud to the judges.
 */
export function accuracy(
  direction: "up" | "down",
  before: number,
  after: number,
  confidence: number
): number {
  const bps = ((after - before) / before) * 10_000;
  const correct = direction === "up" ? bps > 0 : bps < 0;
  if (!correct) return 0;

  const magnitude = Math.min(Math.abs(bps) / 50, 1); // 50bps = full credit
  return Math.max(0, Math.min(1, magnitude * confidence));
}
