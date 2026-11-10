/**
 * Local Ollama provider — zero API spend by default.
 *
 * Speaks the Ollama HTTP API (NDJSON /api/chat and /api/tags).
 * Localhost is always allowed. Any other host, and every known paid
 * provider hostname (including Grok / xAI), is refused unless
 * JEWBOT_ALLOW_PAID=1. Hub modules that chat call this file plus
 * `assertLocalSpendOnly` from safety.
 */

import { assertLocalSpendOnly } from '../safety';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface OllamaConfig {
  host: string;
  model: string;
  allowPaidApis: boolean;
  /**
   * Opt-in for the LAN host registry. Loopback is already allowed.
   * When set, RFC1918, Tailscale 100.64/10, and IPv6 ULA may be contacted.
   * Public addresses and paid hostnames stay refused. Default callers leave this unset.
   */
  allowPrivateLan?: boolean;
}

export interface ChatStreamOptions {
  signal?: AbortSignal;
  /** Defaults to 120s. Tags/list calls use a shorter timeout. */
  timeoutMs?: number;
}

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5-coder:7b';
const CHAT_TIMEOUT_MS = 120_000;
const TAGS_TIMEOUT_MS = 8_000;

/** Hosts that bill an API key. Matched on the registrable suffix. */
const PAID_PROVIDER_SUFFIXES = [
  'openai.com',
  'anthropic.com',
  'googleapis.com',
  'ai.google.dev',
  'groq.com',
  'mistral.ai',
  'openrouter.ai',
  'together.xyz',
  'together.ai',
  'fireworks.ai',
  'azure.com',
  'cohere.com',
  'cohere.ai',
  'deepseek.com',
  'perplexity.ai',
  'x.ai',
  'grok.com',
];

export function normalizeOllamaHost(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return DEFAULT_HOST;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Invalid OLLAMA_HOST: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported OLLAMA_HOST protocol: ${url.protocol}`);
  }
  url.search = '';
  url.hash = '';
  url.pathname = '';
  return url.toString().replace(/\/$/, '');
}

function hostnameOf(host: string): string {
  const url = new URL(host);
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

export function isLocalOllamaHost(host: string): boolean {
  let hostname: string;
  try {
    hostname = hostnameOf(normalizeOllamaHost(host));
  } catch {
    return false;
  }
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname === 'host.docker.internal'
  ) {
    return true;
  }
  if (hostname.endsWith('.localhost')) return true;
  // 127.0.0.0/8 — compare octets so "127.0.0.1.evil.com" cannot slip through.
  const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const octets = v4.slice(1).map((n) => Number(n));
  if (octets.some((n) => n > 255)) return false;
  return octets[0] === 127;
}

function ipv4Octets(hostname: string): number[] | null {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((n) => n > 255)) return null;
  return octets;
}

/** 10/8, 172.16/12, 192.168/16, and Tailscale's 100.64/10 range. Not the rest of 100/8. */
export function isPrivateOrTailscaleIPv4(hostname: string): boolean {
  const octets = ipv4Octets(hostname);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isIpv6Ula(hostname: string): boolean {
  if (!hostname.includes(':')) return false;
  const first = hostname.split(':')[0] || '0';
  if (!/^[0-9a-f]{1,4}$/i.test(first)) return false;
  const value = Number.parseInt(first, 16);
  return value >= 0xfc00 && value <= 0xfdff;
}

/**
 * Addresses the LAN registry may contact after assertLocalSpendOnly(false).
 * Loopback, private LAN, Tailscale 100.64/10, and IPv6 unique-local.
 * Public IPs, 0.0.0.0, and ordinary DNS names are not in this set.
 */
export function isRoutableFreeHost(host: string): boolean {
  let hostname: string;
  try {
    hostname = hostnameOf(normalizeOllamaHost(host));
  } catch {
    return false;
  }
  if (isPaidProviderHost(normalizeOllamaHost(host))) return false;
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1') return true;
  const v4 = ipv4Octets(hostname);
  if (v4) {
    if (v4[0] === 127) return true;
    return isPrivateOrTailscaleIPv4(hostname);
  }
  return isIpv6Ula(hostname);
}

export function isPaidProviderHost(host: string): boolean {
  let hostname: string;
  try {
    hostname = hostnameOf(normalizeOllamaHost(host));
  } catch {
    return false;
  }
  return PAID_PROVIDER_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

/**
 * Local Ollama is free. Anything else needs the owner spend gate.
 * Throws instead of returning a decision so callers cannot ignore it.
 */
export function assertOllamaAllowed(cfg: OllamaConfig): void {
  const host = normalizeOllamaHost(cfg.host);
  const decision = assertLocalSpendOnly(cfg.allowPaidApis);
  if (isLocalOllamaHost(host) && !isPaidProviderHost(host)) return;
  if (cfg.allowPrivateLan === true && isRoutableFreeHost(host) && !isPaidProviderHost(host)) {
    // The registry opts into private LAN only while the spend gate stays closed.
    const closed = assertLocalSpendOnly(false);
    if (closed.ok) throw new Error('LAN routing keeps the spend gate closed.');
    return;
  }
  if (!decision.ok) {
    const kind = isPaidProviderHost(host) ? 'paid provider' : 'non-local host';
    throw new Error(`${decision.reason} Refusing ${kind} ${host}.`);
  }
}

export function defaultOllamaConfig(): OllamaConfig {
  return {
    host: normalizeOllamaHost(process.env.OLLAMA_HOST || DEFAULT_HOST),
    model: (process.env.JEWBOT_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    allowPaidApis: process.env.JEWBOT_ALLOW_PAID === '1',
  };
}

function getFetch(): typeof fetch {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable; cannot reach Ollama.');
  }
  return fetch;
}

function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  return signal;
}

function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    ((err as { name?: string }).name === 'AbortError' || (err as { name?: string }).name === 'TimeoutError')
  );
}

interface OllamaChatLine {
  message?: { role?: string; content?: string };
  error?: string;
  done?: boolean;
}

function tokensFromLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  let obj: OllamaChatLine;
  try {
    obj = JSON.parse(trimmed) as OllamaChatLine;
  } catch {
    return undefined;
  }
  if (obj.error) throw new Error(`Ollama error: ${obj.error}`);
  const content = obj.message?.content;
  return content ? content : undefined;
}

export async function listModels(cfg: OllamaConfig = defaultOllamaConfig()): Promise<string[]> {
  assertOllamaAllowed(cfg);
  const host = normalizeOllamaHost(cfg.host);
  let res: Response;
  try {
    res = await getFetch()(`${host}/api/tags`, { signal: AbortSignal.timeout(TAGS_TIMEOUT_MS) });
  } catch (err) {
    if (isAbortError(err)) throw new Error(`Ollama at ${host} did not respond (tags timeout).`);
    throw new Error(`Cannot reach Ollama at ${host}. Is \`ollama serve\` running?`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Ollama tags failed: ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }
  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  return (data.models || []).map((m) => m.name).filter((n): n is string => !!n);
}

