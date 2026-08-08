// One-time setup: register both demo sellers as ERC-8004 agent identities on
// Monad testnet. registerOnChain() encodes the registration file as an
// on-chain data URI — no IPFS backend needed, one tx per seller.
//
// Paste the printed agentId ("10143:<tokenId>") into lib/sellers.ts's
// erc8004TokenId field for the matching seller. Until that's set, resolve
// routes skip ERC-8004 feedback for that seller (best-effort, see lib/erc8004.ts).
//
//   npm run register:agents
import { SDK } from "agent0-sdk";

const MONAD_CHAIN_ID = 10143;
const RPC = "https://testnet-rpc.monad.xyz";
// Monad TESTNET addresses — NOT the mainnet ones. Verified via eth_getCode.
// See lib/const.ts for the full story.
const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713";

const SELLERS = [
  { pkEnv: "SELLER_A_PK", name: "Intelligent", blurb: "Uses past market data for short-horizon momentum." },
  { pkEnv: "SELLER_B_PK", name: "Random", blurb: "Random baseline with no real edge." },
];

for (const s of SELLERS) {
  const pk = process.env[s.pkEnv];
  if (!pk) throw new Error(`${s.pkEnv} missing from .env.local`);

  const sdk = new SDK({
    chainId: MONAD_CHAIN_ID,
    rpcUrl: RPC,
    privateKey: pk,
    registryOverrides: { [MONAD_CHAIN_ID]: { IDENTITY, REPUTATION } },
  });

  const agent = sdk.createAgent(s.name, s.blurb);
  const handle = await agent.registerOnChain();
  console.log(`${s.name}: tx ${handle.hash} — waiting for confirmation...`);

  const { result } = await handle.waitMined();
  console.log(`${s.name}: agentId = ${result.agentId}  <- paste into lib/sellers.ts\n`);
}
