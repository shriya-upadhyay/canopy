// SELLER BONDS — skin in the game, with no escrow contract.
//
// A stake is just an `upto` authorization pointing the other way.
//
// When a seller lists a signal it signs a Permit2 `upto` authorization for up
// to $2.00, payable TO THE BUYER. Then, at resolution:
//
//   signal correct  -> settle the bond at   0%  -> released, NO on-chain tx
//   signal wrong    -> settle the bond at 100%  -> seller PAYS the buyer
//
// So a wrong signal doesn't merely earn nothing. It costs the seller money,
// paid directly to the counterparty it misled. Same primitive, same
// facilitator, zero new contracts, zero arbitration.
//
// This is what makes the answer to "why would anyone sell real alpha?" and
// "what stops someone listing garbage?" a mechanism instead of a hand-wave.

import { server, initialized } from "./x402";
import { MONAD, USDC, USDC_DECIMALS } from "./const";
import type { ResourceConfig } from "@x402/core/server";

/** Default bond a seller must post to list a signal. */
export const DEFAULT_BOND = "$2.00";

/**
 * Requirements for the seller's bond. Note payTo is the BUYER: if the signal
 * is wrong, the money goes to the party that was misled, not to a treasury.
 * That keeps the incentive local and easy to explain.
 */
export function bondRoute(payToBuyer: string, bond: string): ResourceConfig {
  return {
    scheme: "upto",
    network: MONAD,
    payTo: payToBuyer,
    price: bond,
    // Must comfortably outlast the signal horizon or the authorization
    // expires before the resolver can slash it.
    maxTimeoutSeconds: 900,
  };
}

export async function buildBondRequirements(payToBuyer: string, bond = DEFAULT_BOND) {
  await initialized();
  const reqs = await server.buildPaymentRequirements(bondRoute(payToBuyer, bond));
  if (!reqs.length) throw new Error("no bond requirements built — scheme/network not registered");
  return reqs[0];
}

/**
 * Verify a seller's posted bond before their signal is allowed to list.
 *
 * IMPORTANT: this checks the signature and the seller's balance at listing
 * time. It does NOT lock the funds — Permit2 authorizations are claims on a
 * balance, not escrow. A seller could drain the wallet before resolution and
 * the slash would fail at settlement.
 *
 * Mitigated here by a short horizon and a balance check at listing. The real
 * fix is a locking contract; say so plainly if a judge asks rather than
 * pretending the hole isn't there.
 */
export async function verifyBond(payload: unknown, requirements: unknown) {
  await initialized();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await server.verifyPayment(payload as any, requirements as any);
  return { ok: res.isValid, reason: res.invalidReason };
}

/**
 * Resolve a bond.
 *   accuracy === 0  -> slash in full: seller pays the buyer.
 *   accuracy  >  0  -> release: settle 0%, no on-chain transaction.
 *
 * Partial credit releases the bond entirely. Being somewhat right is not an
 * offence; only being wrong is. Keeps the story to one sentence on stage.
 */
export async function resolveBond(
  payload: unknown,
  requirements: unknown,
  accuracy: number,
) {
  await initialized();
  const slash = accuracy === 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await server.settlePayment(payload as any, requirements as any, undefined, undefined, {
    amount: slash ? "100%" : "0%",
  });
  return {
    slashed: slash,
    amountPct: slash ? "100%" : "0%",
    txHash: (res as { transaction?: string })?.transaction,
    success: (res as { success?: boolean })?.success ?? false,
  };
}

/** Human-readable bond size in atomic units, for balance checks. */
export const bondAtomic = (bond = DEFAULT_BOND) =>
  BigInt(Math.round(Number(bond.replace("$", "")) * 10 ** USDC_DECIMALS));

export const BOND_ASSET = USDC;
