import { NextResponse } from "next/server";
import { createScopedCard } from "@/lib/rain";
import { creditLimit } from "@/lib/credit";

export const dynamic = "force-dynamic";

/** MCCs the agent is allowed to transact with. 5734 = computer software/data services. */
const ALLOWED_MCCS = ["5734", "7372", "5045"];

/**
 * Issue the buyer agent a scoped card sized to what its track record has EARNED.
 * Rain enforces the cap, the MCC allowlist, and the expiry before money moves.
 */
export async function POST() {
  try {
    const decision = creditLimit();

    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");

    const { card, pan, cvc, policy } = await createScopedCard({
      amountInUSDCents: decision.limitCents,
      expiresAt,
      allowedMccs: ALLOWED_MCCS,
    });

    return NextResponse.json({
      card: {
        id: card.id,
        last4: card.last4,
        status: card.status,
        exp: `${card.expirationMonth}/${card.expirationYear}`,
      },
      // Never surface full PAN in a real system. Sandbox demo only.
      details: pan ? { pan: `••••••••••••${pan.slice(-4)}`, cvcRetrieved: !!cvc } : null,
      policy: {
        ...policy,
        limitUsd: (decision.limitCents / 100).toFixed(2),
        rainCeilingUsd: ((decision.limitCents * 1.2) / 100).toFixed(2),
      },
      credit: decision,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(creditLimit());
}
