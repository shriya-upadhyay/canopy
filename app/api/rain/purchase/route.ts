import { NextRequest, NextResponse } from "next/server";
import { authorize, settle, createScopedCard } from "@/lib/rain";
import { creditLimit } from "@/lib/credit";

export const dynamic = "force-dynamic";

/** MCCs the agent may transact with. 5734 software/data, 7372 data processing, 5045 computers. */
const ALLOWED_MCCS = ["5734", "7372", "5045"];

/**
 * THE BOUNDARY TIER.
 *
 * Inside the marketplace, agents pay each other in USDC on Monad via x402.
 * At the boundary, the buyer agent buys data no marketplace agent sells, from
 * a real external provider, with a Rain scoped card — under a policy a human
 * set in advance, and a limit its own track record earned.
 *
 * VERIFIED SANDBOX BEHAVIOUR (learned the hard way, not in the docs):
 *
 *  1. A scoped card is canceled at AUTHORIZATION — it is strictly single-use.
 *     Reusing a cardId returns 400 "Card ... is not active". So we provision a
 *     fresh card per purchase. This is a better story anyway: the card is
 *     scoped to exactly one purchase at exactly the earned limit.
 *
 *  2. The settle endpoint REQUIRES `amount` in the body. The quickstart shows
 *     `-d '{}'`, which returns 400 FST_ERR_VALIDATION.
 *
 *  3. An MCC outside the allowlist declines for real, with
 *     `scoped_card_mcc_not_allowed`. No declineReason override needed.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      amountCents = 199,
      merchantName = "Kaiko Market Data",
      mcc = "5734",
    } = body;

    // 1 — provision a card sized to what the agent has EARNED
    const decision = creditLimit();
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");

    const { card } = await createScopedCard({
      amountInUSDCents: decision.limitCents,
      expiresAt,
      allowedMccs: ALLOWED_MCCS,
    });

    const policy = {
      limitUsd: decision.limitUsd,
      rainCeilingUsd: ((decision.limitCents * 1.2) / 100).toFixed(2),
      allowedMccs: ALLOWED_MCCS,
      expiresAt,
      earnedReason: decision.reason,
    };

    // 2 — the agent attempts its purchase
    const auth = await authorize({
      cardId: card.id,
      amount: amountCents,
      merchantName,
      merchantCategoryCode: mcc,
    });

    if (auth.status === "declined") {
      return NextResponse.json({
        outcome: "declined",
        stage: "authorization",
        reason: auth.declinedReason, // e.g. scoped_card_mcc_not_allowed
        card: { id: card.id, last4: card.last4 },
        merchant: merchantName,
        mcc,
        attemptedUsd: (amountCents / 100).toFixed(2),
        policy,
        note: "Rain enforced the policy before any money moved.",
      });
    }

    // 3 — capture
    const settled = await settle(auth.transactionId, amountCents);

    return NextResponse.json({
      outcome: settled.status,
      stage: "settled",
      transactionId: auth.transactionId,
      card: { id: card.id, last4: card.last4 },
      merchant: merchantName,
      mcc,
      amountUsd: (amountCents / 100).toFixed(2),
      policy,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
