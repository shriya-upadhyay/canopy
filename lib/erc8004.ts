// ERC-8004 identity + reputation, via agent0-sdk.
//
// Registration (mint an agent identity) happens once, offline, via
// scripts/register-agents.mjs — not on the request path. registerOnChain()
// encodes the registration file as an on-chain data URI, so no IPFS backend
// is needed.
//
// Feedback happens live: after a signal resolves, the BUYER submits reputation
// feedback about the SELLER it just transacted with, scored by the same
// accuracy used to settle the payment and the bond. Best-effort — a feedback
// failure (e.g. seller has no registered agent yet) shouldn't block settlement.
//
// Monad testnet (eip155:10143) isn't in agent0-sdk's default registry table,
// so registryOverrides points it at the same Identity/Reputation addresses
// already pinned in lib/const.ts.

import { SDK } from "agent0-sdk";
import { MONAD_CHAIN_ID, RPC, ERC8004_IDENTITY, ERC8004_REPUTATION } from "./const";

function makeSDK(privateKey: `0x${string}`) {
  return new SDK({
    chainId: MONAD_CHAIN_ID,
    rpcUrl: RPC,
    privateKey,
    registryOverrides: {
      [MONAD_CHAIN_ID]: { IDENTITY: ERC8004_IDENTITY, REPUTATION: ERC8004_REPUTATION },
    },
  });
}

/** Format a token id minted on Monad testnet as an agent0 AgentId ("10143:<tokenId>"). */
export const agentId = (tokenId: string | number) => `${MONAD_CHAIN_ID}:${tokenId}`;

/**
 * Register a fresh ERC-8004 agent identity on Monad testnet, owned by `privateKey`.
 * One-time setup — see scripts/register-agents.mjs, not called from any route.
 */
export async function registerAgent(
  privateKey: `0x${string}`,
  name: string,
  description: string,
) {
  const sdk = makeSDK(privateKey);
  const agent = sdk.createAgent(name, description);
  const handle = await agent.registerOnChain();
  const { result } = await handle.waitMined();
  if (!result.agentId) throw new Error("registerOnChain did not return an agentId");
  return { agentId: result.agentId, txHash: handle.hash };
}

/**
 * Buyer reviews a seller off the same accuracy score used to settle the
 * signal and the bond. Returns null (rather than throwing) on any failure —
 * missing BUYER_PK, seller not yet registered, RPC hiccup — so a feedback
 * miss never blocks the settlement response.
 */
export async function giveFeedback(
  sellerAgentId: string,
  accuracy: number,
  asset: string,
): Promise<{ txHash: string } | null> {
  const buyerPk = process.env.BUYER_PK as `0x${string}` | undefined;
  if (!buyerPk) return null;

  try {
    const sdk = makeSDK(buyerPk);
    const handle = await sdk.giveFeedback(sellerAgentId, accuracy, "directional", asset);
    return { txHash: handle.hash };
  } catch (e) {
    console.error("ERC-8004 feedback failed:", e);
    return null;
  }
}
