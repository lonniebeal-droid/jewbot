# Street Trader

Former role: a cloud trading agent.

## What it does here

`src/modules/street-trader` is a stub. Health pings local Ollama. This build does not place orders, call a broker, or read an account.

`review_notes` is reserved. If it is wired later, it only calls `moduleChat` on text the owner already has locally.

## What to port

- Note templates and a description of the review, as text.
- Not an order router, not a market-data client, and not a broker SDK.

## What stays owner-local

- Broker logins, API secrets, and account identifiers
- The old agent’s hosted API key
- Live positions and anything that would move money

Those stay on the owner machine. The stub does not ask for them.
