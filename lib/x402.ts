// x402 resource server configured for the `upto` scheme on Monad.
//
// API verified against @x402/evm@2.12.0 + @x402/core type definitions:
//   x402ResourceServer.buildPaymentRequirements(resourceConfig)
//   x402ResourceServer.verifyPayment(payload, requirements, ext?, transport?)
//   x402ResourceServer.settlePayment(payload, requirements, ext?, transport?, overrides?)
//
// The 5th arg to settlePayment is what makes this whole project work.

import {
  x402ResourceServer,
  HTTPFacilitatorClient,
  type ResourceConfig,
} from "@x402/core/server";
import { UptoEvmScheme } from "@x402/evm/upto/server";
import { MONAD, USDC, FACILITATOR, USDC_DOMAIN, USDC_DECIMALS } from "./const";

const scheme = new UptoEvmScheme(); // scheme.scheme === "upto"

scheme.registerMoneyParser(async (amount: number, network: string) => {
  if (network !== MONAD) return null; // fall through to default parser
  return {
    amount: Math.floor(amount * 10 ** USDC_DECIMALS).toString(),
    asset: USDC, // raw address — used as EIP-712 verifyingContract
    extra: { ...USDC_DOMAIN },
  };
});

export const server = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: FACILITATOR })
).register(MONAD, scheme);

/**
 * MUST be awaited before buildPaymentRequirements().
 *
 * initialize() fetches the facilitator's supported kinds (GET /supported).
 * Skip it and you get either an empty `accepts: []` — a 402 the client can
 * never satisfy — or "Facilitator does not support upto on eip155:10143".
 * Neither error points at the real cause. Cached so it runs once per process.
 */
let ready: Promise<void> | undefined;
export function initialized(): Promise<void> {
  ready ??= server.initialize();
  return ready;
}

/**
 * ResourceConfig for buildPaymentRequirements().
 *
 * GOTCHA: this is FLAT — { scheme, payTo, price, network }. It is NOT the
 * nested `{ accepts: {...}, resource }` shape shown in the Monad guide;
 * that one is `RouteConfig`, which belongs to the withX402 wrapper.
 * Passing the nested shape here silently yields `accepts: []` — a 402 with
 * no payment terms, and a client that can't pay. Verified the hard way.
 *
 * NOTE the scheme string is "upto", NOT "v2-eip155-upto". The docs use the
 * long form as a label; GET /supported advertises `"scheme":"upto"`, and
 * that's what goes on the wire.
 *
 * `price` here is the CEILING the buyer authorizes, not what they pay.
 */
export function signalRoute(payTo: string, maxPrice: string): ResourceConfig {
  return {
    scheme: "upto",
    network: MONAD,
    payTo,
    price: maxPrice, // e.g. "$0.50"
    maxTimeoutSeconds: 300,
  };
}

/**
 * Settle a previously-verified payment for a fraction of the authorized max.
 *
 * SettlementOverrides.amount accepts three formats (from @x402/core types):
 *   "1000"   raw atomic units
 *   "50%"    percent of PaymentRequirements.amount, <=2dp, floored
 *   "$0.05"  dollar price -> atomic units via getAssetDecimals
 *
 * Must be <= the authorized maximum. Only valid on partial-settlement
 * schemes, i.e. `upto`.
 *
 * accuracy 0 -> "0%" -> $0 settled, and per the Monad docs that means
 * NO ON-CHAIN TRANSACTION AT ALL. That is the demo.
 */
export async function settleForAccuracy(
  payload: Parameters<typeof server.settlePayment>[0],
  requirements: Parameters<typeof server.settlePayment>[1],
  accuracy: number // 0.0 .. 1.0
) {
  const pct = Math.max(0, Math.min(1, accuracy)) * 100;
  return server.settlePayment(payload, requirements, undefined, undefined, {
    amount: `${pct.toFixed(2)}%`,
  });
}
