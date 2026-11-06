# Twinrent

Former role: a cloud agent for rental listings and tenant messages.

## What it does here

`src/modules/twinrent` is a stub. Health is a local Ollama tags ping. It does not publish a listing or call a rental platform.

When wired, a listing note is drafted with `moduleChat`. Publishing stays an owner action outside the module.

## What to port

- The note outline (what a listing draft should cover), as a prompt.
- No platform client.

## What stays owner-local

- Rental-platform tokens and OAuth refresh tokens
- Tenant contact details and documents
- The old cloud agent key

Do not commit tenant data or platform tokens. `OLLAMA_HOST` and `JEWBOT_MODEL` are the only model settings.
