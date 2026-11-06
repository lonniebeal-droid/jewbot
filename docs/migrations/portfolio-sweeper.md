# Portfolio sweeper

Former role: close JU Portfolio production-readiness gates. The old agent swept a portfolio and reported what changed. This module keeps that checklist on the machine and records status locally.

## What it does here

`src/modules/portfolio-sweeper` is a local module. It does not call a brokerage, place an order, send money, or deploy.

Tools:

| Tool | What it does |
|------|----------------|
| `portfolio_list_gates` | Read `.jewbot/portfolio-gates.json`. If the file is missing, return the bundled checklist below and write nothing. |
| `portfolio_mark_gate` | Set one gate's `status` to `open`, `blocked`, or `done` in that file. Other fields stay as they were. `deployed` in the result is always false. |
| `portfolio_next_free` | Return the next gate whose status is `open` and whose blocker is not `owner` or `human`. |

A missing file is created from the bundled checklist only when a gate is marked. The file lives under the project root (or `JEWBOT_PROJECT_ROOT`). `.jewbot/` is gitignored. A symlink for `.jewbot/` or the gate file is refused so a status write cannot land outside the project.

`health()` calls `assertLocalSpendOnly(false)` and then `probeOllama` in `src/modules/llm/ollama.ts` (`GET /api/tags`). A paid or non-local host is refused, including when `JEWBOT_ALLOW_PAID=1`. The gate file is not sent to the model. This module does not chat.

## Bundled checklist

Used when `.jewbot/portfolio-gates.json` is absent. The same gates are in `src/modules/portfolio-sweeper/checklist.ts`.

```json
{
  "version": 1,
  "gates": [
    {
      "id": "local-change-report",
      "title": "Record what changed in the local portfolio folder",
      "status": "open",
      "blocker": null
    },
    {
      "id": "readiness-checklist",
      "title": "Keep the JU Portfolio production-readiness checklist in the local gate file",
      "status": "open",
      "blocker": null
    },
    {
      "id": "secrets-stay-local",
      "title": "Keep brokerage logins, API keys, and account numbers off git",
      "status": "open",
      "blocker": {
        "kind": "owner",
        "note": "Owner confirms secrets stay on this machine. This module does not read them."
      }
    },
    {
      "id": "no-orders",
      "title": "Confirm the sweeper never places an order or sends money",
      "status": "open",
      "blocker": null
    },
    {
      "id": "production-signoff",
      "title": "Owner signs the JU Portfolio production-readiness gate",
      "status": "blocked",
      "blocker": {
        "kind": "human",
        "note": "A person signs off. Marking this gate does not deploy."
      }
    },
    {
      "id": "paid-spend-off",
      "title": "Confirm review stays on local Ollama at $0",
      "status": "open",
      "blocker": null
    }
  ]
}
```

`portfolio_next_free` on this list returns `local-change-report`. `secrets-stay-local` stays off that path because the blocker kind is `owner`. `production-signoff` stays off it because the status is `blocked` and the blocker kind is `human`.

A gate file may use a string blocker. `owner: …` and `human: …` are owner and human blockers. Any other text that contains the word `owner` or `human` is treated the same way. Other text is a local note. A local note does not by itself hide an `open` gate.

## What to port

- The report shape (what “changed” means) as a later local-folder summary. Keep it on `moduleChat` if a summary is added. Do not send account identifiers in that prompt.
- Nothing that places an order, sends money, or deploys.

## What stays owner-local

- Brokerage logins, API keys, and account numbers
- Statements and exports that contain account identifiers
- Any hosted agent key the old sweeper used
- The gate file, once it holds notes the owner typed

Keep those on the owner machine. Do not put them in git or in a module prompt.
