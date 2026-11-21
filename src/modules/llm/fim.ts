/**
 * Fill-in-the-middle on local Ollama. POST /api/generate with a suffix.
 * assertLocalSpendOnly runs before the socket opens. Paid and public hosts
 * are refused even when JEWBOT_ALLOW_PAID=1.
 */

import { featureModel } from '../models/settings';
import { assertLocalSpendOnly } from '../safety';
import { assertOllamaAllowed } from './ollama';
import { assertRoutableOllamaHost } from './route';

export const DEFAULT_COMPLETE_MODEL = 'qwen2.5-coder:1.5b';

export function completionModel(explicit?: string): string {
  const named = explicit?.trim() || process.env.JEWBOT_COMPLETE_MODEL?.trim() || featureModel('autocomplete');
  return named || DEFAULT_COMPLETE_MODEL;
}

export async function generateFim(options: {
  host: string;
  model?: string;
  prompt: string;
  suffix: string;
  signal?: AbortSignal;
}): Promise<string> {
  const host = assertRoutableOllamaHost(options.host);
  const decision = assertLocalSpendOnly(false);
  if (decision.ok) throw new Error('Completion keeps the spend gate closed.');
  const model = completionModel(options.model);
  assertOllamaAllowed({ host, model, allowPaidApis: false, allowPrivateLan: true });
  if (typeof fetch !== 'function') throw new Error('Global fetch is unavailable; cannot reach Ollama.');
  let res: Response;
  try {
    res = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: options.prompt, suffix: options.suffix, stream: false }),
      signal: options.signal,
    });
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : '';
    if (name === 'AbortError') throw new Error('Completion cancelled.');
    throw new Error(`Cannot reach Ollama at ${host}.`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Ollama generate failed: ${res.status}${detail ? ` ${detail.slice(0, 160)}` : ''}`);
  }
  const data = (await res.json()) as { response?: string; error?: string };
  if (data.error) throw new Error(`Ollama error: ${data.error}`);
  return (data.response || '').replace(/\s+$/, '');
}
