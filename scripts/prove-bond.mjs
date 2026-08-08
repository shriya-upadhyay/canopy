/**
 * Proves the SYMMETRIC settlement — the strongest 30 seconds of the demo.
 *
 * One wrong signal produces two settlements at once:
 *   buyer's payment  ->   0%  -> buyer pays nothing, no on-chain tx
 *   seller's bond    -> 100%  -> seller pays the buyer $2.00, on-chain
 *
 * And one correct signal produces the mirror image:
 *   buyer's payment  -> 100%  -> seller earns $0.50
 *   seller's bond    ->   0%  -> released, no on-chain tx
 *
 * No escrow contract. Same scheme, same facilitator, roles swapped.
 *
 *   npm run prove:bond
 */
import { UptoEvmScheme as UptoServer } from "@x402/evm/upto/server";
import { UptoEvmScheme as UptoClient } from "@x402/evm/upto/client";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from "viem";

const MONAD = "eip155:10143";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const FACILITATOR = "https://x402-facilitator.molandak.org";
const RPC = "https://testnet-rpc.monad.xyz";
const EXPLORER = "https://testnet.monadexplorer.com";

const monad = defineChain({
  id: 10143, name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } }, testnet: true,
});

const buyerPk = process.env.BUYER_PK;
const sellerPk = process.env.SELLER_A_PK;
if (!buyerPk || !sellerPk) throw new Error("BUYER_PK / SELLER_A_PK missing");

const buyer = privateKeyToAccount(buyerPk);
const seller = privateKeyToAccount(sellerPk);

const pub = createPublicClient({ chain: monad, transport: http(RPC) });
const signerFor = (acct) => ({
  address: acct.address,
  signTypedData: (a) => acct.signTypedData(a),
  ...createWalletClient({ account: acct, chain: monad, transport: http(RPC) }),
});

const bal = (a) =>
  pub.readContract({
    address: USDC,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf", args: [a],
  });
const usd = (n) => `$${(Number(n) / 1e6).toFixed(4)}`;

// facilitatorAddress must be bound into the Permit2 witness
const supported = await (await fetch(`${FACILITATOR}/supported`)).json();
const kind = supported.kinds.find((k) => k.scheme === "upto" && k.network === MONAD);
if (!kind) throw new Error("upto not advertised on Monad testnet — STOP");
const facilitatorAddress = kind.extra.facilitatorAddress;

const scheme = new UptoServer();
scheme.registerMoneyParser(async (amount, network) => {
  if (network !== MONAD) return null;
  return { amount: Math.floor(Number(amount) * 1e6).toString(), asset: USDC, extra: { name: "USDC", version: "2" } };
});
const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR })).register(MONAD, scheme);
await server.initialize();

const buyerScheme = new UptoClient(signerFor(buyer));
const sellerScheme = new UptoClient(signerFor(seller));

async function authorize(clientScheme, payTo, price) {
  const [reqs] = await server.buildPaymentRequirements({
    scheme: "upto", network: MONAD, payTo, price,
    maxTimeoutSeconds: 900, extra: { facilitatorAddress },
  });
  const r = await clientScheme.createPaymentPayload(2, reqs);
  return { reqs, payload: { ...r, scheme: "upto", network: MONAD } };
}

async function settle(label, { reqs, payload }, pct) {
  const res = await server.settlePayment(payload, reqs, undefined, undefined, { amount: pct });
  const tx = res.transaction || null;
  console.log(
    `   ${label.padEnd(22)} ${pct.padStart(5)}  success=${res.success}  ` +
    (tx ? `tx=${EXPLORER}/tx/${tx}` : "NO on-chain transaction"),
  );
  if (!res.success) console.log(`      reason: ${res.errorReason} ${res.errorMessage ?? ""}`);
  return res.success;
}

console.log(`buyer  ${buyer.address}`);
console.log(`seller ${seller.address}\n`);
console.log(`start  buyer=${usd(await bal(buyer.address))}  seller=${usd(await bal(seller.address))}\n`);

// ── SCENARIO 1: signal is WRONG ────────────────────────────────────────────
console.log("SCENARIO 1 — signal is WRONG");
const b1 = await authorize(buyerScheme, seller.address, "$0.50"); // buyer -> seller
const s1 = await authorize(sellerScheme, buyer.address, "$2.00"); // seller -> buyer (bond)
const ok1 =
  (await settle("buyer payment", b1, "0%")) &
  (await settle("seller bond SLASHED", s1, "100%"));
console.log(`   after  buyer=${usd(await bal(buyer.address))}  seller=${usd(await bal(seller.address))}\n`);

// ── SCENARIO 2: signal is CORRECT ──────────────────────────────────────────
console.log("SCENARIO 2 — signal is CORRECT");
const b2 = await authorize(buyerScheme, seller.address, "$0.50");
const s2 = await authorize(sellerScheme, buyer.address, "$2.00");
const ok2 =
  (await settle("buyer payment", b2, "100%")) &
  (await settle("seller bond released", s2, "0%"));
console.log(`   after  buyer=${usd(await bal(buyer.address))}  seller=${usd(await bal(seller.address))}\n`);

console.log(ok1 && ok2 ? "✅ SYMMETRIC SETTLEMENT PROVEN" : "❌ FAILED");
process.exit(ok1 && ok2 ? 0 : 1);
