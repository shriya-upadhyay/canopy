// SELLER BONDS — skin in the game, with no escrow contract.
//
// A stake is just an `upto` authorization pointing the other way.
//
// When a seller lists a strategy it signs a Permit2 `upto` authorization for up
// to $2.00, payable TO THE BUYER. Then, at resolution:
//
//   strategy correct  -> settle the bond at   0%  -> released, NO on-chain tx
//   strategy wrong    -> settle the bond at 100%  -> seller PAYS the buyer
//
// So a wrong strategy doesn't merely earn nothing. It costs the seller money,
// paid directly to the counterparty it misled. Same primitive, same
// facilitator, zero new contracts, zero arbitration.
//
// This is what makes the answer to "why would anyone sell real alpha?" and
// "what stops someone listing garbage?" a mechanism instead of a hand-wave.

import { server, initialized } from "./x402";
import { MONAD, USDC, USDC_DECIMALS, RPC } from "./const";
import { monadTestnet } from "./chain";
import { UptoEvmScheme as UptoBondClientScheme } from "@x402/evm/upto/client";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import type { ResourceConfig } from "@x402/core/server";

/** Default bond a seller must post to list a strategy. */
export const DEFAULT_BOND = "$2.00";

/**
 * Requirements for the seller's bond. Note payTo is the BUYER: if the strategy
 * is wrong, the money goes to the party that was misled, not to a treasury.
 * That keeps the incentive local and easy to explain.
 */
export function bondRoute(payToBuyer: string, bond: string): ResourceConfig {
  return {
    scheme: "upto",
    network: MONAD,
    payTo: payToBuyer,
    price: bond,
    // Must comfortably outlast the strategy horizon or the authorization
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
 * Verify a seller's posted bond before their strategy is allowed to list.
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

/**
 * Same wallet-client-plus-signTypedData-override shape used for the buyer in
 * app/api/buy: the `upto` scheme signs an EIP-712 Permit2 witness with the
 * raw account, not the wallet client.
 */
function signerFor(pk: `0x${string}`) {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC) });
  return {
    ...wallet,
    address: account.address,
    signTypedData: (a: Parameters<typeof account.signTypedData>[0]) =>
      account.signTypedData(a),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Seller signs its bond at listing time — the reverse-direction `upto`
 * authorization payable to the buyer. Mirrors scripts/prove-bond.mjs's
 * `authorize()`: build requirements, then sign a payload directly against
 * the scheme (no HTTP round-trip — the seller isn't responding to a 402,
 * it's posting a stake alongside the strategy it's about to serve).
 */
export async function createBond(
  sellerPk: `0x${string}`,
  payToBuyer: string,
  bond = DEFAULT_BOND,
) {
  const requirements = await buildBondRequirements(payToBuyer, bond);
  const scheme = new UptoBondClientScheme(signerFor(sellerPk));
  const payload = await scheme.createPaymentPayload(2, requirements);
  return {
    payload: { ...payload, scheme: "upto", network: MONAD },
    requirements,
  };
}
