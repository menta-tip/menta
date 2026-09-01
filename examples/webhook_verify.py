"""Verifying a MENTA webhook — Python, Flask, no extra dependencies.

The two things that go wrong here are both silent:

  1. Verifying against a re-serialised body instead of the RAW bytes. Flask's
     ``request.get_json()`` gives you a dict; re-encoding it changes the bytes
     and the HMAC no longer matches. Use ``request.get_data()``.
  2. Skipping the timestamp check. Without it the signature is valid forever, so
     anyone who captures one delivery can replay it at you all day.

Answer 200 as soon as you have the payload and do the slow part afterwards —
MENTA retries anything that is not a 2xx, five times, backing off to six hours.
"""

import hashlib
import hmac
import os
import time

from flask import Flask, request, jsonify

app = Flask(__name__)
SECRET = os.environ["MENTA_WEBHOOK_SECRET"]      # whsec_... shown once at creation
TOLERANCE_SEC = 300


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = TOLERANCE_SEC) -> bool:
    parts = {}
    for piece in (header or "").split(","):
        key, _, value = piece.partition("=")
        if value:
            parts[key.strip()] = value.strip()

    try:
        ts = int(parts["t"])
    except (KeyError, ValueError):
        return False

    if abs(time.time() - ts) > tolerance:        # replay
        return False

    signed = f"{ts}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    # compare_digest, not ==: a plain comparison leaks how much was right.
    return hmac.compare_digest(expected, parts.get("v1", ""))


@app.post("/menta")
def menta_webhook():
    raw = request.get_data()                     # RAW bytes, never the parsed dict
    if not verify(SECRET, request.headers.get("X-Menta-Signature", ""), raw):
        return jsonify(error="bad signature"), 401

    event = request.get_json(force=True)

    # `amount_base` is the exact integer in the token's smallest unit. Use it
    # for anything you add up -- `amount` is the human string, for display.
    kind = event.get("event")
    if kind == "tip.created":
        print(f"tip: {event['amount']} {event['asset']['symbol']} -> {', '.join(event['to'])}")
    elif kind == "deposit.credited":
        print(f"deposit landed: {event['amount']} {event['asset']['symbol']}")
    else:
        print(kind, event.get("amount"), event.get("asset", {}).get("symbol"))

    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(port=3000)
