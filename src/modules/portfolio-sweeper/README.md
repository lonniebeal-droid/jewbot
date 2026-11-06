# Portfolio sweeper

Local checklist for JU Portfolio production-readiness gates. `index.ts` exports `jewbotModule` plus `portfolioListGates`, `portfolioMarkGate`, and `portfolioNextFree`. `manifest.ts` registers the module.

The checklist is `.jewbot/portfolio-gates.json` in the open project (gitignored). When that file is missing, the tools use the bundled gates in `checklist.ts`, which match `docs/migrations/portfolio-sweeper.md`. `portfolio_mark_gate` writes a status into that local file and does not deploy.

`health()` pings local Ollama `/api/tags` through `probeOllama` and `assertLocalSpendOnly`. A non-local host is refused even when `JEWBOT_ALLOW_PAID=1`. This module does not call a brokerage, move funds, or send the gate file to a model.

Env: `OLLAMA_HOST`, `JEWBOT_MODEL`, `JEWBOT_PROJECT_ROOT`. Paid hostnames stay off.
