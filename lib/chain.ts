import { defineChain } from "viem";
import { MONAD_CHAIN_ID, RPC, EXPLORER } from "./const";

export const monadTestnet = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "Monad Explorer", url: EXPLORER } },
  testnet: true,
});
