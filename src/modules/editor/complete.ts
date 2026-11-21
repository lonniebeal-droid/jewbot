/**
 * Debounced ghost-text completion. Tab accepts, Esc dismisses.
 * No request is sent when the host registry has no healthy Ollama.
 */

import { generateFim, completionModel } from '../llm/fim';
import { inspectOllamaHosts } from '../llm/route';
import type { OllamaHostEntry } from '../llm/hosts';

export interface GhostState {
  enabled: boolean;
  ghost: string;
  host: string | null;
}

export interface CompletionController {
  schedule(prefix: string, suffix: string): void;
  cancel(): void;
  accept(): string | null;
  dismiss(): void;
  state(): GhostState;
}

export function createCompletionController(options: {
  debounceMs?: number;
  model?: string;
  entries?: OllamaHostEntry[];
  request?: (prefix: string, suffix: string, signal: AbortSignal) => Promise<string | null>;
  schedule?: (fn: () => void, ms: number) => { cancel(): void };
}): CompletionController {
  const wait = options.debounceMs ?? 250;
  const request = options.request ?? ((prefix, suffix, signal) => requestCompletion(prefix, suffix, signal, options));
  const schedule = options.schedule ?? defaultSchedule;
  let ghost = '';
  let enabled = true;
  let host: string | null = null;
  let timer: { cancel(): void } | null = null;
  let inflight: AbortController | null = null;
  let generation = 0;

  function clearTimer() {
    timer?.cancel();
    timer = null;
  }

  function abortRequest() {
    inflight?.abort();
    inflight = null;
  }

  return {
    schedule(prefix: string, suffix: string) {
      clearTimer();
      abortRequest();
      const token = ++generation;
      timer = schedule(() => {
        timer = null;
        const ctrl = new AbortController();
        inflight = ctrl;
        void request(prefix, suffix, ctrl.signal)
          .then((text) => {
            if (token !== generation || ctrl.signal.aborted) return;
            if (text === null) {
              enabled = false;
              ghost = '';
              host = null;
              return;
            }
            enabled = true;
            ghost = text;
          })
          .catch(() => {
            if (token !== generation) return;
            ghost = '';
          });
      }, wait);
    },
    cancel() {
      generation += 1;
      clearTimer();
      abortRequest();
      ghost = '';
    },
    accept() {
      const text = ghost;
      ghost = '';
      return text || null;
    },
    dismiss() {
      ghost = '';
    },
    state() {
      return { enabled, ghost, host };
    },
  };
}

export async function completeInline(
  prefix: string,
  suffix: string,
  signal?: AbortSignal,
  options?: { model?: string; entries?: OllamaHostEntry[] },
): Promise<string | null> {
  return requestCompletion(prefix, suffix, signal ?? new AbortController().signal, options ?? {});
}

async function requestCompletion(
  prefix: string,
  suffix: string,
  signal: AbortSignal,
  options: { model?: string; entries?: OllamaHostEntry[] },
): Promise<string | null> {
  const model = completionModel(options.model);
  const report = await inspectOllamaHosts({ model, entries: options.entries });
  const healthy = report.selected?.host || report.hosts.find((host) => host.ok)?.host;
  if (!healthy) return null;
  const text = await generateFim({ host: healthy, model, prompt: prefix, suffix, signal });
  return text;
}

function defaultSchedule(fn: () => void, ms: number): { cancel(): void } {
  const id = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(id) };
}
