/**
 * Bundled TwinRent prep checklist.
 *
 * Status lives in `<project>/.jewbot/twinrent-plan.json` when the owner marks
 * a step. The file stores ids and statuses only. It does not store tenant
 * contacts, platform tokens, or keystrokes. Publishing is not a step this
 * module can complete.
 */

export const PLAN_FILE_VERSION = 1;

export const TWINRENT_STEP_IDS = ['unit-facts', 'listing-note', 'owner-review', 'publish'] as const;

export type TwinrentStepId = (typeof TWINRENT_STEP_IDS)[number];

export const STEP_STATUSES = ['open', 'blocked', 'done'] as const;

export type StepStatus = (typeof STEP_STATUSES)[number];

export interface StepBlocker {
  kind: 'owner';
  note: string;
}

export interface TwinrentStep {
  id: TwinrentStepId;
  title: string;
  status: StepStatus;
  blocker: StepBlocker | null;
}

export interface TwinrentPlanFile {
  version: number;
  steps: TwinrentStep[];
}

const BUNDLED_STEPS: readonly TwinrentStep[] = [
  {
    id: 'unit-facts',
    title: 'Write beds, rent, and dates in your own notes. This module does not log into a rental site.',
    status: 'open',
    blocker: null,
  },
  {
    id: 'listing-note',
    title: 'Draft the public listing note on local Ollama. Leave tenant contacts out of the facts.',
    status: 'open',
    blocker: null,
  },
  {
    id: 'owner-review',
    title: 'Read the draft yourself. TwinRent does not publish it.',
    status: 'open',
    blocker: null,
  },
  {
    id: 'publish',
    title: 'Publishing stays outside this module.',
    status: 'blocked',
    blocker: {
      kind: 'owner',
      note: 'The owner publishes on the rental site. Marking this step does not log in or post.',
    },
  },
];

export function bundledPlan(): TwinrentPlanFile {
  return {
    version: PLAN_FILE_VERSION,
    steps: BUNDLED_STEPS.map(cloneStep),
  };
}

export function cloneStep(step: TwinrentStep): TwinrentStep {
  return {
    id: step.id,
    title: step.title,
    status: step.status,
    blocker: step.blocker ? { kind: step.blocker.kind, note: step.blocker.note } : null,
  };
}

export function isTwinrentStepId(id: string): id is TwinrentStepId {
  return (TWINRENT_STEP_IDS as readonly string[]).includes(id);
}
