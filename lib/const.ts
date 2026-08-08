/**
 * Monad testnet + x402 constants.
 * Verified live against GET https://x402-facilitator.molandak.org/supported
 */

export const MONAD = "eip155:10143" as const; // testnet
export const MONAD_CHAIN_ID = 10143;

/** USDC on Monad testnet. 6 decimals. EIP-712 domain name "USDC", version "2". */
export const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as const;

export const USDC_DECIMALS = 6;

/**
 * Monad USDC's EIP-712 domain uses name "USDC" — NOT "USD Coin" like mainnet.
 * Get this wrong and signatures verify locally but fail at the facilitator.
 */
export const USDC_DOMAIN = { name: "USDC", version: "2" } as const;

export const FACILITATOR = "https://x402-facilitator.molandak.org";
export const RPC = "https://testnet-rpc.monad.xyz";
export const EXPLORER = "https://testnet.monadexplorer.com";

/**
 * x402UptoPermit2Proxy — the spender the buyer must approve inside Permit2.
 * Correct deployed address, shipped in @x402/evm@2.12.0. Earlier versions
 * (2.9.0–2.11.0) point at 0x402039b3... which is NOT deployed on Monad and
 * fails at settlement with no useful error.
 */
export const UPTO_PERMIT2_PROXY =
  "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002" as const;

/** Canonical Permit2, same address on every EVM chain. */
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/**
 * Fallback only. The facilitator address MUST be bound into the Permit2
 * witness — read it from /supported at runtime via getFacilitatorAddress().
 */
export const FACILITATOR_ADDR_FALLBACK =
  "0x7f6a2850669202519f0fe8aa912451238820db86" as const;

/**
 * ERC-8004 on Monad TESTNET. NOT the same addresses as Monad mainnet —
 * verified via eth_getCode against https://testnet-rpc.monad.xyz. The
 * mainnet addresses (0x8004A169...432 / 0x8004BAa1...b63) return empty code
 * here; a register() call against them succeeds as a silent no-op (no logs,
 * ~37k gas) instead of reverting, so the mismatch doesn't fail loudly.
 * These are the shared vanity addresses erc-8004-contracts deploys across
 * testnets (Sepolia, Base Sepolia, ...), confirmed present on Monad testnet too.
 */
export const ERC8004_IDENTITY =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
export const ERC8004_REPUTATION =
  "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;
