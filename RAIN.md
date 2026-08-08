# Rain layer — the boundary tier + earned credit

**Two-tier economy.** Inside the marketplace, agents pay each other in USDC on
Monad via x402 `upto`. At the boundary, the buyer agent buys data no marketplace
agent sells, from a real external provider, with a **Rain scoped card** — under
a policy a human set in advance.

The addition: **the card's limit is earned, not fixed.**

---

## The loop

```
buyer pays for a strategy   ──►  upto settles on OUTCOME (0% / partial / 100%)
        │                              │
        │                              ▼
        │                      seller reputation (ERC-8004)
        ▼
agent's own settlement history
        │
        ▼
Rain scoped card limit  ──►  Rain enforces cap + MCC + expiry at authorization
```

`upto` answers *how much does the seller get paid.*
Rain answers *how much is this agent allowed to spend at all.*

Together: **a credit limit for an autonomous agent, set by its own track record.**

---

## Setup

Add to `.env.local` (values come from the Rain team on-site):

```
RAIN_API_KEY=
RAIN_USER_ID=
RAIN_TEAM_ID=
RAIN_CONTRACT_ID=
```

Then:

```bash
npm run rain:check
```

That smoke test proves, in order: collateral funding → scoped card creation →
PAN decryption → an authorization that **succeeds** → an authorization that is
**declined by policy**. If all five print, the Rain path is done.

---

## Endpoints

| Route | Does |
|---|---|
| `GET /api/rain/provision` | Current earned credit decision, no card created |
| `POST /api/rain/provision` | Issues a scoped card sized to the earned limit |
| `POST /api/rain/purchase` | Agent buys external data; authorize → settle |
| `GET /api/ledger` | Everything: strategies, settlements, credit state |

`POST /api/rain/purchase` body:

```json
{ "cardId": "...", "amountCents": 199,
  "merchantName": "Kaiko Market Data", "mcc": "5734" }
```

Pass `"declineReason": "blocked_mcc"` to force the guardrail to fire on stage.

---

## Credit policy (lib/credit.ts)

| Knob | Value |
|---|---|
| Base allowance | $5.00 |
| Earned per strategy that paid off | $2.50, weighted by hit rate |
| Hard ceiling (human-set) | $50.00 |

Rain applies a **1.2× ceiling** over `amountInUSDCents` to absorb auth holds —
a $5.00 card authorizes up to $6.00. Say that before a judge notices.

---

## Verified sandbox behaviour — NOT in the docs

All three found by hitting the live sandbox. Each one would have broken the demo.

**1. A scoped card is canceled at AUTHORIZATION. It is strictly single-use.**
Not at settlement — at authorization. Reusing a `cardId` returns
`400 "Card ... is not active"`. So provision a fresh card per purchase.
This is a better story anyway: the card is scoped to exactly one purchase,
at exactly the limit the agent earned. `/api/rain/purchase` does this
automatically — you never pass it a `cardId`.

**2. `POST /simulate/transactions/{id}/settle` REQUIRES `amount` in the body.**
The quickstart shows `-d '{}'`, which returns
`400 FST_ERR_VALIDATION "body must have required property 'amount'"`.

**3. You do NOT need the `declineReason` override to demo the guardrail.**
An MCC outside the allowlist declines for real, with
`declinedReason: "scoped_card_mcc_not_allowed"`. A genuine policy decline is
far stronger on stage than a simulated one — don't fake what already works.

Also confirmed: `Api-Key` header, `RAIN_API` / `RAIN_COLLATERAL_CONTRACT_ID`
naming both accepted, PAN decrypts correctly with AES-128-GCM + `setAuthTag`
(the docs' sample omits the auth tag; ours verifies properly and falls back).

---

## Sandbox limits

- 10 active scoped cards per user
- 10 cards created per user per rolling 24h
- $5,000 approved spend per user per rolling 24h

Fixed for the hackathon. Don't burn cards in testing — you get 10 a day.

---

## The 45 seconds on stage

1. Show the policy: $5.00 cap, MCC allowlist, expires in 24h. A human set this.
2. Agent buys external data at an allowed merchant. **Authorized. Settled.**
3. Agent tries a merchant off the allowlist. **Declined before money moved.**
4. Resolve two good strategies. Re-provision. **The limit went up — it earned it.**

> "The agent didn't ask permission. It operated inside a budget it earned,
> and Rain enforced the edge of that budget without a human in the loop."