export async function probeOllama(
  cfg: OllamaConfig = defaultOllamaConfig(),
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const models = await listModels(cfg);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Stream assistant tokens from Ollama `/api/chat` (NDJSON, one JSON object per line).
 * Yields only non-empty content deltas.
 */
export async function* chatStream(
  messages: ChatMessage[],
  cfg: OllamaConfig = defaultOllamaConfig(),
  options: ChatStreamOptions = {},
): AsyncGenerator<string, void, unknown> {
  assertOllamaAllowed(cfg);
  const host = normalizeOllamaHost(cfg.host);
  const model = cfg.model.trim();
  if (!model) throw new Error('JEWBOT_MODEL is empty.');

  let res: Response;
  try {
    res = await getFetch()(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal: combineSignals(options.timeoutMs ?? CHAT_TIMEOUT_MS, options.signal),
    });
  } catch (err) {
    if (isAbortError(err)) {
      const aborted = options.signal?.aborted === true;
      throw new Error(aborted ? 'Ollama request cancelled.' : `Ollama at ${host} timed out.`);
    }
    throw new Error(`Cannot reach Ollama at ${host}. Is \`ollama serve\` running?`);
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Ollama chat failed: ${res.status}${detail ? ` ${detail.slice(0, 300)}` : ''}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const emit = (line: string): string | undefined => tokensFromLine(line);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const token = emit(line);
        if (token) yield token;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const token = emit(buffer);
      if (token) yield token;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Non-streaming helper. Concatenates chatStream tokens. */
export async function chatOnce(
  messages: ChatMessage[],
  cfg: OllamaConfig = defaultOllamaConfig(),
  options: ChatStreamOptions = {},
): Promise<string> {
  let out = '';
  for await (const chunk of chatStream(messages, cfg, options)) out += chunk;
  return out;
}
