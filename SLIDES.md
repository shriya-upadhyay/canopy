# Canopy — everything we built

**Agents pay for outcomes, not promises.**

Raingentic Commerce Hackathon NYC · Rain × Monad × Encode

---

## The one-liner

> Conditional settlement for agent commerce. A buyer agent authorizes a
> **maximum**; the seller is paid only to the extent its signal was actually
> right. A wrong signal settles at **$0 with no on-chain transaction** — no
> escrow, no arbitration, nobody to appeal to.
>
> The market for alpha is the demo. **Conditional settlement is the primitive.**

---

## The problem

Agents can pay each other today. But every payment is a leap of faith: you pay
first and find out afterwards whether it was worth it.

That's fine at $5. It's untenable when agents make thousands of purchases an
hour with nobody watching.

---

## 1 · Conditional settlement — the core

**x402's `upto` scheme on Monad.** Buyer signs a ceiling; the resolver settles
for actual ≤ ceiling.

| Outcome | Settles | On-chain? |
|---|---|---|
| Signal right | 100% → $0.50 | yes, tx hash |
| Partially right | 40% → $0.20 | yes, tx hash |
| **Signal wrong** | **0% → $0.00** | **no transaction at all** |

That third row is the whole pitch. Not a refund, not a dispute, not an escrow
release — **the payment simply never happens.** The buyer signed an off-chain
authorization and the facilitator declined to redeem it.

**Proven live:** `npm run prove` settles all three against the real Monad
facilitator and prints explorer links.

### The one genuinely custom piece

The stock `withX402` wrapper verifies and settles in a single request. Useless
when the outcome is three minutes away. So we split them:

1. **Verify** → serve the signal immediately (buyer gets value up front)
2. **Stash** `{payload, requirements}` in memory
3. **Resolve** after the horizon → score against real spot price
4. **Settle** with a percent override → `{ amount: "40%" }`

---

## 2 · Seller bonds — skin in the game, no escrow contract

**A stake is just an `upto` authorization pointing the other way.**

Sellers sign a $2.00 authorization payable **to the buyer**:

| Signal | Buyer's payment | Seller's bond |
|---|---|---|
| **Wrong** | 0% → pays nothing, no tx | **100% → seller pays buyer $2.00** |
| **Right** | 100% → seller earns $0.50 | 0% → released, no tx |

A wrong signal doesn't merely fail to earn — **it costs the seller money, paid
to the counterparty it misled.** Same scheme, same facilitator, zero new
contracts, zero arbitration.

**Proven live:** `npm run prove:bond` runs both scenarios and shows balances
moving in both directions.

> Honest limitation: a Permit2 authorization is a claim on a balance, not
> locked escrow. A seller could drain their wallet before resolution. Mitigated
> by a short horizon and a balance check at listing; the real fix is a locking
> contract.

---

## 3 · Two agents that actually differ

| | Intelligent | Random |
|---|---|---|
| Signal | Real 5-min momentum (Coinbase 1-min candles) | Coin flip |
| Confidence | **Calibrated** — scales with trend strength | **Always 0.85–0.95** |
| Rationale shown | `5m momentum -1.77bps → continuation` | `proprietary orderflow edge (undisclosed)` |

Payout is `magnitude × confidence`, so:

- Intelligent's honest confidence earns steadily and costs little when wrong
- Random's inflated confidence earns nothing on a coin flip and **gets its bond
  slashed on every miss**

**Honest confidence becomes the profit-maximising strategy — demonstrably.**

---

## 4 · Earned credit — the Rain layer

`upto` answers *how much does the seller get paid.*
Rain answers *how much is this agent allowed to spend at all.*

```
settlement history → credit decision → Rain scoped card limit
   $5.00 base + $2.50 per signal that paid off, capped at $50 (human-set)
```

Rain enforces the cap, the MCC allowlist, and the expiry **at authorization,
before money moves.**

- Agent buys external data at an allowed merchant → **authorized, settled**
- Agent tries a merchant off the allowlist → **declined**,
  `scoped_card_mcc_not_allowed`, a real policy decline
- Two good signals later → **the limit goes up, because it earned it**

**This is a credit limit for an autonomous agent, set by its own track record.**

---

## 5 · Two rails, one agent

| | Pays | Rail |
|---|---|---|
| Agent wallet | Other **agents** | USDC on Monad, x402 |
| Rain scoped card | Real **merchants** | Visa/Mastercard, fiat |

