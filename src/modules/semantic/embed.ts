/**
 * Local embeddings through Ollama POST /api/embed.
 * assertLocalSpendOnly runs before the socket opens.
 */

import { featureModel } from '../models/settings';
import { assertLocalSpendOnly } from '../safety';
import { assertOllamaAllowed } from '../llm/ollama';
import { assertRoutableOllamaHost } from '../llm/route';

export const EMBED_MODEL = 'nomic-embed-text';

export async function embedTexts(options: {
  host: string;
  input: string[];
  model?: string;
  signal?: AbortSignal;
}): Promise<number[][]> {
  const host = assertRoutableOllamaHost(options.host);
  const decision = assertLocalSpendOnly(false);
  if (decision.ok) throw new Error('Embeddings keep the spend gate closed.');
  const model = options.model?.trim() || process.env.JEWBOT_EMBED_MODEL?.trim() || featureModel('embeddings') || EMBED_MODEL;
  if (!options.input.length) return [];
  assertOllamaAllowed({ host, model, allowPaidApis: false, allowPrivateLan: true });
  if (typeof fetch !== 'function') throw new Error('Global fetch is unavailable; cannot reach Ollama.');
  const res = await fetch(`${host}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: options.input }),
    signal: options.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Ollama embed failed: ${res.status}${detail ? ` ${detail.slice(0, 160)}` : ''}`);
  }
  const data = (await res.json()) as { embeddings?: number[][]; error?: string };
  if (data.error) throw new Error(`Ollama error: ${data.error}`);
  const rows = data.embeddings || [];
  if (rows.length !== options.input.length) throw new Error('Ollama embed returned the wrong number of vectors.');
  return rows;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
