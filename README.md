# MENTA Tip — Developer API

Build on the candy jar. Read balances, send tips, run drops and rains, read the
live liquidity pools, and get a signed webhook when anything happens — from your
bot, your game, your website, or your Telegram bot.

**Free.** No fee on tips, drops, rains or games. Base URL `https://menta.tips/v1`.

- 📖 Full docs: **<https://menta.tips/api>**
- 🍬 What MENTA is: **<https://menta.tips>**
- 💬 Questions and bug reports: [the Discord](https://discord.gg/cevsfPD8S)

> This repository is the **public developer surface** — the spec, the examples
> and a small client. The bot itself is closed source.

---

## Get a key in ten seconds

In the Discord server you want to build on:

```
$apikey new my-bot
```

MENTA sends the key to your DMs. **It is shown once**, so store it like a
password — an environment variable, never in front-end code, never in a repo.

```bash
curl https://menta.tips/v1/me -H "Authorization: Bearer $MENTA_KEY"
```

Keys are for the server owner and anyone with **Manage Server**. Manage them
with `$apikey`, audit them with `$apikey calls`, and kill one instantly with
`$apikey revoke menta_live_ab12cd`.

## What a key can and cannot do

**A key can never withdraw. There is no endpoint.** Money leaves MENTA through
exactly one path: a Discord command, run by the person who owns the balance,
with a confirmation step. No API call reaches it — not with your key, not with a
stolen one. This is not a permission you can be granted; the route does not
exist.

Three more limits, enforced before any handler runs:

| | |
|---|---|
| **It spends your balance and nobody else's** | There is no `from` parameter anywhere in the API. The account is fixed when the key is minted. |
| **It works in one server** | A key made in a ten-member server cannot post into a ten-thousand-member one, whatever channel id it is handed. |
| **It can have a daily ceiling** | `$apikey new my-bot 500 USDC`, and a leaked key is a bad day rather than an empty jar. |

Rate limit: **120 requests a minute**, burstable to 40. Every response carries
`x-ratelimit-remaining`.

## Endpoints

### Reading

| | |
|---|---|
| `GET /v1/me` | Who the key is, what it may do, what it has spent today |
| `GET /v1/balances` | Your balances, every token |
| `GET /v1/assets?q=usdc` | Search the listed tokens |
| `GET /v1/transactions?limit=50` | Your history, newest first, cursor-paged |
| `GET /v1/guild` | Your server: settings, active members, payouts delivered |
| `GET /v1/leaderboard?asset=USDC` | Who has received the most in your server |
| `GET /v1/drops/{id}` | A drop's status and claim count |
| `GET /v1/links` | Which of your users have connected Discord |
| `GET /v1/webhooks` | Your subscriptions |
| `GET /v1/health` | No key needed — for your status page |

### Writing

| | |
|---|---|
| `POST /v1/tips` | Send to one member or a hundred |
| `POST /v1/drops` | Post a claimable drop in a channel |
| `POST /v1/rain` | Split an amount between whoever is talking |
| `POST /v1/links` | Link one of your own user ids to a Discord account |
| `POST /v1/webhooks` | Subscribe an endpoint to events |
| `DELETE /v1/links/{external_id}` · `DELETE /v1/webhooks/{id}` | Remove one |

## Send a tip

```bash
curl -X POST https://menta.tips/v1/tips \
  -H "Authorization: Bearer $MENTA_KEY" \
  -H "Idempotency-Key: level-up-8412" \
  -H "Content-Type: application/json" \
  -d '{"to": "685908488203010088", "asset": "USDC", "amount": "5"}'
```

```json
{
  "ok": true,
  "transfer_id": "48213",
  "asset": { "symbol": "USDC", "chain": "base", "decimals": 6 },
  "recipients": ["685908488203010088"],
  "per_recipient": { "amount": "5", "amount_base": "5000000" }
}
```

`to` also takes an array — one call, up to 100 members, each getting `amount`.

## Off Discord: Telegram, your website, anywhere

MENTA pays **Discord accounts**. Your Telegram bot knows Telegram ids; your
website knows its own user ids. **Account links** join the two, once, per person.

1. Your app asks MENTA for a link for `telegram:99887`
2. You send that person the URL
3. They click **Connect Discord** once
4. From then on you pay `telegram:99887` by name

```bash
curl -X POST https://menta.tips/v1/links \
  -H "Authorization: Bearer $MENTA_KEY" -H "Idempotency-Key: link-99887" \
  -d '{"external_id": "telegram:99887", "label": "@ada"}'
# -> { "status": "pending", "link_url": "https://menta.tips/link/8Ff2xQ...", "expires_in_hours": 24 }

curl -X POST https://menta.tips/v1/tips \
  -H "Authorization: Bearer $MENTA_KEY" -H "Idempotency-Key: quest-4417" \
  -d '{"to_external": "telegram:99887", "asset": "USDC", "amount": "5"}'
```

Tipping someone who has not connected returns **`409 not_linked`** with their
link URL in the message, and **nothing is sent** — not even to the people in the
same batch who *had* connected. Half-paying a list is worse than either outcome:
you cannot tell which half went through without diffing balances.

**A link is a forwarding address, not a login.** It lets you *pay* that person
and nothing else — no reading their balance, no spending it, no acting as them.


## MENTA Pots — pools whose two sides are on different chains

A **pot** is a constant-product liquidity pool (`x · y = k`) that lives on
MENTA's internal ledger rather than on a chain. Anyone can open one, anyone can
fund one, anyone can trade against it, and every trade leaves a fee behind for
whoever put the liquidity up.

Because both sides are ledger entries rather than contract state, **the two
halves of a pot do not have to be on the same chain**. Pot #1 holds CHAD on WAX
against CHAD on Base — one pool, no bridge between the sides, no wrapped asset,
no gas, and no mempool for anyone to front-run. Trades settle in about a second.

That is the part we have not been able to find anywhere else. To be precise
about what is and is not new:

- **Cross-chain AMMs exist** — Symbiosis, Chainflip and others are cross-chain
  protocols with their own validators and settlement.
- **A Discord swap bot exists** — Swappy is a non-custodial front end that
  routes `/swap` to the Chainflip protocol.
- **tip.cc, the largest tipping bot, has no built-in swap at all** and points
  people at third-party services to trade what they hold.

What appears to be new is the combination: a pool that is *internal to the
ledger*, therefore genuinely cross-chain without a bridge, that **anyone in a
chat window can provide liquidity to** and earn from — with LP shares, fee
accrual and reward emissions, operated entirely through Discord buttons.

### Syrup — rewards poured over a pot

A sponsor can pour a pile of tokens over any pot; it drips to that pot's backers
by the second, in proportion to their share, for a fixed number of days, on top
of the trading fee. **A pour is irreversible** — there is no code path that
returns it to the sponsor. A reward that can be cancelled is not a reward.

### The live feed

Every open pot is published as unauthenticated JSON, refreshed every few
seconds. No key needed:

```bash
curl -s https://menta.tips/api/stats.json | jq '.pots'
```

```jsonc
[
  {
    "id": "1",
    "a": { "symbol": "CHAD", "chain": "wax",  "amount": "2,040,636,028.0445" },
    "b": { "symbol": "CHAD", "chain": "base", "amount": "1,969,323,008.90202677" },
    "price": 0.965054,          // side B per 1 of side A
    "usd": 40.21,               // total depth, both sides
    "feeBps": 30,               // 0.30% of every trade, to the backers
    "backers": 2,
    "swaps": 0,
    "chart": [0.9651, 0.9649],  // price after each trade, oldest first
    "syrup": [
      {
        "symbol": "CHAD",
        "total": "100,000,000",
        "endsAt": "2026-10-01T18:10:22.692Z",
        "daysLeft": 29.99,
        "aprPct": 32.65
      }
    ]
  }
]
```

`amount` fields are display strings for the same reason every amount in this API
is a string — see [Amounts are strings](#amounts-are-strings-always). Treat
`aprPct` as indicative: it is the pour measured against the pot's *current*
depth, so it falls as the pot grows.

Pots are operated from Discord (`$pot` opens a panel with buttons for adding
liquidity, withdrawing, trading and collecting syrup). There are no write
endpoints for pots — money moves into and out of a pool only through a command
run by the person who owns the balance, which is the same rule as withdrawals.

## Amounts are strings. Always.

A JSON number cannot hold `3592961775.5232` without quietly rounding it, and a
payments API that rounds a balance is a payments API that is wrong. So every
amount travels as a string, both directions, and comes back twice:

- `amount` — the human one, `"1,250.5"`
- `amount_base` — the exact integer in the token's smallest unit

**Do arithmetic on the second one.** Sending works the same way: pass
`"amount": "1250.5"` or, if you already hold base units, `"amount_base": "1250500000"`.

## Retries cannot double-send

Every write needs an `Idempotency-Key` header — any string unique to that
attempt. Retry with the same one and you get the **original** response back,
marked `"replayed": true`. Nothing sends twice.

This is not optional and it is not decoration: a request that times out has not
necessarily failed, and *"did my tip go through?"* is a question your code should
never have to guess at. Use something meaningful — an event id, a message id, a
job id.

## Webhooks

```bash
curl -X POST https://menta.tips/v1/webhooks \
  -H "Authorization: Bearer $MENTA_KEY" -H "Idempotency-Key: hook-1" \
  -d '{"url": "https://yourapp.com/menta", "events": ["tip.created", "drop.claimed"]}'
```

Leave `events` out to get everything. The response carries a `secret`, shown
once.

| Event | Fires when |
|---|---|
| `tip.created` | A tip is sent in your server |
| `drop.created` | A drop is funded |
| `drop.claimed` | Someone grabs a piece |
| `drop.settled` | A drop closes and the remainder returns |
| `rain.created` | A rain lands |
| `deposit.credited` | Your deposit is confirmed on chain |
| `withdrawal.sent` | Your withdrawal broadcasts |
| `trade.filled` | A peer-to-peer offer is taken |

Every delivery carries `x-menta-signature: t=1788193268,v1=<hex>` — an
HMAC-SHA256 over `timestamp.body`. Verify it against the **raw** body before you
trust the payload, and reject a timestamp older than five minutes. See
[`examples/webhook-verify.js`](examples/webhook-verify.js) and
[`examples/webhook_verify.py`](examples/webhook_verify.py).

Failed deliveries retry after 30s, 2m, 10m, 1h and 6h. Answer with any 2xx as
soon as you have the payload; do the slow part afterwards.

## Errors

Always the same shape, always a sentence you can show a human.

```json
{ "error": { "code": "insufficient_funds", "message": "You don't have enough USDC for that." } }
```

| Status | Means |
|---|---|
| `400` | Something in the request is wrong — the message says what |
| `401` | Missing, malformed or revoked key |
| `402` | Not enough balance |
| `403` | The key is read-only |
| `404` | No such route, asset, drop or webhook |
| `409` | A recipient has not linked their Discord yet — nothing was sent |
| `429` | Rate limited, or the key's daily cap is reached |
| `500` | Ours. Nothing was charged. |

## In this repo

| | |
|---|---|
| [`openapi.yaml`](openapi.yaml) | The full spec — import into Postman, Insomnia, or a code generator |
| [`sdk/menta.js`](sdk/menta.js) | A tiny zero-dependency client for Node 18+ |
| [`examples/telegram-bot.js`](examples/telegram-bot.js) | A Telegram bot that pays real crypto |
| [`examples/website-rewards.js`](examples/website-rewards.js) | Connect, reward, and verify webhooks |
| [`examples/webhook-verify.js`](examples/webhook-verify.js) · [`.py`](examples/webhook_verify.py) | Signature verification, both languages |

## Keep your key on your server

It is a bearer credential. Put it in an environment variable and call MENTA from
your backend — never from a browser, a mobile app, or anything a user can view
source on. A key in front-end code is a published key. It still cannot withdraw,
and `$apikey revoke` kills it instantly, but until you do it can spend your
balance up to its cap.

---

MIT licensed. Built by [MENTA Tip](https://menta.tips).
