// Seller endpoint. Verifies payment, serves the signal IMMEDIATELY,
// stashes the payload, and settles later once the resolver scores it.
//
//   1. no PAYMENT-SIGNATURE -> 402 + requirements
//   2. with signature       -> verifyPayment -> serve signal -> stash
//   3. (later) /api/resolve -> settlePayment with a % override
//
// Deliberately NOT using withX402: that wrapper settles inline, which
// defeats the whole point when the signal resolves 3 minutes later.
// See lib/pending.ts.
//
// Next 16: route handlers use the Web Request/Response API and are
// uncached by default. Reading headers makes this dynamic anyway.

import type { NextRequest } from "next/server";
import { server, signalRoute, initialized } from "@/lib/x402";
import { put } from "@/lib/pending";
import { spot } from "@/lib/prices";
import { randomUUID } from "node:crypto";

const MAX_PRICE = "$0.50";
const HORIZON_SEC = 180; // short — must resolve twice inside a 4-min demo

// Two sellers with different skill. The CONTRAST is the demo: one earns,
// one settles at $0 repeatedly. `?seller=b` selects the bad one; the default
// is unchanged, so existing callers keep working.
const AGENTS = {
  a: { addr: process.env.SELLER_A_ADDR!, name: "Meridian Alpha", skill: 0.85 },
  b: { addr: process.env.SELLER_B_ADDR!, name: "Kestrel Signals", skill: 0.2 },
} as const;

export async function GET(request: NextRequest) {
  const key = (request.nextUrl.searchParams.get("seller") ?? "a") as "a" | "b";
  const agent = AGENTS[key] ?? AGENTS.a;
  const SELLER = agent.addr;

  if (!SELLER) {
    return Response.json(
      { error: `SELLER_${key.toUpperCase()}_ADDR not set in .env.local` },
      { status: 500 }
    );
  }

  await initialized(); // fetches facilitator /supported — required, see lib/x402.ts

  const requirements = await server.buildPaymentRequirements(
    signalRoute(SELLER, MAX_PRICE)
  );

  if (requirements.length === 0) {
    // Guard: an empty accepts[] means the scheme/network isn't registered,
    // and the client gets a 402 it can never satisfy. Fail loudly instead.
    return Response.json(
      { error: "no payment requirements built — check scheme/network registration" },
      { status: 500 }
    );
  }

  const header = request.headers.get("PAYMENT-SIGNATURE");

  // --- 1. unpaid -> 402 with terms -----------------------------------------
  if (!header) {
    return Response.json(
      { error: "payment required" },
      {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": Buffer.from(
            JSON.stringify({ x402Version: 2, accepts: requirements })
          ).toString("base64"),
        },
      }
    );
  }

  // --- 2. verify -----------------------------------------------------------
  const payload = JSON.parse(Buffer.from(header, "base64").toString());
  const chosen = requirements[0];

  const verified = await server.verifyPayment(payload, chosen);
  if (!verified.isValid) {
    return Response.json(
      { error: "invalid payment", reason: verified.invalidReason },
      { status: 402 }
    );
  }

  // --- 3. serve now, settle later ------------------------------------------
  const asset = "ETH";
  const priceAtIssue = await spot(asset);
  const direction = Math.random() > 0.35 ? "up" : "down"; // TODO: real strategy
  const confidence = 0.5 + Math.random() * 0.5;
  const id = randomUUID();

  put({
    id,
    payload,
    requirements: chosen,
    seller: SELLER,
    asset,
    direction,
    confidence,
    horizonSec: HORIZON_SEC,
    priceAtIssue,
    issuedAt: Date.now(),
  });

  return Response.json({
    id,
    asset,
    direction,
    confidence: +confidence.toFixed(2),
    horizonSec: HORIZON_SEC,
    priceAtIssue,
    maxPrice: MAX_PRICE,
    note: `settles in ${HORIZON_SEC}s, scaled by realized accuracy`,
  });
}
