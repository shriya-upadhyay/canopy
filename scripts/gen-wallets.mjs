// node scripts/gen-wallets.mjs >> .env.local
// Generates buyer + seller wallets. Fund EVERY address at both faucets immediately:
//   USDC: https://faucet.circle.com  (USDC / Monad Testnet)  <-- 1 req / 2 hrs, start now
//   MON : https://faucet.monad.xyz   (gas)
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const NAMES = ["BUYER", "SELLER_A", "SELLER_B", "SPARE"];

for (const n of NAMES) {
  const pk = generatePrivateKey();
  const addr = privateKeyToAccount(pk).address;
  console.log(`${n}_PK=${pk}`);
  console.log(`${n}_ADDR=${addr}`);
}
console.error("\nFund every *_ADDR above at BOTH faucets before doing anything else.");
