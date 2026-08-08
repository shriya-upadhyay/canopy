/**
 * Buyer agent — discovers a seller, pays with the `upto` scheme, gets a strategy.
 *
 *   npm run buy -- seller-a
 *   npm run buy -- seller-b ETH
 */
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { UptoEvmScheme } from "@x402/evm/upto/client";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, defineChain } from "viem";

const MONAD = "eip155:10143";
const RPC = "https://testnet-rpc.monad.xyz";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const seller = process.argv[2] ?? "seller-a";
const asset = process.argv[3] ?? "ETH";

const monad = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  testnet: true,
});

const pk = process.env.BUYER_PK;
if (!pk) throw new Error("BUYER_PK missing");
const account = privateKeyToAccount(pk);

const wallet = createWalletClient({ account, chain: monad, transport: http(RPC) });

// The signer the scheme needs: address + signTypedData.
const signer = {
  address: account.address,
  signTypedData: (args) => account.signTypedData(args),
  ...wallet,
};

const client = new x402Client().register(MONAD, new UptoEvmScheme(signer));
const paidFetch = wrapFetchWithPayment(fetch, client);

console.log(`buyer  ${account.address}`);
console.log(`GET    ${BASE}/api/strategy/${seller}?asset=${asset}\n`);

const res = await paidFetch(`${BASE}/api/strategy/${seller}?asset=${asset}`);
const body = await res.json();

console.log(`status ${res.status}`);
console.log(JSON.stringify(body, null, 2));

if (body?.strategy) {
  const secs = body.strategy.horizonSec;
  console.log(
    `\n⏳ resolves in ${secs}s — watch the dashboard, or GET /api/ledger`,
  );
}
