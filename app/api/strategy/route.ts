// Seller endpoint. Verifies payment, serves the strategy IMMEDIATELY,
// stashes the payload, and settles later once the resolver scores it.
//
//   1. no PAYMENT-SIGNATURE -> 402 + requirements
//   2. with signature       -> verifyPayment -> serve strategy -> stash
//   3. (later) /api/resolve -> settlePayment with a % override
//
// Deliberately NOT using withX402: that wrapper settles inline, which
// defeats the whole point when the strategy resolves 3 minutes later.
// See lib/pending.ts.
//
// Next 16: route handlers use the Web Request/Response API and are
// uncached by default. Reading headers makes this dynamic anyway.

import type { NextRequest } from "next/server";
import { server, strategyRoute, initialized } from "@/lib/x402";
import { put } from "@/lib/pending";
import { spot } from "@/lib/prices";
import { decide } from "@/lib/strategy";
import { createBond, DEFAULT_BOND } from "@/lib/bond";
import { randomUUID } from "node:crypto";

const DEFAULT_MAX_PRICE_USD = 0.5;
const HORIZON_SEC = 180; // short — must resolve twice inside a 4-min demo
const ASSETS = new Set(["ETH", "BTC", "SOL"]);

// Two sellers with different skill. The CONTRAST is the demo: one earns,
// one settles at $0 repeatedly. `?seller=b` selects the bad one; the default
// is unchanged, so existing callers keep working.
const AGENTS = {
  a: {
    addr: process.env.SELLER_A_ADDR!,
    pk: process.env.SELLER_A_PK as `0x${string}` | undefined,
    name: "Intelligent",
    skill: 0.85,
  },
  b: {
    addr: process.env.SELLER_B_ADDR!,
    pk: process.env.SELLER_B_PK as `0x${string}` | undefined,
    name: "Random",
    skill: 0.2,
  },
} as const;

function maxPriceFromRequest(request: NextRequest) {
  const raw = Number(request.nextUrl.searchParams.get("max") ?? DEFAULT_MAX_PRICE_USD);
  const usd = Number.isFinite(raw) ? Math.max(0.01, Math.min(5, raw)) : DEFAULT_MAX_PRICE_USD;
  return {
    usd,
    label: `$${usd.toFixed(2)}`,
  };
}

export async function GET(request: NextRequest) {
  const key = (request.nextUrl.searchParams.get("seller") ?? "a") as "a" | "b";
  const agent = AGENTS[key] ?? AGENTS.a;
  const SELLER = agent.addr;
  const requestedAsset = (request.nextUrl.searchParams.get("asset") ?? "ETH").toUpperCase();
  const asset = ASSETS.has(requestedAsset) ? requestedAsset : "ETH";
  const maxPrice = maxPriceFromRequest(request);

  if (!SELLER) {
    return Response.json(
      { error: `SELLER_${key.toUpperCase()}_ADDR not set in .env.local` },
      { status: 500 }
    );
  }

  await initialized(); // fetches facilitator /supported — required, see lib/x402.ts

  const requirements = await server.buildPaymentRequirements(
    strategyRoute(SELLER, maxPrice.label)
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

  // --- 3. seller posts its bond ---------------------------------------------
  // Skin in the game: a reverse-direction `upto` authorization payable to the
  // buyer. Wrong strategy -> slashed at resolution. See lib/bond.ts. Best-effort:
  // a bond failure (e.g. seller wallet unfunded) shouldn't break strategy
  // delivery, it just means this listing has no stake behind it.
  const buyerAddr = process.env.BUYER_ADDR;
  let bond: { payload: unknown; requirements: unknown; amount: string } | undefined;
  if (agent.pk && buyerAddr) {
    try {
      const { payload: bondPayload, requirements: bondReqs } = await createBond(
        agent.pk,
        buyerAddr
      );
      bond = { payload: bondPayload, requirements: bondReqs, amount: DEFAULT_BOND };
    } catch (e) {
      console.error("bond post failed, listing without stake:", e);
    }
  }

  // --- 4. serve now, settle later ------------------------------------------
  const priceAtIssue = await spot(asset);
  const call = await decide(key, asset);
  const id = randomUUID();

  put({
    id,
    payload,
    requirements: chosen,
    seller: SELLER,
    strategyName: agent.name,
    authorizedMax: maxPrice.label,
    authorizedMaxUsd: maxPrice.usd,
    asset,
    direction: call.direction,
    confidence: call.confidence,
    horizonSec: HORIZON_SEC,
    priceAtIssue,
    issuedAt: Date.now(),
    bond,
  });

  return Response.json({
    id,
    strategyName: agent.name,
    asset,
    direction: call.direction,
    confidence: +call.confidence.toFixed(2),
    horizonSec: HORIZON_SEC,
    priceAtIssue,
    rationale: call.rationale,
    maxPrice: maxPrice.label,
    bond: bond ? { amount: bond.amount, note: "seller staked, slashed if wrong" } : null,
    note: `settles in ${HORIZON_SEC}s, scaled by realized accuracy`,
  });
}
