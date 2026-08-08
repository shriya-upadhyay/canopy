/**
 * Permit2 approval — run ONCE per wallet, right after funding.
 *
 * `upto` is Permit2-only. Without this you get:
 *   412 PRECONDITION_FAILED / PERMIT2_ALLOWANCE_REQUIRED
 * ...in the middle of your demo.
 *
 * BUYERS need it to pay for signals.
 * SELLERS need it too, because their bond is an upto authorization as well.
 *
 *   npm run approve              # buyer + both sellers
 *   npm run approve -- BUYER     # just one
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  parseAbi,
  maxUint160,
  maxUint256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPermit2ApprovalTx,
  getPermit2AllowanceReadParams,
} from "@x402/evm/upto/client";

const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const UPTO_PROXY = "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002";
const RPC = "https://testnet-rpc.monad.xyz";
const EXPLORER = "https://testnet.monadexplorer.com";

const monad = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  testnet: true,
});

const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160,uint48,uint48)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const pub = createPublicClient({ chain: monad, transport: http(RPC) });
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["BUYER", "SELLER_A", "SELLER_B"];

let failures = 0;

for (const name of names) {
  const pk = process.env[`${name}_PK`];
  if (!pk) {
    console.log(`\n${name}: ⚠  ${name}_PK missing, skipping`);
    continue;
  }

  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: monad, transport: http(RPC) });
  console.log(`\n━━ ${name}  ${account.address}`);

  const [mon, usdc] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [account.address] }),
  ]);
  console.log(`   MON ${(Number(mon) / 1e18).toFixed(4)}   USDC ${(Number(usdc) / 1e6).toFixed(2)}`);

  if (mon === 0n) {
    console.log("   ❌ no MON for gas → faucet.monad.xyz");
    failures++;
    continue;
  }
  if (usdc === 0n) console.log("   ⚠  no USDC → faucet.circle.com (Monad Testnet)");

  try {
    // step 1 — ERC-20 approve(Permit2)
    const cur = await pub.readContract(
      getPermit2AllowanceReadParams({ tokenAddress: USDC, ownerAddress: account.address }),
    );
    if (cur < maxUint256 / 2n) {
      const tx = createPermit2ApprovalTx(USDC);
      const h = await wallet.sendTransaction({ to: tx.to, data: tx.data });
      await pub.waitForTransactionReceipt({ hash: h });
      console.log(`   [1/2] ERC20→Permit2 ✓ ${EXPLORER}/tx/${h}`);
    } else {
      console.log("   [1/2] ERC20→Permit2 ✓ already approved");
    }

    // step 2 — Permit2.approve(USDC, uptoProxy, max, farFuture)
    const now = Math.floor(Date.now() / 1000);
    const [amt, exp] = await pub.readContract({
      address: PERMIT2, abi: permit2Abi, functionName: "allowance",
      args: [account.address, USDC, UPTO_PROXY],
    });
    if (amt < maxUint160 / 2n || Number(exp) < now + 86400) {
      const h = await wallet.writeContract({
        address: PERMIT2, abi: permit2Abi, functionName: "approve",
        args: [USDC, UPTO_PROXY, maxUint160, 2_000_000_000],
      });
      await pub.waitForTransactionReceipt({ hash: h });
      console.log(`   [2/2] Permit2→uptoProxy ✓ ${EXPLORER}/tx/${h}`);
    } else {
      console.log("   [2/2] Permit2→uptoProxy ✓ already approved");
    }

    const [a2, e2] = await pub.readContract({
      address: PERMIT2, abi: permit2Abi, functionName: "allowance",
      args: [account.address, USDC, UPTO_PROXY],
    });
    const ok = a2 > 0n && Number(e2) > now;
    console.log(`   ${ok ? "✅ READY" : "❌ NOT READY"}`);
    if (!ok) failures++;
  } catch (e) {
    console.log(`   ❌ ${e.shortMessage ?? e.message}`);
    failures++;
  }
}

console.log(`\n${failures === 0 ? "✅ all wallets ready" : `❌ ${failures} wallet(s) not ready`}`);
process.exit(failures === 0 ? 0 : 1);
