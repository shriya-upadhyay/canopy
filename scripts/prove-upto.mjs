/**
 * THE 4:00 PM GATE.
 *
 * Proves all three settlement outcomes against a live facilitator:
 *   full    100%  -> $0.50, tx on explorer
 *   partial  40%  -> $0.20, tx on explorer
 *   zero      0%  -> success, NO on-chain transaction   <-- the demo
 *
 * If this doesn't pass by 4 PM, fall back to `exact` + a minimal escrow.
 *
 *   npm run prove
 *
 * Runs entirely in-process (no Next server needed) so a broken route can't
 * be confused with a broken scheme.
 */
import { UptoEvmScheme as UptoServer } from "@x402/evm/upto/server";
import { UptoEvmScheme as UptoClient } from "@x402/evm/upto/client";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseAbi,
} from "viem";

const MONAD = "eip155:10143";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const FACILITATOR = "https://x402-facilitator.molandak.org";
const RPC = "https://testnet-rpc.monad.xyz";
const EXPLORER = "https://testnet.monadexplorer.com";

const monad = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  testnet: true,
});

const buyerPk = process.env.BUYER_PK;
const sellerAddr = process.env.SELLER_A_ADDR;
if (!buyerPk || !sellerAddr) throw new Error("BUYER_PK / SELLER_A_ADDR missing");

const buyer = privateKeyToAccount(buyerPk);
const pub = createPublicClient({ chain: monad, transport: http(RPC) });
const wallet = createWalletClient({ account: buyer, chain: monad, transport: http(RPC) });

const balOf = (a) =>
  pub.readContract({
    address: USDC,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [a],
  });

// --- facilitatorAddress must be bound into the Permit2 witness -------------
const supported = await (await fetch(`${FACILITATOR}/supported`)).json();
const kind = supported.kinds.find((k) => k.scheme === "upto" && k.network === MONAD);
if (!kind) throw new Error("upto not advertised for Monad testnet — STOP, fall back");
const facilitatorAddress = kind.extra.facilitatorAddress;

console.log(`buyer            ${buyer.address}`);
console.log(`seller           ${sellerAddr}`);
console.log(`facilitatorAddr  ${facilitatorAddress}\n`);

// --- server ---------------------------------------------------------------
const scheme = new UptoServer();
scheme.registerMoneyParser(async (amount, network) => {
  if (network !== MONAD) return null;
  return {
    amount: Math.floor(Number(amount) * 1e6).toString(),
    asset: USDC,
    extra: { name: "USDC", version: "2" },
  };
});
const server = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: FACILITATOR }),
).register(MONAD, scheme);

// --- client ---------------------------------------------------------------
const signer = {
  address: buyer.address,
  signTypedData: (a) => buyer.signTypedData(a),
  ...wallet,
};
const clientScheme = new UptoClient(signer);

async function attempt(label, percent) {
  const [reqs] = await server.buildPaymentRequirements({
    scheme: "upto",
    network: MONAD,
    payTo: sellerAddr,
    price: "$0.50",
    maxTimeoutSeconds: 600,
    extra: { facilitatorAddress },
  });

  const { payload } = await clientScheme
    .createPaymentPayload(2, reqs)
    .then((r) => ({ payload: { ...r, scheme: "upto", network: MONAD } }));

  const verified = await server.verifyPayment(payload, reqs);
  if (!verified.isValid) {
    console.log(`${label}  ❌ verify failed: ${verified.invalidReason}`);
    return false;
  }

  const before = await balOf(sellerAddr);
  const res = await server.processSettlement(payload, reqs, undefined, undefined, {
    amount: percent,
  });
  const after = await balOf(sellerAddr);

  const delta = Number(after - before) / 1e6;
  const tx = res.transaction || null;
  console.log(
    `${label}  success=${res.success}  Δseller=$${delta.toFixed(4)}  tx=${tx ? `${EXPLORER}/tx/${tx}` : "NONE (no on-chain transaction)"}`,
  );
  if (!res.success) console.log(`        reason: ${res.errorReason} ${res.errorMessage ?? ""}`);
  return res.success;
}

console.log("USDC buyer  :", Number(await balOf(buyer.address)) / 1e6);
console.log("USDC seller :", Number(await balOf(sellerAddr)) / 1e6, "\n");

const full = await attempt("[FULL   100%]", "100%");
const partial = await attempt("[PARTIAL 40%]", "40%");
const zero = await attempt("[ZERO     0%]", "0%");

console.log(
  `\n${full && partial && zero ? "✅ GATE PASSED — build the marketplace" : "❌ GATE FAILED — fall back to exact + escrow"}`,
);
process.exit(full && partial && zero ? 0 : 1);
