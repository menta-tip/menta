// Read MENTA's live liquidity pools. No key, no auth, no rate limit to worry
// about — the feed is a static file nginx serves, rewritten every few seconds.
//
//   node examples/pots-feed.js
//
// Useful for a price widget, a Telegram alert when a pool gets deep enough to
// trade against, or a dashboard row next to your own numbers.

import { pathToFileURL } from "node:url";

const FEED = "https://menta.tips/api/stats.json";

/** Every open pot, with its reserves, price, fee and any rewards on it. */
export async function pots() {
  const r = await fetch(FEED, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`feed returned ${r.status}`);
  const body = await r.json();
  return body.pots ?? [];
}

/**
 * The pots that trade a given symbol, quoted as "1 <symbol> = n <other>".
 *
 * A pot stores its sides in a fixed order, so which side your token is on
 * decides whether the published price needs inverting. Getting this backwards
 * is the one easy mistake with this feed.
 */
export async function priceOf(symbol) {
  const want = symbol.toUpperCase();
  const out = [];
  for (const p of await pots()) {
    const isA = p.a.symbol.toUpperCase() === want;
    const isB = p.b.symbol.toUpperCase() === want;
    if (!isA && !isB) continue;
    const other = isA ? p.b : p.a;
    out.push({
      pot: p.id,
      pair: `${p.a.symbol}/${p.a.chain} <-> ${p.b.symbol}/${p.b.chain}`,
      // p.price is side B per 1 of side A.
      rate: isA ? p.price : (p.price ? 1 / p.price : 0),
      per: other.symbol,
      onChain: other.chain,
      depthUsd: p.usd,
      feePct: p.feeBps / 100,
      backers: p.backers,
    });
  }
  return out;
}

/**
 * What a pot pays a liquidity provider: the trading fee plus any syrup.
 *
 * `aprPct` is the pour measured against the pot's CURRENT depth, so it falls as
 * the pot grows. Show it as indicative, never as a promise.
 */
export async function rewards() {
  return (await pots())
    .filter((p) => (p.syrup ?? []).length)
    .map((p) => ({
      pot: p.id,
      feePct: p.feeBps / 100,
      pours: p.syrup.map((s) => ({
        token: s.symbol,
        total: s.total,
        daysLeft: Math.round(s.daysLeft * 10) / 10,
        aprPct: s.aprPct == null ? null : Math.round(s.aprPct),
      })),
    }));
}

// Run directly for a quick look. pathToFileURL rather than a template string:
// on Windows argv[1] is a backslash path and the naive comparison never matches.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const all = await pots();
  console.log(`${all.length} open pot(s)\n`);
  for (const p of all) {
    console.log(`#${p.id}  ${p.a.symbol}/${p.a.chain} <-> ${p.b.symbol}/${p.b.chain}`);
    console.log(`  ${p.a.amount} ${p.a.symbol}`);
    console.log(`  ${p.b.amount} ${p.b.symbol}`);
    console.log(`  1 ${p.a.symbol} = ${p.price} ${p.b.symbol}`);
    if (p.usd != null) console.log(`  depth $${p.usd.toFixed(2)}`);
    console.log(`  fee ${(p.feeBps / 100).toFixed(2)}% to ${p.backers} backer(s)`);
    for (const s of p.syrup ?? []) {
      console.log(
        `  + ${s.total} ${s.token ?? s.symbol} over ${s.daysLeft.toFixed(1)} more days` +
        (s.aprPct ? ` (~${Math.round(s.aprPct)}% APR at current depth)` : ""));
    }
    console.log();
  }
}
