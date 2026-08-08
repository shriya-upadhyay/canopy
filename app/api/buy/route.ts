// The buyer agent, driven from the dashboard.
//
// Runs the full x402 handshake server-side (the buyer's key never touches the
// browser): GET -> 402 -> sign a Permit2 `upto` authorization -> retry.
//
// The buyer authorizes a CEILING of $0.50. Nothing has moved yet at this point
// — settlement happens later, scored on the outcome.

import { NextRequest } from "next/server";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { UptoEvmScheme } from "@x402/evm/upto/client";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { monadTestnet } from "@/lib/chain";
import { MONAD, RPC } from "@/lib/const";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const pk = process.env.BUYER_PK as `0x${string}` | undefined;
    if (!pk) return Response.json({ error: "BUYER_PK missing" }, { status: 500 });

    const seller = req.nextUrl.searchParams.get("seller") ?? "a";
    const asset = req.nextUrl.searchParams.get("asset") ?? "ETH";
    const max = req.nextUrl.searchParams.get("max") ?? "0.5";

    const account = privateKeyToAccount(pk);
    const wallet = createWalletClient({
      account,
      chain: monadTestnet,
      transport: http(RPC),
    });

    // Spread the wallet FIRST, then override signTypedData — the scheme signs
    // an EIP-712 Permit2 witness with the raw account, not the wallet client.
    const signer = {
      ...wallet,
      address: account.address,
      signTypedData: (a: Parameters<typeof account.signTypedData>[0]) =>
        account.signTypedData(a),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const client = new x402Client().register(MONAD, new UptoEvmScheme(signer));
    const paidFetch = wrapFetchWithPayment(fetch, client);

    const origin = req.nextUrl.origin;
    const res = await paidFetch(
      `${origin}/api/signal?seller=${seller}&asset=${encodeURIComponent(asset)}&max=${encodeURIComponent(max)}`
    );
    const body = await res.json();

    return Response.json({ status: res.status, ...body });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The two failures you'll actually hit, translated into English.
    const hint = /PERMIT2_ALLOWANCE|PRECONDITION/i.test(msg)
      ? "Run `npm run approve` — the buyer hasn't approved Permit2."
      : /insufficient funds|gas/i.test(msg)
        ? "Buyer wallet has no MON for gas — faucet.monad.xyz"
        : undefined;
    return Response.json({ error: msg, hint }, { status: 500 });
  }
}
