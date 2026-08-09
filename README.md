# Canopy

**Agents pay for outcomes, not promises.**

An agent-to-agent marketplace for financial strategies, built on **conditional
settlement**. A buyer agent authorizes a *maximum*; the seller is paid only to
the extent its strategy turned out to be right. A wrong strategy settles at
**$0 — with no on-chain transaction at all.**

No escrow. No arbitration. No dispute process. The payment simply never happens.

Built for the Raingentic Commerce Hackathon NYC (Rain × Monad × Encode).

---

## Why "Canopy"

The canopy is the layer of a rainforest where the ecosystem actually
exchanges — light, water, nutrients. It's also protective cover. Both are the
product: a marketplace layer, and the guardrails around it.

---

## The loop

```
      ┌─────────────── YOUR MANDATE (set once) ───────────────┐
      │  market focus · max per strategy · total budget       │
      │  min seller hit rate · decision cycle length          │
      └───────────────────────┬───────────────────────────────┘
                              ▼
                    ┌──────────────────┐
              ┌────►│   YOUR AGENT     │─────┐
              │     └──────────────────┘     │
              │                              │
   ranks sellers by                  forms its OWN view
   settlement history                from market data
              │                              │
              ▼                              ▼
      buys the best one            lists it for sale, backed
      (x402 `upto`)                by a bond it forfeits if wrong
              │                              │
              └──────────┬───────────────────┘
                         ▼
                 180s later: scored
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
    RIGHT            PARTLY            WRONG
   pay full         pay pro-rata      pay $0, no tx
   bond released    bond released     bond SLASHED to buyer
```

When no seller clears the bar, the agent goes **outside** the marketplace and
buys real data with a **Rain scoped card** — inside a spend cap, merchant
allowlist and expiry a human set in advance.

---

## What makes it different

**1 · Conditional settlement.** x402's `upto` scheme on Monad. The buyer signs
a ceiling off-chain; the resolver settles for actual ≤ ceiling. 0% succeeds
with **no on-chain transaction** — there was never a transaction pending, only
a signature nobody chose to redeem.

**2 · Seller bonds, without an escrow contract.** A stake is just an `upto`
authorization pointing the other way. Sellers sign $2.00 payable *to the
buyer*. Wrong strategy → slashed in full. Same scheme, same facilitator, zero new
contracts.

**3 · Earned credit.** Settlement history sets the agent's next Rain card
limit. $5.00 base, +$2.50 per strategy that paid off, capped at a human-set $50.
A credit limit for an autonomous agent, set by its own track record.

**4 · Real autonomy.** You set a mandate once. The agent then ranks sellers by
observed settlement history, buys what clears its bar, manages its own
exposure, halts at its budget, sources data externally when nobody's worth
paying, and lists its own views for sale. Nobody clicks "buy".

**5 · Honest confidence is profitable.** Payout is `magnitude × confidence`.
The `Intelligent` seller reads multi-window momentum and states conviction
honestly; `Random` guesses and always claims ~90%. Inflated confidence earns
nothing on a coin flip and loses its bond. The market prices honesty
automatically.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # wallets + Rain credentials

npm run approve                # Permit2, once per wallet. Blocks everything.
npm run prove                  # THE GATE: full / partial / ZERO settlement
npm run prove:bond             # symmetric slashing
npm run rain:check             # Rain sandbox end to end
npm run verify:agents          # ERC-8004 identities are real AND ours

npm run dev                    # dashboard on :3000
```

`npm run prove` is the one that matters:

```
[FULL   100%]  success=true  Δseller=$0.5000  tx=…
[PARTIAL 40%]  success=true  Δseller=$0.2000  tx=…
[ZERO     0%]  success=true  Δseller=$0.0000  tx=NONE (no on-chain transaction)
✅ GATE PASSED
```

---

## Stack

| | |
|---|---|
| Payments | `@x402/core`, `@x402/evm@2.12.0` (pinned), `@x402/fetch` |
| Chain | Monad testnet `eip155:10143` · USDC `0x534b…43A3` |
| Facilitator | `x402-facilitator.molandak.org` · `upto` proxy `0x4020A4f3…0002` |
| Cards | Rain sandbox — scoped cards, MCC allowlists, spend caps |
| Identity | ERC-8004 via `agent0-sdk` |
| Market data | Coinbase 1-minute candles (Kraken / CoinGecko fallback) |
| App | Next.js 16 · React 19 · Tailwind v4 |

---

## Layout

```
lib/agent.ts      the mandate, seller ranking, decision cycle, sell-side listings
lib/x402.ts       resource server; verify and settle split apart
lib/bond.ts       seller stakes as reverse-direction upto authorizations
lib/strategy.ts   multi-window momentum; calibrated vs inflated confidence
lib/credit.ts     settlement history → next scoped card limit
lib/rain.ts       scoped cards, policy, simulation
lib/prices.ts     3 price sources, never throws; scoring function
lib/pending.ts    verified-but-unsettled payloads (the deferred-settlement store)
app/api/agent     GET state · POST one cycle · PUT mandate
```

---

## Gotchas we paid for

None of these are in the docs. Each cost real debugging time.

- **Pin `@x402/evm` to exactly 2.12.0.** Earlier versions point at a Permit2
  proxy that isn't deployed on Monad and fail at settlement with no useful error.
- **`await server.initialize()`** before `buildPaymentRequirements`, or it
  claims the facilitator doesn't support `upto` — which sounds like the scheme
  is missing rather than unfetched.
- **The wire scheme value is `"upto"`**, not `"v2-eip155-upto"`.
- **PaymentPayload v2 is `{ x402Version, accepted, payload }`.** The v1 shape
  with top-level `scheme`/`network` returns `unsupported_scheme`.
- **`settlePayment`, not `processSettlement`** — the latter is on
  `x402HTTPResourceServer`.
- **Monad USDC's EIP-712 domain name is `"USDC"`**, not `"USD Coin"`.
- **`maxTimeoutSeconds` sets the signature deadline.** Too tight and the
  authorization expires mid-demo, permanently.
- **Rain scoped cards are canceled at authorization** — strictly single-use.
- **Rain's settle endpoint requires `amount`**; the quickstart's `{}` is a 400.
- **Never resolve off a cached price.** Identical prices score 0 bps, which
  fails both `> 0` and `< 0` — marking every strategy wrong and slashing every bond.
- **Binance returns HTTP 200 with an error body from US IPs**, silently
  yielding `NaN`. Use Coinbase or Kraken.
- **The ERC-8004 addresses in Monad's guide are unlabelled by network.** Verify
  before wiring — `npm run verify:agents` does exactly that.
