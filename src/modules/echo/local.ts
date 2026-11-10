/**
 * Local Ollama binding for Echo.
 * Health is GET /api/tags. A task is POST /api/chat.
 * Both call assertLocalSpendOnly before any helper in src/modules/llm/ollama.ts.
 * Default runtime is http://127.0.0.1:11434 and model tinyllama.
 * A non-local host is refused even when JEWBOT_ALLOW_PAID=1.
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
import type { ModuleHealth } from '../plugin/types';

export const ECHO_HOST = 'http://127.0.0.1:11434';
export const ECHO_MODEL = 'tinyllama';

const ECHO_SYSTEM = [
  'You are Echo, a local worker.',
  'You run on Ollama at 127.0.0.1:11434 with model tinyllama.',
  'Answer the task in plain text.',
  'Do not ask for passwords, API keys, tokens, or keystrokes.',
  'Do not call a paid API and do not claim a cloud agent ran.',
].join(' ');

export interface EchoTaskResult {
  module: 'echo';
  spend: 'local-only';
  tool: 'echo_task';
  host: string;
  model: string;
  /** True when the task asked for credentials or keystrokes. No model hop. */
  refused: boolean;
  answer: string;
}

/**
 * Echo's own defaults. An explicit host or model wins.
 * OLLAMA_HOST is used only when the caller did not pass a host.
 * The model stays tinyllama unless the caller passes one. JEWBOT_MODEL is not Echo's model.
 */
export function resolveEchoConfig(partial?: Partial<OllamaConfig>): OllamaConfig {
  const explicitHost = partial?.host?.trim();
  const explicitModel = partial?.model?.trim();
  let host = ECHO_HOST;
  if (explicitHost) {
    host = normalizeOllamaHost(explicitHost);
  } else if ((process.env.OLLAMA_HOST || '').trim()) {
    host = defaultOllamaConfig().host;
  }
  return {
    host,
    model: explicitModel || ECHO_MODEL,
    allowPaidApis: false,
  };
}

/**
 * Spend gate. assertLocalSpendOnly runs before any Ollama helper.
 * Localhost passes. Every other host throws and does not open a socket.
 */
export function assertEchoLocal(partial?: Partial<OllamaConfig>): OllamaConfig {
  const cfg = resolveEchoConfig(partial);
  const decision = assertLocalSpendOnly(false);
  const local = isLocalOllamaHost(cfg.host) && !isPaidProviderHost(cfg.host);
  if (!local) {
    const reason = decision.ok ? 'Echo runs on local Ollama only.' : decision.reason;
    throw new Error(`${reason} Refusing ${cfg.host}.`);
  }
  if (!cfg.model) throw new Error('Echo model is empty.');
  assertOllamaAllowed(cfg);
  return cfg;
}

/** A task that wants a secret or a keystroke log. Echo does not collect those. */
export function isSensitiveEchoTask(task: string): boolean {
  const q = task.toLowerCase();
  if (/\b(password|passphrase|api[-_ ]?key|secret key|private key|credential)s?\b/.test(q)) return true;
  if (/\b(oauth|bearer|access)\s+token\b/.test(q)) return true;
  if (/\b(keystroke|keystrokes|keylog|key logger|keylogger)\b/.test(q)) return true;
  return false;
}

/** Tags ping. A refused host returns ok:false and does not fetch. */
export async function echoHealth(partial?: Partial<OllamaConfig>): Promise<ModuleHealth> {
  try {
    const cfg = assertEchoLocal(partial);
    const probe = await probeOllama(cfg);
    if (!probe.ok) return { ok: false, detail: probe.error || 'ollama down' };
    const names = probe.models.slice(0, 3).join(', ');
    return { ok: true, detail: names ? `ollama tags: ${names}` : 'ollama tags: (no models)' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * echo_task. Asserts local spend, then chats on Ollama.
 * Credential and keystroke requests return without a fetch.
 */
export async function echoTask(
  task: string,
  partial?: Partial<OllamaConfig>,
  options?: ChatStreamOptions,
): Promise<EchoTaskResult> {
  const text = task.trim();
  if (!text) throw new Error('echo_task needs a task.');
  if (text.length > 8_000) throw new Error('echo_task is too long.');
  const cfg = assertEchoLocal(partial);
  if (isSensitiveEchoTask(text)) {
    return {
      module: 'echo',
      spend: 'local-only',
      tool: 'echo_task',
      host: cfg.host,
      model: cfg.model,
      refused: true,
      answer: 'Echo does not collect credentials or keystrokes. Rephrase the task without secrets.',
    };
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: ECHO_SYSTEM },
    { role: 'user', content: text },
  ];
  const answer = (await chatOnce(messages, cfg, options)).trim();
  return {
    module: 'echo',
    spend: 'local-only',
    tool: 'echo_task',
    host: cfg.host,
    model: cfg.model,
    refused: false,
    answer,
  };
}