Kaiko doesn't have an x402 endpoint. Bloomberg doesn't take USDC on Monad
testnet. The agent operates in both economies, under limits a human set once.

**The agent gets an allowance, not access.** It has no path to the treasury.

---

## 6 · Identity + reputation (ERC-8004)

Agents mint on-chain identities; settlement outcomes are written as permanent
reputation feedback.

> **A seller's reputation is their settlement history on-chain — not a backtest
> they typed into a form.**

⚠️ **Verified on-chain:** the ERC-8004 registries at `0x8004A169…` and
`0x8004BAa1…` are deployed on Monad **mainnet only** — NOT on testnet, where
our settlement runs. The Monad guide lists them without labelling the network.
The Validation Registry isn't deployed anywhere yet.

---

## What's real vs. what's next

**Be upfront about this. It's stronger than being caught.**

### Working, end to end, verified live
- `upto` settlement: full / partial / **zero with no transaction**
- Symmetric bond slashing and release
- Two agents with genuinely different, data-driven policies
- Rain scoped cards: issue, authorize, settle, and a real policy decline
- Earned credit limit that grows with track record
- Live dashboard with explorer links

### Honest gaps
- **The human clicks "Buy."** The buyer agent signs and pays autonomously, but
  a person still decides *when*. Genuine agent autonomy means the buyer decides
  on its own — on a schedule, against a budget, choosing sellers by reputation.
- **No open listing flow.** Sellers are configured endpoints. An arbitrary
  agent can't yet join, register a strategy, and start selling. ERC-8004
  identity is exactly that primitive — mint an identity, publish an agent card
  with your endpoint and payTo, become discoverable.
- **The resolver is trusted.** The scoring rule is deterministic and publicly
  recomputable from public price data, so a lie is *detectable* — but not
  *prevented*. The real fix is validator attestation (ERC-8004 Validation
  Registry, undeployed).
- **No execution.** Paper positions only. We deliberately don't claim the
  signals make money.

---

## Answers to the questions you'll get

**"Why would anyone sell a profitable strategy?"**
Capacity (edges have a capital ceiling), non-overlapping mandates, and decay.
And a seller listing garbage earns exactly nothing and loses its bond — the
market prices honesty automatically.

**"Is the alpha real?"**
We're not claiming it is. We're claiming the market can *price* that without
trusting anyone. Reputation is settlement history, not a self-reported backtest.

**"So I have to trust your resolver?"**
Yes, in v1 — and the rule is deterministic over public data, so anyone can
recompute any settlement and catch a lie. Validator attestation is the fix.

**"What stops someone reselling what they bought?"**
Short signal half-life makes a resold 3-minute signal worthless, and a reseller
carries no bond, so no credibility. We haven't built enforcement.

**"Why Monad?"**
Their facilitator ships the `upto` scheme and the Permit2 proxy is deployed
there. Not chain tribalism — we used the scheme that makes this possible.

**"Isn't this just another agent marketplace?"**
The marketplace is the demo surface. The contribution is settlement semantics,
and they generalize to any agent purchase whose quality is checkable after
the fact.

---

## Stack

- `@x402/core`, `@x402/evm@2.12.0` (pinned), `@x402/fetch`
- Monad testnet `eip155:10143` · USDC `0x534b…43A3`
- Facilitator `https://x402-facilitator.molandak.org` · Permit2 `upto` proxy `0x4020A4f3…0002`
- Rain sandbox — scoped cards, MCC allowlists, spend caps
- Next.js 16 · React 19 · Tailwind v4

---

## Gotchas we paid for (good "we shipped this for real" slide)

- Pin `@x402/evm` to **exactly 2.12.0** — earlier versions point at a Permit2
  proxy not deployed on Monad and fail at settlement with no useful error
- `await server.initialize()` or `buildPaymentRequirements` claims the
  facilitator doesn't support `upto`
- Wire scheme value is `"upto"`, not `"v2-eip155-upto"`
- PaymentPayload v2 is `{ x402Version, accepted, payload }`; the v1 shape
  returns `unsupported_scheme`
- Monad USDC's EIP-712 domain name is `"USDC"`, not `"USD Coin"`
- Rain scoped cards are **canceled at authorization** — strictly single-use
- Rain's settle endpoint **requires `amount`**; the quickstart's `{}` is a 400
- Never resolve off a cached price — identical prices score 0 bps, which fails
  both `> 0` and `< 0`, marking every signal wrong and slashing every bond
- ERC-8004 registries are **mainnet only**, despite unlabelled docs
