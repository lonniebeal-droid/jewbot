/**
 * Street Trader. Teaches the local curriculum pack on fleet Ollama.
 * Does not place trades, call a broker, or download the Drive course.
 */

import type { JewbotModule } from '../plugin/types';
import { streetJournalPrompt } from './journal';
import { streetAsk, streetHealth } from './local';
import { streetOutline } from './outline';

export type { JournalKind, JournalPrompt, StreetJournal } from './journal';
export { streetJournalPrompt } from './journal';
export type { StreetAskResult, StreetHealth } from './local';
export {
  assertStreetLocal,
  isLiveOrderRequest,
  resolveStreetConfig,
  STREET_DEFAULT_HOST,
  streetAsk,
  streetHealth,
} from './local';
export type { StreetOutline } from './outline';
export { streetOutline } from './outline';
export type { StreetTopic } from './prompts';
export {
  buildSystemPrompt,
  excerptForQuestion,
  STREET_DISCLAIMER,
  STREET_DRIVE_SOURCES,
  STREET_SYSTEM_PROMPT,
  STREET_TOPICS,
} from './prompts';
export type { SizeInput, SizeResult, SizeSkip } from './sizing';
export { sizePosition } from './sizing';

export const jewbotModule: JewbotModule = {
  id: 'street-trader',
  title: 'Street Trader',
  description:
    'Teaches position sizing, risk, charts, scam spotting, and a paper-trading routine on local Ollama. Does not place trades or call a broker.',
  version: '0.2.0',
  capabilities: ['teach', 'chat', 'local-only'],
  tools: [
    {
      name: 'street_ask',
      description:
        'Answer a curriculum question on local Ollama after assertLocalSpendOnly. Refuses paid hosts, ticker picks, and any request to place a trade.',
    },
    {
      name: 'street_outline',
      description:
        'Return the five-topic lesson map (sizing, risk, charts, scams, routine). No model call. The full course stays on the owner Drive.',
    },
    {
      name: 'street_journal_prompt',
      description:
        'Return journal reflection prompts for a trade, a session, or a week. Does not write the sheet or read an account.',
    },
  ],
  async health() {
    try {
      const probe = await streetHealth();
      if (!probe.ok) return { ok: false, detail: probe.error || 'ollama down' };
      const names = probe.models.slice(0, 3).join(', ');
      return { ok: true, detail: names ? `ollama tags: ${names}` : 'ollama tags: (no models)' };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  },
};

/** Bound helpers for a caller that already holds a local config. */
export const streetTools = {
  ask: streetAsk,
  outline: streetOutline,
  journal: streetJournalPrompt,
};
