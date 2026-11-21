/**
 * List, pull, and delete models on a local or LAN Ollama host.
 * Delete does not run until consumeConfirmation matches the exact command.
 */

import { assertLocalSpendOnly, consumeConfirmation } from '../safety';
import { assertOllamaAllowed, listModels } from '../llm/ollama';
import { assertRoutableOllamaHost } from '../llm/route';

export function modelDeleteCommand(host: string, name: string): string {
  return `ollama delete ${host} ${name}`;
}

function cleanName(name: string): string {
  const model = name.trim();
  if (!model || /\s/.test(model) || model.includes('/') || model.includes('..')) throw new Error('Invalid model name');
  return model;
}

function gatedHost(host: string): string {
  const normalized = assertRoutableOllamaHost(host);
  const decision = assertLocalSpendOnly(false);
  if (decision.ok) throw new Error('Model manager keeps the spend gate closed.');
  return normalized;
}

export async function listLocalModels(host: string): Promise<string[]> {
  const normalized = gatedHost(host);
  return listModels({ host: normalized, model: 'unused', allowPaidApis: false, allowPrivateLan: true });
}

export async function pullLocalModel(host: string, name: string): Promise<void> {
  const normalized = gatedHost(host);
  const model = cleanName(name);
  assertOllamaAllowed({ host: normalized, model, allowPaidApis: false, allowPrivateLan: true });
  const res = await fetch(`${normalized}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: false }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Ollama pull failed: ${res.status}${detail ? ` ${detail.slice(0, 160)}` : ''}`);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (data.error) throw new Error(`Ollama error: ${data.error}`);
}

export async function deleteLocalModel(
  host: string,
  name: string,
  executionId?: string,
): Promise<{ ok: boolean; needsConfirmation: boolean; command: string }> {
  const normalized = gatedHost(host);
  const model = cleanName(name);
  const command = modelDeleteCommand(normalized, model);
  if (!consumeConfirmation(executionId, command)) {
    return { ok: false, needsConfirmation: true, command };
  }
  assertOllamaAllowed({ host: normalized, model, allowPaidApis: false, allowPrivateLan: true });
  const res = await fetch(`${normalized}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Ollama delete failed: ${res.status}${detail ? ` ${detail.slice(0, 160)}` : ''}`);
  }
  return { ok: true, needsConfirmation: false, command };
}
