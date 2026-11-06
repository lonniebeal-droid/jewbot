/**
 * Shared local tags ping. One in-flight probe is reused so the panel
 * does not open a socket per module.
 */

import { defaultOllamaConfig, probeOllama, type OllamaConfig } from '../llm/ollama';
import type { ModuleHealth } from './types';

const TTL_MS = 2_000;

interface CacheEntry {
  key: string;
  at: number;
  pending: ReturnType<typeof probeOllama>;
}

let cached: CacheEntry | null = null;

export function resetOllamaHealthCache(): void {
  cached = null;
}

function cacheKey(cfg: OllamaConfig): string {
  return `${cfg.host}|${cfg.model}|${cfg.allowPaidApis ? 1 : 0}`;
}

export async function pingLocalOllama(): Promise<ModuleHealth> {
  const cfg = defaultOllamaConfig();
  const key = cacheKey(cfg);
  const now = Date.now();
  if (!cached || cached.key !== key || now - cached.at > TTL_MS) {
    cached = { key, at: now, pending: probeOllama(cfg) };
  }
  const probe = await cached.pending;
  if (probe.ok) {
    const names = probe.models.slice(0, 3).join(', ');
    return { ok: true, detail: names ? `ollama tags: ${names}` : 'ollama tags: (no models)' };
  }
  return { ok: false, detail: probe.error || 'ollama down' };
}
