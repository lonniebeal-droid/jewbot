/**
 * Local Ollama binding for Street Trader.
 * Health is a /api/tags ping. Chat is /api/chat.
 * Both call assertLocalSpendOnly and refuse anything that is not local,
 * including when JEWBOT_ALLOW_PAID=1. No broker client lives here.
 */

import { assertLocalSpendOnly } from '../safety';
import {
  assertOllamaAllowed,
  chatOnce,
  type ChatMessage,
  type ChatStreamOptions,
  defaultOllamaConfig,
  isLocalOllamaHost,
  isPaidProviderHost,
  normalizeOllamaHost,
  type OllamaConfig,
  probeOllama,
} from '../llm/ollama';
import { buildSystemPrompt, STREET_DISCLAIMER } from './prompts';

export const STREET_DEFAULT_HOST = 'http://127.0.0.1:11434';

export interface StreetHealth {
  ok: boolean;
  models: string[];
  error?: string;
}

export interface StreetAskResult {
  module: 'street-trader';
  spend: 'local-only';
  tool: 'street_ask';
  disclaimer: string;
  /** True when the asker wanted an order or a broker call. No model hop in that case. */
  refusedOrder: boolean;
  text: string;
  answer: string;
}

/**
 * Local config only. allowPaidApis is forced off.
 * An explicit host does not consult OLLAMA_HOST. A missing host or model does.
 */
export function resolveStreetConfig(partial?: Partial<OllamaConfig>): OllamaConfig {
  const explicitHost = partial?.host?.trim();
  const explicitModel = partial?.model?.trim();
  if (explicitHost && explicitModel) {
    return { host: normalizeOllamaHost(explicitHost), model: explicitModel, allowPaidApis: false };
  }
  const base = defaultOllamaConfig();
  return {
    host: explicitHost ? normalizeOllamaHost(explicitHost) : base.host,
    model: explicitModel || base.model,
    allowPaidApis: false,
  };
}

/**
 * Spend gate. Local Ollama passes. Every other host hits assertLocalSpendOnly(false)
 * and throws before a socket opens.
 */
export function assertStreetLocal(partial?: Partial<OllamaConfig>): OllamaConfig {
  const cfg = resolveStreetConfig(partial);
  const local = isLocalOllamaHost(cfg.host) && !isPaidProviderHost(cfg.host);
  if (!local) {
    const decision = assertLocalSpendOnly(false);
    const reason = decision.ok ? 'Street Trader runs on local Ollama only.' : decision.reason;
    throw new Error(`${reason} Refusing ${cfg.host}.`);
  }
  if (!cfg.model) throw new Error('JEWBOT_MODEL is empty.');
  const decision = assertLocalSpendOnly(false);
  if (decision.ok) {
    throw new Error('Street Trader keeps the spend gate closed.');
  }
  assertOllamaAllowed(cfg);
  return cfg;
}

/** Tags ping. A refused host throws here so a caller cannot treat it as a soft miss. */
export async function streetHealth(partial?: Partial<OllamaConfig>): Promise<StreetHealth> {
  const cfg = assertStreetLocal(partial);
  return probeOllama(cfg);
}

/** A request to send an order or open a broker session. Teaching "what is a stop" is not this. */
export function isLiveOrderRequest(question: string): boolean {
  const q = question.toLowerCase();
  if (/\b(for me|right now|at market)\b/.test(q) && /\b(buy|sell|short|order|trade)\b/.test(q)) return true;
  if (/\b(submit|execute|route|send)\b[\s\S]{0,40}\b(order|trade)\b/.test(q)) return true;
  if (/\bplace\b[\s\S]{0,30}\b(my|the|this|an)\s+(order|trade)\b/.test(q)) return true;
  if (/\b(broker|brokerage)\s+(api|login|password|secret)\b/.test(q)) return true;
  if (/\bapi key\b/.test(q) && /\bbroker\b/.test(q)) return true;
  return false;
}

/**
 * street_ask. Asserts local spend, then chats on Ollama.
 * The disclaimer is attached here so a model reply cannot drop it.
 */
export async function streetAsk(
  question: string,
  partial?: Partial<OllamaConfig>,
  options?: ChatStreamOptions,
): Promise<StreetAskResult> {
  const q = question.trim();
  if (!q) throw new Error('street_ask needs a question.');
  if (q.length > 4_000) throw new Error('street_ask question is too long.');
  const cfg = assertStreetLocal(partial);
  if (isLiveOrderRequest(q)) {
    const answer =
      'Street Trader does not place trades and does not call a broker. Ask how the rule works, then paper it yourself.';
    return {
      module: 'street-trader',
      spend: 'local-only',
      tool: 'street_ask',
      disclaimer: STREET_DISCLAIMER,
      refusedOrder: true,
      answer,
      text: `${STREET_DISCLAIMER}\n\n${answer}`,
    };
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(q) },
    { role: 'user', content: q },
  ];
  const answer = (await chatOnce(messages, cfg, options)).trim();
  return {
    module: 'street-trader',
    spend: 'local-only',
    tool: 'street_ask',
    disclaimer: STREET_DISCLAIMER,
    refusedOrder: false,
    answer,
    text: `${STREET_DISCLAIMER}\n\n${answer}`,
  };
}
