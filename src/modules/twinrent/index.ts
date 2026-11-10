/**
 * TwinRent. A local listing planner.
 * The checklist stays on disk in the open project. Drafts use local Ollama
 * after assertLocalSpendOnly. There is no rental-platform client, no
 * credential capture, and no keystroke capture.
 */

import type { JewbotModule } from '../plugin/types';
import { listSteps, markStep, nextFreeStep } from './plan';
import { twinrentDraft, twinrentHealth } from './local';

export type { StepStatus, TwinrentStep, TwinrentStepId } from './checklist';
export { bundledPlan, PLAN_FILE_VERSION, TWINRENT_STEP_IDS } from './checklist';
export type { TwinrentDraft } from './local';
export {
  assertTwinrentLocal,
  isSensitiveListingFacts,
  resolveTwinrentConfig,
  TWINRENT_HOST,
  twinrentDraft,
  twinrentHealth,
} from './local';
export type { MarkStepResult, PlanSource } from './plan';
export { listSteps, markStep, nextFreeStep, planFilePath, resolveTwinrentRoot } from './plan';

export const jewbotModule: JewbotModule = {
  id: 'twinrent',
  title: 'TwinRent',
  description:
    'Local listing checklist and draft. Ollama stays on 127.0.0.1:11434 after assertLocalSpendOnly. Does not publish, log in, or capture credentials or keystrokes.',
  version: '0.2.0',
  capabilities: ['plan', 'chat', 'local-only'],
  tools: [
    {
      name: 'twinrent_list',
      description: 'Read the local prep checklist. No rental-platform call and no tenant data.',
    },
    {
      name: 'twinrent_next',
      description: 'Next open prep step that is not the publish gate. Does not post a listing.',
    },
    {
      name: 'twinrent_mark',
      description: 'Set one local step to open, blocked, or done. Publish cannot be marked done.',
    },
    {
      name: 'twinrent_draft',
      description:
        'Draft a public listing note on local Ollama after assertLocalSpendOnly. Refuses credentials, keystrokes, and tenant contacts. Does not publish.',
    },
  ],
  health() {
    return twinrentHealth();
  },
};

export const twinrentTools = {
  list: listSteps,
  next: nextFreeStep,
  mark: markStep,
  draft: twinrentDraft,
};
