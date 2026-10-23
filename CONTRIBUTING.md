# Contributing to Jewbot

Thanks for helping build a free, local-first coding agent.

## Ground rules

1. **$0 by default** — do not add paid API calls without an explicit Safety gate and docs.
2. **No secrets** — never commit `.env`, tokens, private keys, or host credentials.
3. **No silent destruction** — destructive shell/git must go through `src/modules/safety`.
4. **Small PRs** — one milestone or fix per PR when possible.

## Dev setup

```bash
npm install
npm run typecheck
npm start
```

Ollama must be running for LLM features (`ollama serve`).

## Code layout

- `src/main` — Electron main process
- `src/preload` — IPC bridge
- `src/renderer` — UI
- `src/modules/*` — agent, llm, terminal, ssh, files, cascade, safety, context

## Pull requests

- Target `main`
- Include a short test plan (typecheck + smoke)
- Do not force-push shared branches

## License

By contributing, you agree your contributions are licensed under the MIT License.
