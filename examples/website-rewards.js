// Paying your website's users, from your own server.
//
//   MENTA_KEY=menta_live_... node website-rewards.js
//   then open http://localhost:3000
//
// A tiny Express-free HTTP server showing the whole shape of a web integration:
// a "Connect Discord" button, a reward endpoint, and a webhook receiver.
//
// THE RULE THAT MATTERS: the key lives HERE, on the server, in an environment
// variable. It never reaches the browser. A key in front-end code is a
// published key -- anyone with the page source can spend your balance.

import { createServer } from "node:http";
import crypto from "node:crypto";

const MENTA = "https://menta.tips/v1";
const KEY = process.env.MENTA_KEY;
const WEBHOOK_SECRET = process.env.MENTA_WEBHOOK_SECRET ?? "";
const PORT = 3000;

const menta = async (method, path, body, idem) => {
  const res = await fetch(MENTA + path, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      ...(idem ? { "idempotency-key": idem } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() };
};

// Pretend session store. Yours is a database.
const users = new Map([["user_42", { name: "Ada" }]]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (status, obj) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  // ---- 1. the connect button ------------------------------------------------
  // Called by your page for the logged-in user. Returns a MENTA-hosted URL;
  // send the browser there and MENTA handles the Discord consent screen.
  if (url.pathname === "/api/connect") {
    const userId = "user_42";                       // ← your own session
    const { body } = await menta("POST", "/links", {
      external_id: userId,
      label: users.get(userId).name,
      // Where MENTA sends them back to. It carries no identity -- ask the API
      // who linked, server side, so a forged return URL proves nothing.
      redirect_url: "https://yourapp.com/connected",
    }, `link-${userId}`);
    return json(200, { status: body.status, url: body.link_url });
  }

  // ---- 2. did they finish? --------------------------------------------------
  if (url.pathname === "/api/status") {
    const { status, body } = await menta("GET", `/links?external_id=user_42`);
    return json(200, status === 200 ? body : { status: "pending" });
  }

  // ---- 3. pay them ----------------------------------------------------------
  // The idempotency key is the reason you can retry this safely. Make it
  // describe the EVENT you are paying for, not the moment you called.
  if (url.pathname === "/api/reward") {
    const { status, body } = await menta("POST", "/tips", {
      to_external: "user_42",
      asset: "USDC",
      amount: "250",
    }, "reward-signup-user_42");

    if (status === 409) return json(409, { needsLink: true, detail: body.error.message });
    return json(status, body);
  }

  // ---- 4. hear about everything ---------------------------------------------
  // Verify before you trust. The signature covers `timestamp.body`, so it must
  // be checked against the RAW bytes -- re-serialising the parsed object
  // changes them and the check fails for the wrong reason.
  if (url.pathname === "/menta-webhook" && req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    const header = req.headers["x-menta-signature"] ?? "";
    if (!verify(WEBHOOK_SECRET, header, raw)) return json(401, { error: "bad signature" });

    const event = JSON.parse(raw);
    console.log(`${event.event}: ${event.amount} ${event.asset.symbol} -> ${event.to.join(", ")}`);
    // Answer immediately; do the slow part afterwards. MENTA retries anything
    // that is not a 2xx, five times, backing off to six hours.
    return json(200, { ok: true });
  }

  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><meta charset="utf-8">
    <h1>Rewards demo</h1>
    <button onclick="go()">Connect Discord</button>
    <button onclick="fetch('/api/reward',{method:'POST'}).then(r=>r.json()).then(o=>alert(JSON.stringify(o)))">
      Send 25 USDC</button>
    <script>
      async function go(){
        const r = await (await fetch('/api/connect',{method:'POST'})).json();
        if (r.url) location = r.url; else alert('Already connected');
      }
    </script>`);
});

function verify(secret, header, rawBody) {
  const parts = Object.fromEntries(String(header).split(",").map((s) => s.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(String(parts.v1 ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
