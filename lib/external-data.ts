/**
 * "PURCHASED" EXTERNAL DATA — stand-in for what a real paid vendor (e.g.
 * Kaiko) would hand back through the Rain boundary purchase.
 *
 * Rain's sandbox only simulates the payment rail (authorize/settle) — it has
 * no real data payload to return. Rather than fabricate a random number and
 * call it "purchased data," this pulls a REAL, freely-available signal from
 * a source the agent's own marketplace strategies never touch: Coinbase's
 * public order book (bid/ask depth imbalance), instead of the 1-minute
 * candle momentum lib/strategy.ts already uses. It's genuinely different
 * information. The only thing mocked is that a real vendor would gate this
 * behind an API key the Rain card pays for; here it's just called right
 * after a successful Rain purchase, not actually authenticated by it.
 */

import type { Call } from "./strategy";

const PRODUCT: Record<string, string> = {
  ETH: "ETH-USD",
  BTC: "BTC-USD",
  SOL: "SOL-USD",
};

type BookLevel = [string, string, number];

function levelVolume(levels: BookLevel[], depth: number): number {
  return levels.slice(0, depth).reduce((sum, [, size]) => sum + Number(size), 0);
}

/**
 * Order-book depth imbalance in the top `depth` price levels.
 * More resting bid volume than ask volume -> net buying pressure -> "up".
 */
export async function procureExternalSignal(asset: string, depth = 10): Promise<Call> {
  const product = PRODUCT[asset] ?? "ETH-USD";
  const r = await fetch(
    `https://api.exchange.coinbase.com/products/${product}/book?level=2`,
    { cache: "no-store", headers: { "User-Agent": "canopy" }, signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) throw new Error(`order book ${r.status}`);

  const book = (await r.json()) as { bids: BookLevel[]; asks: BookLevel[] };
  const bidVol = levelVolume(book.bids ?? [], depth);
  const askVol = levelVolume(book.asks ?? [], depth);
  const total = bidVol + askVol;
  if (total === 0) throw new Error("order book empty");

  const imbalance = (bidVol - askVol) / total; // -1..1

  const direction: "up" | "down" = imbalance >= 0 ? "up" : "down";
  const confidence = Number((0.55 + Math.min(Math.abs(imbalance), 1) * 0.35).toFixed(2));

  return {
    direction,
    confidence,
    rationale:
      `order-book imbalance ${(imbalance * 100).toFixed(1)}% ` +
      `(top ${depth} levels: bid ${bidVol.toFixed(2)} vs ask ${askVol.toFixed(2)}) — ` +
      `bought via Rain boundary, not derivable from the marketplace's own momentum feed`,
  };
}
