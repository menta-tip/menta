// A tiny MENTA client. No dependencies, Node 18+.
//
//   import { Menta } from "./menta.js";
//   const menta = new Menta(process.env.MENTA_KEY);
//   await menta.tip({ to: "685908488203010088", asset: "USDC", amount: "5" });
//
// The only clever thing in here is that every write REQUIRES an idempotency
// key, and the client will not let you skip it. A tip that times out has not
// necessarily failed, and the difference between "retry safely" and "send it
// twice" is one header nobody remembers to set.

const BASE = "https://menta.tips/v1";

export class MentaError extends Error {
  constructor(status, code, message, body) {
    super(message);
    this.name = "MentaError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
  /** Nobody linked their Discord yet — `link_url`s are in the message. */
  get notLinked() { return this.code === "not_linked"; }
  get insufficientFunds() { return this.code === "insufficient_funds"; }
  get rateLimited() { return this.status === 429; }
}

export class Menta {
  /**
   * @param {string} key      menta_live_... — keep it server side
   * @param {object} [opts]   { baseUrl, fetch, timeoutMs }
   */
  constructor(key, opts = {}) {
    if (!key || !key.startsWith("menta_live_")) {
      throw new Error('MENTA key missing or malformed: expected "menta_live_...".');
    }
    this.key = key;
    this.baseUrl = opts.baseUrl ?? BASE;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  async request(method, path, { body, idempotencyKey } = {}) {
    const write = method !== "GET";
    if (write && !idempotencyKey) {
      throw new Error(
        `${method} ${path} needs an idempotency key. Pass one that identifies the ` +
        `EVENT you are paying for -- an event id, a message id, a job id -- not the ` +
        `moment you happened to call. Retrying with the same one returns the first ` +
        `result instead of sending twice.`);
    }
    const res = await this.fetch(this.baseUrl + path, {
      method,
      headers: {
        authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": String(idempotencyKey) } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

    if (!res.ok) {
      const e = json?.error ?? {};
      throw new MentaError(res.status, e.code ?? "http_error",
        e.message ?? `HTTP ${res.status}`, json);
    }
    // Carried through so callers can back off before they are told to.
    json.rateLimitRemaining = Number(res.headers.get("x-ratelimit-remaining") ?? NaN);
    return json;
  }

  // ------------------------------------------------------------- reading ---

  me() { return this.request("GET", "/me"); }
  balances() { return this.request("GET", "/balances"); }
  guild() { return this.request("GET", "/guild"); }
  health() { return this.request("GET", "/health"); }

  assets(q = "", limit = 25) {
    return this.request("GET", `/assets?q=${encodeURIComponent(q)}&limit=${limit}`);
  }
  transactions({ limit = 25, before } = {}) {
    const p = new URLSearchParams({ limit: String(limit) });
    if (before) p.set("before", String(before));
    return this.request("GET", `/transactions?${p}`);
  }
  leaderboard(asset, limit = 10) {
    return this.request("GET", `/leaderboard?asset=${encodeURIComponent(asset)}&limit=${limit}`);
  }
  drop(id) { return this.request("GET", `/drops/${encodeURIComponent(id)}`); }

  // ------------------------------------------------------------- writing ---

  /**
   * Send a tip. Address it with `to` (Discord ids) or `to_external` (your own
   * ids, once they have linked).
   */
  tip({ to, to_external, asset, amount, amount_base, channel_id }, idempotencyKey) {
    return this.request("POST", "/tips", {
      idempotencyKey,
      body: {
        ...(to !== undefined && { to }),
        ...(to_external !== undefined && { to_external }),
        asset,
        ...(amount !== undefined && { amount: String(amount) }),
        ...(amount_base !== undefined && { amount_base: String(amount_base) }),
        ...(channel_id && { channel_id }),
      },
    });
  }

  drop_({ channel_id, asset, amount, amount_base, minutes, max_claims, note }, idempotencyKey) {
    return this.request("POST", "/drops", {
      idempotencyKey,
      body: {
        channel_id, asset,
        ...(amount !== undefined && { amount: String(amount) }),
        ...(amount_base !== undefined && { amount_base: String(amount_base) }),
        ...(minutes && { minutes }), ...(max_claims && { max_claims }),
        ...(note && { note }),
      },
    });
  }
  /** `createDrop` reads better than `drop_`; both do the same thing. */
  createDrop(...args) { return this.drop_(...args); }

  rain({ channel_id, asset, amount, amount_base, active_within_minutes, max_recipients }, idempotencyKey) {
    return this.request("POST", "/rain", {
      idempotencyKey,
      body: {
        channel_id, asset,
        ...(amount !== undefined && { amount: String(amount) }),
        ...(amount_base !== undefined && { amount_base: String(amount_base) }),
        ...(active_within_minutes && { active_within_minutes }),
        ...(max_recipients && { max_recipients }),
      },
    });
  }

  // --------------------------------------------------------------- links ---

  /** Mint (or look up) the link that ties one of your users to a Discord account. */
  link({ external_id, label, redirect_url }, idempotencyKey) {
    return this.request("POST", "/links", {
      idempotencyKey: idempotencyKey ?? `link-${external_id}`,
      body: { external_id, ...(label && { label }), ...(redirect_url && { redirect_url }) },
    });
  }
  links() { return this.request("GET", "/links"); }
  linkStatus(external_id) {
    return this.request("GET", `/links?external_id=${encodeURIComponent(external_id)}`);
  }
  unlink(external_id) {
    return this.request("DELETE", `/links/${encodeURIComponent(external_id)}`);
  }

  // ------------------------------------------------------------ webhooks ---

  createWebhook({ url, events }, idempotencyKey) {
    return this.request("POST", "/webhooks", {
      idempotencyKey: idempotencyKey ?? `hook-${url}`,
      body: { url, ...(events && { events }) },
    });
  }
  webhooks() { return this.request("GET", "/webhooks"); }
  deleteWebhook(id) { return this.request("DELETE", `/webhooks/${encodeURIComponent(id)}`); }
}

/**
 * Verify a webhook delivery.
 *
 * Pass the RAW request body, not a re-serialised object: re-encoding changes
 * the bytes and the signature will fail for the wrong reason.
 */
export async function verifyWebhook(secret, signatureHeader, rawBody, toleranceSec = 300) {
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const parts = {};
  for (const p of String(signatureHeader ?? "").split(",")) {
    const i = p.indexOf("=");
    if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(String(parts.v1 ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
