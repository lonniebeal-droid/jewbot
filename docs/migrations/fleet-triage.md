# Fleet triage

Former role: a cloud agent that looked across machines and ranked what was wrong.

## What it does here

`src/modules/fleet-triage` checks Ollama on the machines you already listed. It does not call a hosted control plane.

- **localhost** uses `probeOllama` in `src/modules/llm/ollama.ts` (`GET /api/tags`).
- **Mac, Dell, Pi, and any other remote** must be allowlisted in the SSH module. The probe is one read-only command: `curl -s http://127.0.0.1:11434/api/tags`. That command is classified with `checkShellCommand` before `ssh.exec`. A destructive command is `BLOCKED` and is not sent. Fleet health never mints a confirmation grant, and it ignores a model-supplied `command`, `approved`, or `executionId`.
- The Modules panel `health()` stays the shared local tags ping. It does not open SSH. The sweep is the `fleet_health` tool.

Signals recorded in the module (`FLEET_SIGNALS`):

- Local Ollama answers `GET /api/tags`.
- Each allowlisted SSH host runs the loopback curl above.
- A failed tags probe means that Ollama service is down.
- Disk space and failed systemd timers are not collected.

## Host files

Two local files. Neither is committed. Do not put passwords, passphrases, private key bytes, tokens, or API keys in either one.

`~/.jewbot/hosts.json` (override `JEWBOT_SSH_HOSTS`) is the SSH allowlist. Shape is unchanged from the SSH module: `name`, `host`, `port`, `username`, and `privateKeyPath` or `agent` or `askPassword`.

`~/.jewbot/fleet.json` (override `JEWBOT_FLEET`) names which of those machines to check. When the file is missing, the fleet is **localhost** plus every allowlisted SSH host.

```json
{
  "hosts": [
    { "name": "localhost", "via": "local" },
    { "name": "mac", "via": "ssh" },
    { "name": "dell", "via": "ssh" },
    { "name": "pi", "via": "ssh" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `name` | Fleet name. Letters, digits, `.`, `_`, `-`. Unique. |
| `via` | `local` or `ssh`. |
| `ssh` | Optional allowlist name when `via` is `ssh`. Defaults to `name`. A name that is not in `hosts.json` is reported `not_allowlisted` and is not connected. |
| `ollama` | Optional base URL when `via` is `local`. Must be loopback (`127.0.0.1`, `localhost`, `::1`). A LAN address or a paid hostname is rejected. Not allowed on `ssh` entries. Remote Ollama is reached by SSH, then curl to `127.0.0.1:11434` on that machine. |

`JEWBOT_ALLOW_PAID=1` does not let this module call a non-local Ollama URL.

## Tools

Registered on the module like Muse (`tools` on `jewbotModule`) and dispatched by the agent loop:

| Tool | Behavior |
| --- | --- |
| `fleet_list` | Prints the fleet. No secrets. |
| `fleet_health` | Checks every host, or one host when `args.host` is set. |

A triage write-up, if you want one later, goes through `moduleChat` with `OLLAMA_HOST` and `JEWBOT_MODEL`. This module does not rank hosts with a cloud model.

## What stays owner-local

- SSH private keys, passphrases, and `~/.jewbot/hosts.json`
- `~/.jewbot/fleet.json`
- Any cloud account that used to hold fleet credentials
- Tokens that the old agent used for a hosted control plane

Drop the hosted control-plane client. Do not commit those tokens.
