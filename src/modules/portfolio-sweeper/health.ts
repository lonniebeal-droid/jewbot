/**
 * Local tags ping for the portfolio sweeper.
 *
 * Uses `probeOllama` in `src/modules/llm/ollama.ts`, which calls
 * `assertLocalSpendOnly` before `/api/tags`. A non-local or paid host is
 * refused here as well, including when `JEWBOT_ALLOW_PAID=1`, and no socket
 * is opened. This module does not chat and does not send the gate file.
 */

import {
  defaultOllamaConfig,
  isLocalOllamaHost,
  isPaidProviderHost,
  normalizeOllamaHost,
  probeOllama,
} from '../llm/ollama';
import { assertLocalSpendOnly } from '../safety';
import type { ModuleHealth } from '../plugin/types';

export async function portfolioHealth(): Promise<ModuleHealth> {
  let base;
  try {
    base = defaultOllamaConfig();
  } catch (err) {
    return { ok: false, detail: message(err) };
  }
  let host = base.host;
  try {
    host = normalizeOllamaHost(base.host);
  } catch (err) {
    return { ok: false, detail: message(err) };
  }
  const local = isLocalOllamaHost(host) && !isPaidProviderHost(host);
  const decision = assertLocalSpendOnly(false);
  if (!local) {
    const reason = decision.ok ? 'Portfolio sweeper stays on local Ollama.' : decision.reason;
    return { ok: false, detail: `${reason} Refusing ${host}.` };
  }
  const probe = await probeOllama({ host, model: base.model, allowPaidApis: false });
  if (!probe.ok) return { ok: false, detail: probe.error || 'ollama down' };
  const names = probe.models.slice(0, 3).join(', ');
  return { ok: true, detail: names ? `ollama tags: ${names}` : 'ollama tags: (no models)' };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
