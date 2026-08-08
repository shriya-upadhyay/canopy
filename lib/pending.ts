// In-memory store of verified-but-unsettled signals.
//
// This exists because of the one architectural catch in the whole build:
// the default `withX402` wrapper verifies AND settles inside a single
// request. Your signal doesn't resolve for another 2-3 minutes, so you
// cannot use it. Verify and settle are separate facilitator calls
// (POST /verify, POST /settle), so splitting them is supported —
// you just have to hold the payload yourself in between.
//
// In-memory is fine. It's a hackathon and the whole lifecycle is ~3 min.

export type Pending = {
  id: string;
  payload: unknown;       // PaymentPayload from the PAYMENT-SIGNATURE header
  requirements: unknown;  // the PaymentRequirements we verified against
  seller: string;
  sellerAgentId?: string; // ERC-8004 token id
  asset: string;          // e.g. "ETH"
  direction: "up" | "down";
  confidence: number;     // 0..1, seller's own stated conviction
  horizonSec: number;
  priceAtIssue: number;
  issuedAt: number;
  settled?: {
    accuracy: number;
    amountPct: string;
    txHash?: string;      // absent when accuracy === 0 -> no on-chain tx
    at: number;
  };
};

const store = new Map<string, Pending>();

export const put = (p: Pending) => void store.set(p.id, p);
export const get = (id: string) => store.get(id);
export const all = () => [...store.values()].sort((a, b) => b.issuedAt - a.issuedAt);

/** Signals whose horizon has elapsed and which haven't settled yet. */
export const due = () =>
  [...store.values()].filter(
    (p) => !p.settled && Date.now() >= p.issuedAt + p.horizonSec * 1000
  );

export const markSettled = (id: string, s: Pending["settled"]) => {
  const p = store.get(id);
  if (p) p.settled = s;
};
