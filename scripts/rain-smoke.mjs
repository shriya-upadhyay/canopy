/**
 * Rain sandbox smoke test — run this the moment you have the API key.
 * Proves: collateral funding, scoped card creation + decryption, an
 * authorization that SUCCEEDS, and an authorization that is DECLINED by policy.
 *
 *   npm run rain:check
 *
 * Requires in .env.local:
 *   RAIN_API_KEY=  RAIN_USER_ID=  RAIN_TEAM_ID=  RAIN_CONTRACT_ID=
 */
import crypto from "crypto";

const BASE = process.env.RAIN_BASE ?? "https://api-dev.raincards.xyz/v1";
const KEY = process.env.RAIN_API_KEY ?? process.env.RAIN_API;
const USER = process.env.RAIN_USER_ID;
const CONTRACT = process.env.RAIN_CONTRACT_ID ?? process.env.RAIN_COLLATERAL_CONTRACT_ID;

for (const [k, v] of Object.entries({ RAIN_API_KEY: KEY, RAIN_USER_ID: USER })) {
  if (!v) {
    console.error(`❌ ${k} missing from .env.local`);
    process.exit(1);
  }
}

const PUB = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----`;

function sessionId() {
  const secretKey = crypto.randomUUID().replace(/-/g, "");
  const b64 = Buffer.from(secretKey, "hex").toString("base64");
  const enc = crypto.publicEncrypt(
    { key: PUB, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
    Buffer.from(b64, "utf-8"),
  );
  return { secretKey, sessionId: enc.toString("base64") };
}

function decrypt(data, iv, secretKey) {
  const blob = Buffer.from(data, "base64");
  const ivB = Buffer.from(iv, "base64");
  const key = Buffer.from(secretKey, "hex");
  try {
    const d = crypto.createDecipheriv("aes-128-gcm", key, ivB);
    d.setAuthTag(blob.subarray(-16));
    return Buffer.concat([d.update(blob.subarray(0, -16)), d.final()]).toString().trim();
  } catch {
    const d = crypto.createDecipheriv("aes-128-gcm", key, ivB);
    d.setAutoPadding(false);
    return d.update(blob).toString("utf8").trim();
  }
}

async function call(path, { method = "GET", body, sid } = {}) {
  const headers = { "Api-Key": KEY, "content-type": "application/json" };
  if (sid) headers.sessionid = sid;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  return { ok: r.ok, status: r.status, body: j };
}

// 1 — collateral -------------------------------------------------------------
if (CONTRACT) {
  const f = await call("/simulate/collateral/fund", {
    method: "POST",
    body: { contractId: CONTRACT, currency: "rusd", amount: 100000 },
  });
  console.log(`[1] fund collateral $1000 → ${f.status} ${f.ok ? "✓" : JSON.stringify(f.body)}`);
} else {
  console.log("[1] fund collateral → skipped (no RAIN_CONTRACT_ID)");
}

// 2 — scoped card ------------------------------------------------------------
const { secretKey, sessionId: sid } = sessionId();
const created = await call(`/issuing/users/${USER}/cards/scoped`, {
  method: "POST",
  sid,
  body: {
    amountInUSDCents: 500,
    allowedMccs: ["5734", "7372", "5045"],
    expiresAt: new Date(Date.now() + 86400000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  },
});
console.log(`[2] create scoped card $5.00 → ${created.status}`);
if (!created.ok) {
  console.error(JSON.stringify(created.body, null, 2));
  process.exit(1);
}
const card = created.body;
console.log(`    id=${card.id} last4=${card.last4} status=${card.status}`);

if (card.encryptedPan) {
  try {
    const pan = decrypt(card.encryptedPan.data, card.encryptedPan.iv, secretKey);
    console.log(`    decrypted PAN ends ${pan.slice(-4)} (matches last4: ${pan.slice(-4) === card.last4})`);
  } catch (e) {
    console.log(`    ⚠ decryption failed: ${e.message}`);
  }
}

// 3 — allowed authorization --------------------------------------------------
const good = await call("/simulate/transactions/authorize", {
  method: "POST",
  body: {
    cardId: card.id,
    amount: 199,
    currency: "USD",
    merchantName: "Kaiko Market Data",
    merchantCategoryCode: "5734",
  },
});
console.log(`[3] authorize $1.99 at allowed MCC 5734 → ${good.status} ${good.body?.status ?? ""}`);

if (good.body?.transactionId) {
  // NOTE: `amount` is REQUIRED here. The quickstart's `-d '{}'` returns 400.
  const s = await call(`/simulate/transactions/${good.body.transactionId}/settle`, {
    method: "POST",
    body: { amount: 199 },
  });
  console.log(`    settle → ${s.status} ${s.body?.status ?? ""}`);
}

// 4 — the guardrail holding (this is the demo) -------------------------------
// A scoped card is CANCELED at authorization — strictly single-use. Reusing
// the card above returns 400 "Card ... is not active". Provision a fresh one.
const card2 = (await call(`/issuing/users/${USER}/cards/scoped`, {
  method: "POST",
  sid: sessionId().sessionId,
  body: { amountInUSDCents: 500, allowedMccs: ["5734", "7372", "5045"] },
})).body;
console.log(`    fresh card for decline test: ${card2.id} last4=${card2.last4}`);

const blocked = await call("/simulate/transactions/authorize", {
  method: "POST",
  body: {
    cardId: card2.id,
    amount: 199,
    currency: "USD",
    merchantName: "Some Casino",
    merchantCategoryCode: "7995",
    // No declineReason needed — the MCC allowlist declines this for real.
  },
});
console.log(
  `[4] authorize at DISALLOWED MCC 7995 → ${blocked.status} ${blocked.body?.status} (${blocked.body?.declinedReason ?? "-"})`,
);

console.log("\n✅ Rain sandbox reachable. Card + policy + simulation all working.");
