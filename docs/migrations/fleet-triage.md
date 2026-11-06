# Fleet triage

Former role: a cloud agent that looked across machines and ranked what was wrong.

## What it does here

`src/modules/fleet-triage` is a stub. `health()` pings local Ollama `/api/tags`. It does not open SSH by itself yet.

When the tool is wired, triage uses the existing SSH module (allowlisted hosts, TOFU, destructive-command gate) and `moduleChat` for the write-up.

## What to port

- The checklist of signals you care about (disk, service down, failed timer), as plain text in the module. No credentials in that list.
- Host names that already live in `~/.jewbot/hosts.json`. Do not add a second inventory service.
- The ranking prompt, pointed at `moduleChat` with `OLLAMA_HOST` and `JEWBOT_MODEL`.

## What stays owner-local

- SSH private keys, passphrases, and `~/.jewbot/hosts.json`
- Any cloud account that used to hold fleet credentials
- Tokens that the old agent used for a hosted control plane

Drop the hosted control-plane client. Do not commit those tokens.
