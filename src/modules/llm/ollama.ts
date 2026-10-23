/**
 * Local Ollama provider — zero API spend by default.
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
}

export function defaultOllamaConfig(): OllamaConfig {
  return {
    host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    model: process.env.JEWBOT_MODEL || 'qwen2.5-coder:7b',
    allowPaidApis: process.env.JEWBOT_ALLOW_PAID === '1',
  };
}

export async function listModels(cfg: OllamaConfig = defaultOllamaConfig()): Promise<string[]> {
  const spend = assertLocalSpendOnly(cfg.allowPaidApis);
  // Local Ollama is always allowed; spend gate is for future paid providers.
  void spend;
  const res = await fetch(`${cfg.host}/api/tags`);
  if (!res.ok) throw new Error(`Ollama tags failed: ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models || []).map((m) => m.name);
}

export async function* chatStream(
  messages: ChatMessage[],
  cfg: OllamaConfig = defaultOllamaConfig(),
): AsyncGenerator<string, void, unknown> {
  // Guardrail for any future non-local provider wiring
  if (!cfg.host.includes('127.0.0.1') && !cfg.host.includes('localhost')) {
    const decision = assertLocalSpendOnly(cfg.allowPaidApis);
    if (!decision.ok) throw new Error(decision.reason);
  }

  const res = await fetch(`${cfg.host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { message?: { content?: string } };
        if (obj.message?.content) yield obj.message.content;
      } catch {
        // ignore partial JSON
      }
    }
  }
}

/** Non-streaming helper for agent planning stubs. */
export async function chatOnce(
  messages: ChatMessage[],
  cfg: OllamaConfig = defaultOllamaConfig(),
): Promise<string> {
  let out = '';
  for await (const chunk of chatStream(messages, cfg)) out += chunk;
  return out;
}
