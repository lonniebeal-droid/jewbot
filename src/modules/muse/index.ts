/**
 * Muse finisher: a fixed checklist of release blockers, reviewed on local
 * fleet Ollama only. The model may restate the list. It cannot close a blocker,
 * spend money, or read OAuth tokens.
 */

import type { ChatMessage, OllamaConfig } from '../llm/ollama';
import { listReleaseBlockers, type MuseTask } from './checklist';
import { assertFleetLocal, fleetChat, fleetHealth, resolveFleetConfig } from './fleet';

export type { MuseBlockerId, MuseTask, MuseTaskStatus } from './checklist';
export { listReleaseBlockers, MUSE_BLOCKER_IDS } from './checklist';
export type { FleetClient, FleetHealth } from './fleet';
export {
  assertFleetLocal,
  createFleetClient,
  DEFAULT_FLEET_HOST,
  fleetChat,
  fleetHealth,
  resolveFleetConfig,
} from './fleet';

const SUMMARY_CHARS = 2_000;

export interface FinishLineOptions {
  /** Override host/model. Non-local hosts are refused and reported, not called. */
  config?: Partial<OllamaConfig>;
  /**
   * When true (default), ask the local model to restate open blockers after
   * a successful health check. A down fleet still returns the checklist.
   */
  review?: boolean;
}

export interface FinishLineFleet {
  host: string;
  model: string;
  ok: boolean;
  models: string[];
  error?: string;
}

export interface FinishLineReport {
  module: 'muse';
  spend: 'local-only';
  generatedAt: string;
  blockers: MuseTask[];
  openCount: number;
  fleet: FinishLineFleet;
  /** Present only when fleet chat returned text. Never closes a blocker. */
  summary?: string;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function reviewPrompt(tasks: MuseTask[]): string {
  const lines = tasks.map((task, index) => `${index + 1}. ${task.title} — ${task.note}`);
  return [
    'You are the local Muse finisher. Restate these open release blockers.',
    'Do not claim any blocker is done. Do not invent tokens, keys, or URLs.',
    ...lines,
  ].join('\n');
}

/**
 * Walk the five release blockers and, when the local fleet is up, ask it to
 * restate them. Blockers are returned still `open`. No shell, no OAuth, no
 * production calls.
 */
export async function runFinishLine(options: FinishLineOptions = {}): Promise<FinishLineReport> {
  const blockers = listReleaseBlockers();
  let host = '';
  let model = '';
  try {
    const resolved = resolveFleetConfig(options.config);
    host = resolved.host;
    model = resolved.model;
  } catch (err) {
    return {
      module: 'muse',
      spend: 'local-only',
      generatedAt: new Date().toISOString(),
      blockers,
      openCount: blockers.length,
      fleet: { host, model, ok: false, models: [], error: messageOf(err) },
    };
  }

  const report: FinishLineReport = {
    module: 'muse',
    spend: 'local-only',
    generatedAt: new Date().toISOString(),
    blockers,
    openCount: blockers.filter((task) => task.status !== 'done').length,
    fleet: { host, model, ok: false, models: [] },
  };

  try {
    assertFleetLocal({ host, model });
  } catch (err) {
    report.fleet.error = messageOf(err);
    return report;
  }

  const health = await fleetHealth({ host, model });
  report.fleet.ok = health.ok;
  report.fleet.models = health.models;
  if (!health.ok) {
    report.fleet.error = health.error;
    return report;
  }
  if (options.review === false) return report;

  const messages: ChatMessage[] = [{ role: 'user', content: reviewPrompt(blockers) }];
  try {
    const summary = (await fleetChat(messages, { host, model })).trim();
    if (!summary) {
      report.fleet.error = 'Fleet chat returned an empty summary.';
      return report;
    }
    report.summary = summary.slice(0, SUMMARY_CHARS);
  } catch (err) {
    report.fleet.error = messageOf(err);
  }
  return report;
}

export class MuseFinisherModule {
  private readonly config: OllamaConfig;

  constructor(config?: Partial<OllamaConfig>) {
    this.config = resolveFleetConfig(config);
  }

  blockers(): MuseTask[] {
    return listReleaseBlockers();
  }

  runFinishLine(options?: Pick<FinishLineOptions, 'review'>): Promise<FinishLineReport> {
    return runFinishLine({ ...options, config: this.config });
  }
}
