# Portfolio sweeper

Former role: a cloud agent that swept a portfolio and reported what changed.

## What it does here

`src/modules/portfolio-sweeper` is a stub. Health is a local Ollama tags ping. This build does not call a brokerage and does not move funds.

When wired, it reads a local folder the owner points at (inside the project jail) and summarizes it with `moduleChat`.

## What to port

- The report shape (what “changed” means) as a prompt and a local file layout.
- Nothing that places an order or sends money.

## What stays owner-local

- Brokerage logins, API keys, and account numbers
- Statements and exports that contain account identifiers
- Any hosted agent key the old sweeper used

Keep those on the owner machine. Do not put them in git or in a module prompt.
