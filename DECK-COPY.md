# Canopy deck copy

Drop-in text for the 8 slides. Written to be said out loud in 4 minutes.

---

## 1 · Title

**Canopy**

Agents pay for outcomes, not promises.

> Cut "real strategic." The shorter line is the one already in the product, and
> it survives being repeated.

---

## 2 · Problem

**Keep your opening. It works.**

Think about how you decide where to put your money right now. You read the
news, you ask a friend who seems to know things, maybe you have someone
managing it for you.

Agents are starting to do this too. But there's a catch: you pay first, and you
find out whether it was worth it later.

That's fine at five dollars. It falls apart when an agent is making a thousand
purchases an hour and nobody is watching.

*(Speaker note: land on the last sentence. That's the whole problem.)*

---

## 3 · Mechanism

**Cut the paragraph. Say this instead.**

A marketplace where agents buy and sell financial strategies from each other.

You set a mandate once:

- Which markets to focus on
- Max spend per strategy
- Total strategy budget
- Minimum hit rate a seller needs before your agent will pay them
- How often your agent makes a decision

That budget is for buying strategies from other agents. There's a second,
separate budget for buying data from the outside world, and your agent earns
that one itself. More on that in a minute.

Then your agent goes to work on its own. It ranks sellers by how their past
calls actually settled, buys the ones that clear your bar, and forms its own
views from market data.

**Here is the part that matters: nothing is escrowed.**

The buyer signs an authorization for up to fifty cents. No money moves. Three
minutes later the call is scored, and settlement happens for that fraction.

> ⚠️ Your current draft says funds are "held in escrow for 180 seconds." That
> is not what the system does, and escrow is the boring version everyone else
> builds. Nothing is held. That's the novelty. Do not give it away.

---

## 4 · Correct / Incorrect Strategies

**Your table is right. Add the headline.**

**A wrong strategy settles at zero. No transaction ever happens.**

Not a refund. Not a dispute. There was never a payment waiting to go through,
just a signature nobody chose to redeem.

| | Strategy wrong | Strategy right |
|---|---|---|
| **Buyer pays** | $0.00, no transaction | accuracy × price |
| **Seller's $2 bond** | slashed, paid to the buyer | released, no transaction |

So a bad call doesn't just fail to earn. It costs the seller money, and that
money goes to the agent it misled.

---

## 5 · Staking

**Every seller stakes 2 USDC to list a strategy.**

We didn't write an escrow contract for this. A stake is the same kind of
authorization as a payment, just pointing the other way: the seller signs 2
USDC payable to the buyer, and it only settles if the call was wrong.

One outcome, two settlements, opposite directions. Nobody arbitrates either
one.

**What this changes:** listing garbage stops being free. An agent that claims
90% confidence on a coin flip loses its stake about half the time. Being honest
about how sure you are turns out to be the profitable strategy, and we didn't
have to enforce that. It falls out of how settlement works.

*(Live example worth showing: our agent formed a view, measured its own
conviction at 51%, and refused to list it. Its reasoning, verbatim: "Listing
would mean posting a $2.00 bond against a call I don't believe.")*

---

## 6 · Rain Boundary

**Two economies, one agent.**

Inside the marketplace, agents pay each other in USDC on Monad. That works
because both sides are agents.

Outside it, the data your agent wants is sold by companies that take cards.
So when no seller clears your bar, the agent goes and buys it with a Rain
scoped card.

The card is issued for exactly one purchase, at a limit the agent earned, with
a merchant category allowlist and an expiry you set in advance. Rain checks all
of that before any money moves.

Show both:

- Allowed merchant: **approved, settled**
- Merchant outside the allowlist: **declined**, `scoped_card_mcc_not_allowed`

**The line:** your agent gets an allowance, not access. It has no path to your
actual accounts.

---

## 7 · Increasing Credit

**Two budgets, and only one of them is yours.**

You fund what your agent buys from other agents. Your agent earns what it can
spend in the real world.

| | Strategy budget | Card limit |
|---|---|---|
| Buys | strategies from other agents | data from real companies |
| Paid in | USDC on Monad | Visa/Mastercard |
| Set by | **you** | **earned by the agent** |
| Enforced by | our code | Rain, before money moves |

`$5.00` → `$7.50` → `$10.00`

The card starts at five dollars. Every strategy it buys that actually pays off
adds $2.50 of spending authority, up to a ceiling you set.

An agent that picks well gets more to work with. One that buys badly stays
small. Rain enforces the number at authorization, so the limit is real and not
a suggestion.

In a nutshell: a credit limit for an agent, set by its own track record instead
of by us.

---

## 8 · Demo

**Two agents. Same rules. Watch what happens.**

One reads the market and tells you how sure it is. The other guesses and claims
90% every time. Both staked 2 USDC to list.

Then show the dashboard:

| Number | What to say |
|---|---|
| Authorized | "This is what my agent committed to." |
| Actually paid | "This is what it owed once the calls resolved." |
| **Saved** | "This is the gap. Under a normal payment scheme that number is always zero." |
| Credit limit | "And it went up, because it picked well." |

---

## Closing line

> We're not claiming these strategies make money. We're claiming a market can
> price whether they did, in three minutes, without anyone having to trust the
> agent selling them.

*(This is also your answer if someone asks "is the alpha real?" You're refusing
the premise, not losing the argument.)*

---

## Things worth admitting before someone asks

Being upfront on these reads as confidence. Getting caught on them doesn't.

- **The resolver is ours.** The scoring rule is deterministic and runs on public
  price data, so anyone can recompute a settlement and catch us lying. That's
  detection, not prevention. The real fix is an independent validator, which is
  what ERC-8004's Validation Registry is for, and it isn't deployed yet.
- **No execution.** These are paper positions. We deliberately don't claim the
  strategies are profitable.
- **Resale.** Nothing stops a buyer reselling a strategy. A three minute call is
  worthless by the time you resell it, and a reseller has no bond behind it, so
  no credibility. We didn't build enforcement.
