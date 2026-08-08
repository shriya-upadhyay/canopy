/**
 * Verify the ERC-8004 identities are REAL, on the chain we settle on, and
 * owned by OUR wallets.
 *
 *   npm run verify:agents
 *
 * Run this after deploying the registries to testnet and re-running
 * scripts/register-agents.mjs. It exists because the token ids in
 * lib/sellers.ts started life as placeholders — and placeholder ids that
 * happen to resolve to somebody else's agent on another chain is the worst
 * possible failure mode: it looks verified and isn't.
 *
 * Checks, in order:
 *   1. Is the Identity registry actually deployed on Monad testnet?
 *   2. Does each token id exist?
 *   3. Is it owned by the seller wallet we transact from?
 */
import { createPublicClient, http, defineChain, parseAbi } from "viem";
import { readFileSync } from "node:fs";

const RPC = "https://testnet-rpc.monad.xyz";
const IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const CHAIN_ID = 10143;

const monad = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  testnet: true,
});
const pub = createPublicClient({ chain: monad, transport: http(RPC) });

// Pull the ids straight out of the source of truth, so this can't drift.
const src = readFileSync(new URL("../lib/sellers.ts", import.meta.url), "utf8");
const ids = [...src.matchAll(/erc8004TokenId:\s*"(\d+)"/g)].map((m) => m[1]);

const wallets = {
  "seller-a": process.env.SELLER_A_ADDR,
  "seller-b": process.env.SELLER_B_ADDR,
};

console.log(`registry ${IDENTITY}`);
console.log(`chain    eip155:${CHAIN_ID} (the chain we settle on)\n`);

const code = await pub.getCode({ address: IDENTITY });
if (!code || code === "0x") {
  console.error("❌ Identity registry NOT DEPLOYED on Monad testnet.");
  console.error("   Nothing can have been minted here. Deploy it, or don't");
  console.error("   claim on-chain identity in the pitch.");
  process.exit(1);
}
console.log(`✓ registry deployed (${code.length / 2} bytes)\n`);

if (!ids.length) {
  console.error("❌ No erc8004TokenId values found in lib/sellers.ts");
  process.exit(1);
}

const ownerOf = parseAbi(["function ownerOf(uint256) view returns (address)"]);
let bad = 0;

for (const [i, [key, wallet]] of Object.entries(wallets).entries()) {
  const id = ids[i];
  if (!id) {
    console.log(`${key}: ⚠  no token id in lib/sellers.ts`);
    bad++;
    continue;
  }
  try {
    const owner = await pub.readContract({
      address: IDENTITY,
      abi: ownerOf,
      functionName: "ownerOf",
      args: [BigInt(id)],
    });
    const mine = wallet && owner.toLowerCase() === wallet.toLowerCase();
    console.log(
      `${key}: token ${id} owner ${owner} ${mine ? "✓ ours" : "❌ NOT OUR WALLET"}`,
    );
    if (!mine) {
      console.log(`         expected ${wallet}`);
      bad++;
    }
  } catch (e) {
    console.log(`${key}: token ${id} ❌ does not exist — ${(e.shortMessage ?? e.message).slice(0, 70)}`);
    bad++;
  }
}

console.log(
  `\n${bad === 0 ? "✅ identities verified — safe to claim on stage" : `❌ ${bad} problem(s) — do NOT claim ERC-8004 identity until fixed`}`,
);
process.exit(bad === 0 ? 0 : 1);
