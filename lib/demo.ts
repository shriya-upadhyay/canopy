/**
 * SCRIPTED OUTCOMES — for the stage only.
 *
 * The problem this solves: over a 180-second horizon, ETH moves essentially at
 * random. So the demo beat you actually want to show — "Intelligent gets paid,
 * Random settles at $0 with no on-chain transaction" — is a coin flip in a
 * four-minute slot. You can easily get two partials in a row and the contrast
 * never lands.
 *
 * What this does NOT fake:
 *   the Permit2 signature, the authorization ceiling, the facilitator call,
 *   the settled amount, the on-chain transaction, the absence of one at 0%.
 * All of that is real, on Monad testnet, every time.
 *
 * What it DOES fake: the accuracy score that decides the settlement fraction.
 *
 * That distinction is the whole point, so say it out loud rather than hoping
 * nobody asks:
 *
 *   "The resolver is scripted for this demo so you can see both paths inside
 *    four minutes. The settlement underneath is real — that's the $0 row with
 *    no transaction hash."
 *
 * Judges respect a deliberately fired mechanism. They do not respect a rigged
 * outcome presented as luck, and they will find out, because the first
 * question is always "what happens if it's wrong?"
 *
 * Off by default. Enable in .env.local:
 *
 *   DEMO_OUTCOMES="a=0.95,b=0"
 *
 * Seller "a" (Intelligent) then always settles at 95%, seller "b" (Random)
 * always at 0%. Omit a seller to leave it scored against the real market.
 * Delete the line entirely and everything is live again.
 */

const parse = (): Record<string, number> => {
  const raw = process.env.DEMO_OUTCOMES?.trim();
  if (!raw) return {};

  const out: Record<string, number> = {};
  for (const pair of raw.split(",")) {
    const [key, value] = pair.split("=").map((s) => s?.trim());
    if (!key || value === undefined) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    out[key.toLowerCase()] = Math.max(0, Math.min(1, n));
  }
  return out;
};

/** Address -> letter, so DEMO_OUTCOMES can be written as "a=..,b=..". */
const letterFor = (addr: string): string | null => {
  const a = process.env.SELLER_A_ADDR?.toLowerCase();
  const b = process.env.SELLER_B_ADDR?.toLowerCase();
  const s = addr?.toLowerCase();
  if (s && s === a) return "a";
  if (s && s === b) return "b";
  return null;
};

export const demoMode = () => Object.keys(parse()).length > 0;

/**
 * The scripted accuracy for this seller, or null to score it for real.
 * Accepts either the seller letter or the wallet address.
 */
export function forcedAccuracyFor(sellerAddr: string): number | null {
  const table = parse();
  if (!Object.keys(table).length) return null;

  const byAddr = table[sellerAddr?.toLowerCase()];
  if (byAddr !== undefined) return byAddr;

  const letter = letterFor(sellerAddr);
  if (letter && table[letter] !== undefined) return table[letter];

  return null;
}
