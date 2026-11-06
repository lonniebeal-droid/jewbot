/**
 * The only chat entry for hub modules.
 * Calls `assertLocalSpendOnly`, then `chatOnce` / `chatStream` in ollama.ts.
 * Paid and non-local hosts are refused unless JEWBOT_ALLOW_PAID=1.
 * Muse does not use this helper: its fleet client refuses non-local hosts
 * even when that flag is set.
 */

import { assertLocalSpendOnly } from '../safety';
import {
  assertOllamaAllowed,
  chatOnce,
  chatStream,
  type ChatMessage,
  type ChatStreamOptions,
  defaultOllamaConfig,
  isLocalOllamaHost,
  isPaidProviderHost,
  normalizeOllamaHost,
  type OllamaConfig,
} from '../llm/ollama';

export function resolveModuleChatConfig(partial?: Partial<OllamaConfig>): OllamaConfig {
  const base = defaultOllamaConfig();
  const host = normalizeOllamaHost(partial?.host ?? base.host);
  const model = (partial?.model ?? base.model).trim();
  const allowPaidApis = partial?.allowPaidApis ?? base.allowPaidApis;
  return { host, model, allowPaidApis };
}

/**
 * Spend gate for hub chat. Local Ollama passes. Anything else needs
 * both the config flag and JEWBOT_ALLOW_PAID=1, then `assertOllamaAllowed`.
 */
export function assertModuleChatAllowed(cfg: OllamaConfig): void {
  const host = normalizeOllamaHost(cfg.host);
  const envAllows = process.env.JEWBOT_ALLOW_PAID === '1';
  const allowPaidApis = cfg.allowPaidApis === true && envAllows;
  const decision = assertLocalSpendOnly(allowPaidApis);
  const local = isLocalOllamaHost(host) && !isPaidProviderHost(host);
  if (!local && !decision.ok) {
    const kind = isPaidProviderHost(host) ? 'paid provider' : 'non-local host';
    throw new Error(`${decision.reason} Refusing ${kind} ${host}.`);
  }
  assertOllamaAllowed({ host, model: cfg.model, allowPaidApis: local ? false : allowPaidApis });
}

export async function moduleChat(
  messages: ChatMessage[],
  partial?: Partial<OllamaConfig>,
  options?: ChatStreamOptions,
): Promise<string> {
  const cfg = resolveModuleChatConfig(partial);
  assertModuleChatAllowed(cfg);
  return chatOnce(messages, { ...cfg, allowPaidApis: process.env.JEWBOT_ALLOW_PAID === '1' && cfg.allowPaidApis }, options);
}

export async function* moduleChatStream(
  messages: ChatMessage[],
  partial?: Partial<OllamaConfig>,
  options?: ChatStreamOptions,
): AsyncGenerator<string, void, unknown> {
  const cfg = resolveModuleChatConfig(partial);
  assertModuleChatAllowed(cfg);
  yield* chatStream(
    messages,
    { ...cfg, allowPaidApis: process.env.JEWBOT_ALLOW_PAID === '1' && cfg.allowPaidApis },
    options,
  );
}
