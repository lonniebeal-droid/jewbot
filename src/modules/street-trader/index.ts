/**
 * Street Trader. Teaches the local curriculum pack on fleet Ollama.
 * Does not place trades, connect to a brokerage, or write back to Drive.
 */

import type { JewbotModule } from '../plugin/types';
import { streetToolSchema } from '../street_trader/schemas';
import { appendDriveLog, exportDriveLog } from './drive-log';
import { streetJournalPrompt } from './journal';
import { streetAsk, streetHealth } from './local';
import { streetOutline } from './outline';

export type { CurriculumHit, CurriculumSection, TeachResult } from './curriculum';
export { loadCurriculum, retrieveCurriculum, teachFromCurriculum } from './curriculum';
export type { DriveLogKind, DriveLogLine } from './drive-log';
export {
  appendDriveLog,
  driveLogPath,
  exportDriveLog,
  MASTER3_CONTINUATION_DOC_ID,
} from './drive-log';
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
    'Teaches position sizing, risk, charts, scam spotting, and a paper-trading routine on local Ollama. Does not place trades or connect to a brokerage.',
  version: '0.3.0',
  capabilities: ['teach', 'chat', 'local-only'],
  tools: [
    {
      name: 'street_ask',
      description:
        'Answer a curriculum question on local Ollama after assertLocalSpendOnly. Cites a shipped curriculum section. Refuses paid hosts, ticker picks, brokerage connections, and any request to place a trade.',
      inputSchema: streetToolSchema('street_ask'),
    },
    {
      name: 'street_outline',
      description:
        'Return the five-topic lesson map (sizing, risk, charts, scams, routine). No model call.',
      inputSchema: streetToolSchema('street_outline'),
    },
    {
      name: 'street_journal_prompt',
      description:
        'Return journal reflection prompts for a trade, a session, or a week. Does not write the sheet or read an account.',
      inputSchema: streetToolSchema('street_journal_prompt'),
    },
    {
      name: 'street_drive_log',
      description:
        'Append one session receipt to the local JSONL log. The Master 3 continuation exporter stays off and holds no credentials.',
      inputSchema: streetToolSchema('street_drive_log'),
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
  driveLog: appendDriveLog,
  exportDriveLog,
};
