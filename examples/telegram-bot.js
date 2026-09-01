// A Telegram bot that pays out real crypto through MENTA.
//
// Run it:
//   MENTA_KEY=menta_live_... TELEGRAM_TOKEN=123:abc node telegram-bot.js
//
// No dependencies -- Node 18+ has fetch built in.
//
// THE ONE IDEA WORTH UNDERSTANDING: MENTA pays Discord accounts, and Telegram
// users are not Discord accounts. So the first time you pay someone, MENTA
// hands you a link. They click it once, connect Discord, and from then on you
// address them by their Telegram id and never think about it again.

const MENTA = "https://menta.tips/v1";
const KEY = process.env.MENTA_KEY;
const TG = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

async function menta(method, path, body, idempotencyKey) {
  const res = await fetch(MENTA + path, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      // Required on every write. Reuse the same value to retry safely: MENTA
      // returns the FIRST result rather than sending twice. Here the Telegram
      // message id is perfect -- it is unique and it is already in hand.
      ...(idempotencyKey ? { "idempotency-key": String(idempotencyKey) } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() };
}

const say = (chatId, text) =>
  fetch(`${TG}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });

// ---------------------------------------------------------------- commands --

async function connect(chatId, tgUser) {
  const { body } = await menta("POST", "/links", {
    external_id: `telegram:${tgUser.id}`,
    label: tgUser.username ?? tgUser.first_name,
  }, `link-${tgUser.id}`);

  if (body.status === "linked") {
    return say(chatId, "You're already connected. Tips land in your MENTA balance.");
  }
  return say(chatId,
    `Connect your Discord once and I can pay you:\n${body.link_url}\n\n` +
    `It only lets me pay you — nothing can leave your balance this way.`);
}

async function tip(chatId, fromUser, targetTgId, amount, symbol, messageId) {
  const { status, body } = await menta("POST", "/tips", {
    to_external: `telegram:${targetTgId}`,
    asset: symbol,
    amount: String(amount),
  }, `tip-${messageId}`);

  // 409 means they have not connected Discord yet. MENTA has already minted
  // their link and put it in the message -- nothing was sent.
  if (status === 409) {
    return say(chatId, `They need to connect first:\n${body.error.message.split("-> ")[1] ?? ""}`);
  }
  if (status === 402) return say(chatId, "The tip jar is empty — top it up with $deposit in Discord.");
  if (status !== 200) return say(chatId, `Couldn't send that: ${body.error?.message ?? status}`);

  return say(chatId, `Sent ${body.per_recipient.amount} ${body.asset.symbol} 🍬`);
}

async function balance(chatId) {
  const { body } = await menta("GET", "/balances");
  const lines = body.balances.map((b) => `${b.amount} ${b.symbol} (${b.chain})`);
  return say(chatId, lines.length ? `Jar:\n${lines.join("\n")}` : "The jar is empty.");
}

// ------------------------------------------------------------- the loop -----

let offset = 0;
async function poll() {
  const res = await fetch(`${TG}/getUpdates?timeout=30&offset=${offset}`);
  const { result = [] } = await res.json();

  for (const u of result) {
    offset = u.update_id + 1;
    const msg = u.message;
    if (!msg?.text) continue;
    const [cmd, ...args] = msg.text.trim().split(/\s+/);

    try {
      if (cmd === "/connect") await connect(msg.chat.id, msg.from);
      else if (cmd === "/balance") await balance(msg.chat.id);
      else if (cmd === "/tip") {
        // Reply to someone with: /tip 5 USDC
        const target = msg.reply_to_message?.from;
        if (!target) { await say(msg.chat.id, "Reply to someone with /tip 5 USDC"); continue; }
        await tip(msg.chat.id, msg.from, target.id, args[0] ?? "100", args[1] ?? "USDC", msg.message_id);
      }
    } catch (e) {
      console.error("update failed", e);
    }
  }
}

console.log("listening…");
for (;;) await poll().catch((e) => console.error(e));
