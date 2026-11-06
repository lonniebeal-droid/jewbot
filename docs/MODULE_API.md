# Module API

Jewbot is the hub. Every other Lonnie bot registers as a module and runs on the local Ollama runtime. There is no Grok, xAI, or other paid SDK in this tree. Default spend is **$0**.

## `JewbotModule`

```ts
interface JewbotModule {
  id: string;                 // directory name, /^[a-z][a-z0-9-]{0,63}$/
  title: string;
  description: string;
  version: string;            // semver, for example 0.1.0
  capabilities: string[];     // non-empty
  tools?: { name: string; description: string }[];
  start?: () => void | Promise<void>;
  stop?: () => void | Promise<void>;
  health: () => Promise<{ ok: boolean; detail?: string }> | { ok: boolean; detail?: string };
}
```

`id` must match the folder under `src/modules/<id>/`.

## Registry

| Function | Behavior |
|----------|----------|
| `registerModule(mod)` | Validates and stores the module. Throws if the id is already registered or the shape is wrong. |
| `listModules()` | Registered modules, sorted by `id`. |
| `getModule(id)` | The module, or `undefined`. |
| `unregisterModule(id)` | Removes it and returns whether it was present. Does not call `stop`. |

`shutdownModules()` calls `stop` on each registered module. Boot calls `start` once.

Import them from `src/modules/plugin`.

## Discovery and boot

On startup `bootModules()` loads every immediate child of `src/modules/` except `plugin`:

1. `manifest.ts` (compiled to `manifest.js`), which exports `jewbotModule`.
2. Otherwise `jewbot.module.json` (data only). Health for a JSON manifest is the local Ollama tags ping. JSON cannot supply `start`, `stop`, or a custom `health`.

A bad manifest is reported and skipped. The rest still register. The compiled-in catalog registers the same built-ins if disk load fails, so the real Muse module still comes up.

Built-ins that auto-register: `llm`, `agent`, `terminal`, `ssh`, `files`, `cascade`, `safety`, `context`, and `muse`.

`muse` is the finisher merged in PR #8 (`src/modules/muse/index.ts`, `fleet.ts`, `checklist.ts`). The hub only adds `manifest.ts`. It does not replace that module with a stub.

`music-release` is a real local checklist (`src/modules/music-release`). Its queue is `.jewbot/music-release.json`. Drafts use `assertLocalSpendOnly` and `chatOnce`. See `docs/migrations/music-release.md`.

## `jewbot.module.json`

```json
{
  "id": "widget",
  "title": "Widget",
  "description": "What this module is for.",
  "version": "1.0.0",
  "capabilities": ["chat"],
  "tools": [{ "name": "note", "description": "What the tool will do." }]
}
```

`id` must equal the directory name. `capabilities` is a non-empty array of strings. `tools` is optional.

## LLM binding

A module that chats uses `moduleChat` or `moduleChatStream` from `src/modules/plugin`. Those call `assertLocalSpendOnly` from `src/modules/safety` and then `chatOnce` / `chatStream` in `src/modules/llm/ollama.ts`.

Do not add an OpenAI, Anthropic, Grok, or xAI client. Do not put an API key in the repo.

| Variable | Default | Meaning |
|----------|---------|---------|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Base URL. `127.0.0.1:11434` is accepted. |
| `JEWBOT_MODEL` | `qwen2.5-coder:7b` | Model name sent to `/api/chat`. |
| `JEWBOT_ALLOW_PAID` | unset | Must be `1` before a hub chat will contact a non-local or paid hostname. |

Paid hostnames are refused unless `JEWBOT_ALLOW_PAID=1`. The list includes `x.ai` (Grok / xAI), `grok.com`, `openai.com`, `anthropic.com`, and the other suffixes in `ollama.ts`. A non-local host such as a LAN address is refused the same way.

Muse is stricter. `fleetChat` / `fleetHealth` call `assertLocalSpendOnly(false)` for any non-local host, **including when `JEWBOT_ALLOW_PAID=1`**. Muse review traffic stays on fleet Ollama.

Health for chat stubs is `GET /api/tags` on that local host. One in-flight probe is shared. `ok: false` means down. The Modules panel shows `ok` or `down`.

## Adding a module

1. Create `src/modules/<id>/index.ts` that exports `jewbotModule`.
2. Create `src/modules/<id>/manifest.ts` that re-exports it.
3. Add a `README.md` in that folder and `docs/migrations/<id>.md` if the bot is moving off a cloud agent.
4. Import the manifest from `src/modules/plugin/catalog.ts` so it still registers if discovery cannot load the file.
5. If it will chat, call `moduleChat`. Keep secrets in the owner environment or `~/.jewbot/`, never in git.

Migration order for the named bots is in `docs/receipts/2026-11-06-m8-module-loader.md`.
