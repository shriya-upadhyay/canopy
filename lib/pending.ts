import type { server } from "./x402";

type PaymentPayload = Parameters<typeof server.settlePayment>[0];
type PaymentRequirements = Parameters<typeof server.settlePayment>[1];

// In-memory store of verified-but-unsettled strategies.
//
// This exists because of the one architectural catch in the whole build:
// the default `withX402` wrapper verifies AND settles inside a single
// request. Your strategy doesn't resolve for another 2-3 minutes, so you
// cannot use it. Verify and settle are separate facilitator calls
// (POST /verify, POST /settle), so splitting them is supported —
// you just have to hold the payload yourself in between.
//
// In-memory is fine. It's a hackathon and the whole lifecycle is ~3 min.

export type Pending = {
  id: string;
  payload: PaymentPayload;       // PaymentPayload from the PAYMENT-SIGNATURE header
  requirements: PaymentRequirements;  // the PaymentRequirements we verified against
  seller: string;
  sellerAgentId?: string; // ERC-8004 token id
  strategyName?: string;
  authorizedMax: string;
  authorizedMaxUsd: number;
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
  /** Seller's skin-in-the-game, posted at listing time. See lib/bond.ts. */
  bond?: {
    payload: unknown;
    requirements: unknown;
    amount: string;       // e.g. "$2.00"
  };
  bondSettled?: {
    slashed: boolean;     // true -> seller paid the buyer; false -> released
    amountPct: string;
    txHash?: string;      // absent when released -> no on-chain tx
    at: number;
  };
  /** Set when resolveBond throws. Bond creation is currently disabled (see
   *  app/api/strategy/route.ts), so this only matters for signals already in
   *  memory from before that change. */
  bondError?: string;
};

const store = new Map<string, Pending>();

export const put = (p: Pending) => void store.set(p.id, p);
export const get = (id: string) => store.get(id);
export const all = () => [...store.values()].sort((a, b) => b.issuedAt - a.issuedAt);

/** Strategies whose horizon has elapsed and which haven't settled yet. */
export const due = () =>
  [...store.values()].filter(
    (p) => !p.settled && Date.now() >= p.issuedAt + p.horizonSec * 1000
  );

export const markSettled = (id: string, s: Pending["settled"]) => {
  const p = store.get(id);
  if (p) p.settled = s;
};

export const markBondSettled = (id: string, s: Pending["bondSettled"]) => {
  const p = store.get(id);
  if (p) {
    p.bondSettled = s;
    p.bondError = undefined;
  }
};

export const markBondError = (id: string, message: string) => {
  const p = store.get(id);
  if (p) p.bondError = message;
};
