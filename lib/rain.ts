import crypto from "crypto";

/**
 * Rain sandbox client — scoped cards for agents.
 *
 * A scoped card is a virtual card capped at an amount YOU set at creation.
 * Rain enforces the cap, the MCC allowlist, and the expiry at authorization
 * time — before money moves. That is the guardrail we hand the agent.
 *
 * Note: Rain applies a 1.2x ceiling over amountInUSDCents to absorb auth holds.
 */

export const RAIN_BASE =
  process.env.RAIN_BASE ?? "https://api-dev.raincards.xyz/v1";

/** Sandbox RSA public key for sessionId encryption. */
const SANDBOX_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----`;

/** Accepts either naming convention — .env.local uses RAIN_API / RAIN_COLLATERAL_CONTRACT_ID. */
function env(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  throw new Error(`${keys[0]} missing from .env.local`);
}

const API_KEY = () => env("RAIN_API_KEY", "RAIN_API");
const USER_ID = () => env("RAIN_USER_ID");
const CONTRACT_ID = () => env("RAIN_CONTRACT_ID", "RAIN_COLLATERAL_CONTRACT_ID");

async function rain<T>(
  path: string,
  init: { method?: string; body?: unknown; sessionId?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Api-Key": API_KEY(),
    "content-type": "application/json",
  };
  if (init.sessionId) headers.sessionid = init.sessionId;

  const res = await fetch(`${RAIN_BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Rain ${res.status} ${path}: ${text}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ---------------------------------------------------------------------------
// sessionId — RSA-OAEP(sha1) over base64 of the 32-char hex secret
// ---------------------------------------------------------------------------
export function generateSessionId(secret?: string) {
  const secretKey = secret ?? crypto.randomUUID().replace(/-/g, "");
  if (!/^[0-9A-Fa-f]+$/.test(secretKey))
    throw new Error("secret must be hex");

  const b64 = Buffer.from(secretKey, "hex").toString("base64");
  const encrypted = crypto.publicEncrypt(
    {
      key: SANDBOX_PUBLIC_KEY,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha1",
    },
    Buffer.from(b64, "utf-8"),
  );
  return { secretKey, sessionId: encrypted.toString("base64") };
}

/** AES-128-GCM. Docs' sample omits setAuthTag; we verify properly, then fall back. */
export function decryptSecret(
  base64Secret: string,
  base64Iv: string,
  secretKey: string,
): string {
  const blob = Buffer.from(base64Secret, "base64");
  const iv = Buffer.from(base64Iv, "base64");
  const key = Buffer.from(secretKey, "hex");
  const tagLength = 16;
  const ciphertext = blob.subarray(0, -tagLength);
  const authTag = blob.subarray(-tagLength);

  try {
    const d = crypto.createDecipheriv("aes-128-gcm", key, iv);
    d.setAuthTag(authTag);
    return Buffer.concat([d.update(ciphertext), d.final()]).toString("utf8").trim();
  } catch {
    const d = crypto.createDecipheriv("aes-128-gcm", key, iv);
    d.setAutoPadding(false);
    return d.update(blob).toString("utf8").trim();
  }
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
export interface ScopedCard {
  id: string;
  last4: string;
  expirationMonth: number;
  expirationYear: number;
  status: string;
  encryptedPan?: { iv: string; data: string };
  encryptedCvc?: { iv: string; data: string };
}

export interface CreateScopedCardOpts {
  /** Spend cap in USD cents. Rain authorizes up to 1.2x this. */
  amountInUSDCents: number;
  /** ISO-8601 with UTC offset, e.g. 2026-08-09T00:00:00Z. Max 365d out. */
  expiresAt?: string;
  /** Four-digit MCC allowlist. Omit entirely for no restriction. */
  allowedMccs?: string[];
}

export async function createScopedCard(opts: CreateScopedCardOpts) {
  const { secretKey, sessionId } = generateSessionId();
  const body: Record<string, unknown> = {
    amountInUSDCents: opts.amountInUSDCents,
  };
  if (opts.expiresAt) body.expiresAt = opts.expiresAt;
  if (opts.allowedMccs?.length) body.allowedMccs = opts.allowedMccs;

  const card = await rain<ScopedCard>(
    `/issuing/users/${USER_ID()}/cards/scoped`,
    { method: "POST", body, sessionId },
  );

  let pan: string | undefined;
  let cvc: string | undefined;
  try {
    if (card.encryptedPan)
      pan = decryptSecret(card.encryptedPan.data, card.encryptedPan.iv, secretKey);
    if (card.encryptedCvc)
      cvc = decryptSecret(card.encryptedCvc.data, card.encryptedCvc.iv, secretKey);
  } catch {
    /* card exists regardless; decryption is client-side */
  }

  return { card, pan, cvc, policy: opts };
}

export const getCard = (id: string) => rain<ScopedCard>(`/issuing/cards/${id}`);

// ---------------------------------------------------------------------------
// Collateral + simulation
// ---------------------------------------------------------------------------
export const fundCollateral = (amountCents: number) =>
  rain<unknown>("/simulate/collateral/fund", {
    method: "POST",
    body: {
      contractId: CONTRACT_ID(),
      currency: "rusd",
      amount: amountCents,
    },
  });

export interface SimTxResponse {
  transactionId: string;
  status: "authorized" | "declined" | "settled";
  declinedReason?: string;
  completionReason?: "SETTLEMENT" | "REFUND";
}

export const authorize = (p: {
  cardId: string;
  amount: number; // cents
  merchantName: string;
  merchantCategoryCode: string;
  declineReason?: string;
}) =>
  rain<SimTxResponse>("/simulate/transactions/authorize", {
    method: "POST",
    body: { currency: "USD", ...p },
  });

/**
 * GOTCHA: the quickstart shows `-d '{}'` here. That returns
 * 400 FST_ERR_VALIDATION "body must have required property 'amount'".
 * `amount` (cents) is REQUIRED. Verified against the live sandbox.
 */
export const settle = (transactionId: string, amountCents: number) =>
  rain<SimTxResponse>(`/simulate/transactions/${transactionId}/settle`, {
    method: "POST",
    body: { amount: amountCents },
  });

export const listTransactions = (limit = 20) =>
  rain<unknown>(`/issuing/transactions?limit=${limit}`);
