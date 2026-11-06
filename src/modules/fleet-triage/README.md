# Fleet triage

Local fleet health for machines you already run. `index.ts` exports `jewbotModule` plus `listFleet` and `checkFleet`. `manifest.ts` registers the module.

`health()` is the shared local Ollama `/api/tags` ping used by the Modules panel. It does not open SSH. `fleet_health` is the sweep: localhost goes through `probeOllama`, and each allowlisted SSH host runs `curl -s http://127.0.0.1:11434/api/tags`. That command still passes the destructive-command gate.

Host names come from `~/.jewbot/fleet.json` when that file exists. Otherwise the list is localhost plus every host in `~/.jewbot/hosts.json`. Passwords, passphrases, and private keys are rejected if they appear in the fleet file. They stay in the SSH hosts file's `privateKeyPath` / agent / prompt fields, or only in memory.

Env: `OLLAMA_HOST`, `JEWBOT_MODEL`, `JEWBOT_FLEET`, `JEWBOT_SSH_HOSTS`. A non-local `OLLAMA_HOST` is refused even when `JEWBOT_ALLOW_PAID=1`. See `docs/migrations/fleet-triage.md`.
