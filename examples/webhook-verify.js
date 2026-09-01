// Verifying a MENTA webhook — Node, no dependencies.
//
// Two things go wrong here and both are silent:
//
//   1. Verifying against a re-serialised object instead of the RAW body. JSON
//      round-trips change byte order and spacing, the HMAC no longer matches,
//      and you spend an afternoon suspecting the signature.
//   2. Skipping the timestamp check. The signature stays valid forever without
//      it, so anybody who captures one delivery can replay it at you all day.
//
// Both are handled below. Answer 2xx as soon as you have the payload and do the
// slow part afterwards — MENTA retries anything that is not a 2xx, five times,
// backing off to six hours.

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.MENTA_WEBHOOK_SECRET;   // whsec_... shown once at creation
const TOLERANCE_SEC = 300;

export function verify(secret, header, rawBody, toleranceSec = TOLERANCE_SEC) {
  const parts = {};
  for (const p of String(header ?? "").split(",")) {
    const i = p.indexOf("=");
    if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  const t = Number(parts.t);
  if (!Number.isFinite(t)) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;   // replay

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(parts.v1 ?? ""));
  // Constant time: a plain === leaks how much of the signature was right.
  return a.length === b.length && timingSafeEqual(a, b);
}

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/menta") {
    res.writeHead(404).end();
    return;
  }

  // Collect the raw bytes. Do NOT let a body parser touch this route.
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");

  if (!verify(SECRET, req.headers["x-menta-signature"], raw)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad signature" }));
    return;
  }

  const event = JSON.parse(raw);

  // Acknowledge first, work second.
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));

  switch (event.event) {
    case "tip.created":
      console.log(`tip: ${event.amount} ${event.asset.symbol} -> ${event.to.join(", ")}`);
      break;
    case "drop.claimed":
      console.log(`claim on drop ${event.transfer_id} by ${event.to.join(", ")}`);
      break;
    case "deposit.credited":
      console.log(`deposit landed: ${event.amount} ${event.asset.symbol}`);
      break;
    default:
      console.log(event.event, event.amount, event.asset?.symbol);
  }

  // `amount_base` is the exact integer. Use it for anything you add up --
  // `amount` is the human string and is for showing people.
}).listen(3000, () => console.log("listening on :3000/menta"));
