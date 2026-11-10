/**
 * Local Ollama binding for TwinRent.
 * Health is GET /api/tags. A listing note is POST /api/chat.
 * Both call assertLocalSpendOnly before any helper in src/modules/llm/ollama.ts.
 * The only host is local Ollama. Credentials, keystrokes, and tenant contacts
 * are refused before a socket opens. This file does not publish a listing.
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

export const TWINRENT_HOST = 'http://127.0.0.1:11434';

const DRAFT_SYSTEM = [
  'You are TwinRent, a local listing planner.',
  'Draft a public listing note from the unit facts.',
  'Do not invent a tenant, a phone number, an email, a login, or a platform token.',
  'Do not say the listing was published.',
  'Do not ask for passwords or keystrokes.',
].join(' ');

export interface TwinrentDraft {
  module: 'twinrent';
  spend: 'local-only';
  tool: 'twinrent_draft';
  host: string;
  model: string;
  /** Always false. Drafting does not post the listing. */
  published: false;
  /** True when the facts asked for secrets, keystrokes, or tenant contacts. */
  refused: boolean;
  answer: string;
}

/**
 * Local config only. allowPaidApis is forced off.
 * An explicit host does not consult OLLAMA_HOST. A missing host does.
 * The model follows JEWBOT_MODEL unless the caller passes one.
 */
export function resolveTwinrentConfig(partial?: Partial<OllamaConfig>): OllamaConfig {
  const explicitHost = partial?.host?.trim();
  const explicitModel = partial?.model?.trim();
  let host = TWINRENT_HOST;
  let model = explicitModel || '';
  if (!explicitHost || !model) {
    const base = defaultOllamaConfig();
    if (!explicitHost) {
      host = (process.env.OLLAMA_HOST || '').trim() ? base.host : TWINRENT_HOST;
    }
    if (!model) model = base.model;
  }
  if (explicitHost) host = normalizeOllamaHost(explicitHost);
  return { host, model, allowPaidApis: false };
}

/**
 * Spend gate. assertLocalSpendOnly runs before any Ollama helper.
 * Localhost passes. Every other host throws and does not open a socket.
 */
export function assertTwinrentLocal(partial?: Partial<OllamaConfig>): OllamaConfig {
  const cfg = resolveTwinrentConfig(partial);
  const decision = assertLocalSpendOnly(false);
  const local = isLocalOllamaHost(cfg.host) && !isPaidProviderHost(cfg.host);
  if (!local) {
    const reason = decision.ok ? 'TwinRent runs on local Ollama only.' : decision.reason;
    throw new Error(`${reason} Refusing ${cfg.host}.`);
  }
  if (!cfg.model) throw new Error('TwinRent model is empty.');
  assertOllamaAllowed(cfg);
  return cfg;
}

/** Facts that would capture a secret, keystrokes, or a tenant contact. */
export function isSensitiveListingFacts(facts: string): boolean {
  const q = facts.toLowerCase();
  if (/\b(password|passphrase|api[-_ ]?key|secret key|private key|credential)s?\b/.test(q)) return true;
  if (/\b(oauth|bearer|access)\s+token\b/.test(q)) return true;
  if (/\b(keystroke|keystrokes|keylog|key logger|keylogger)\b/.test(q)) return true;
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(facts)) return true;
  if (/\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/.test(facts)) return true;
  return false;
}

export async function twinrentHealth(partial?: Partial<OllamaConfig>): Promise<ModuleHealth> {
  try {
    const cfg = assertTwinrentLocal(partial);
    const probe = await probeOllama(cfg);
    if (!probe.ok) return { ok: false, detail: probe.error || 'ollama down' };
    const names = probe.models.slice(0, 3).join(', ');
    return { ok: true, detail: names ? `ollama tags: ${names}` : 'ollama tags: (no models)' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * twinrent_draft. Asserts local spend, then asks Ollama for a listing note.
 * Sensitive facts return without a fetch. The result is never published.
 */
export async function twinrentDraft(
  facts: string,
  partial?: Partial<OllamaConfig>,
  options?: ChatStreamOptions,
): Promise<TwinrentDraft> {
  const text = facts.trim();
  if (!text) throw new Error('twinrent_draft needs unit facts.');
  if (text.length > 2_000) throw new Error('twinrent_draft facts are too long.');
  const cfg = assertTwinrentLocal(partial);
  if (isSensitiveListingFacts(text)) {
    return {
      module: 'twinrent',
      spend: 'local-only',
      tool: 'twinrent_draft',
      host: cfg.host,
      model: cfg.model,
      published: false,
      refused: true,
      answer: 'TwinRent does not collect credentials, keystrokes, or tenant contacts. Rephrase the unit facts without them.',
    };
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: DRAFT_SYSTEM },
    { role: 'user', content: text },
  ];
  const answer = (await chatOnce(messages, cfg, options)).trim();
  return {
    module: 'twinrent',
    spend: 'local-only',
    tool: 'twinrent_draft',
    host: cfg.host,
    model: cfg.model,
    published: false,
    refused: false,
    answer,
  };
}
