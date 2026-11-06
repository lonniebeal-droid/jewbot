/**
 * Fixed release blockers for the Muse finisher.
 *
 * These are typed tasks, not a queue the model can close. Tokens, service-role
 * keys, and provider URLs do not belong in this file. Status stays `open`
 * until an owner changes it outside this module.
 */

export const MUSE_BLOCKER_IDS = [
  'private-model-url',
  'gmail-calendar-oauth',
  'authenticated-e2e-chat',
  'supabase-rls',
  'production-gate-2026-10-16',
] as const;

export type MuseBlockerId = (typeof MUSE_BLOCKER_IDS)[number];

/** Same vocabulary as a cascade task, minus persistence and self-approval. */
export type MuseTaskStatus = 'open' | 'blocked' | 'done';

export interface MuseTask {
  id: MuseBlockerId;
  title: string;
  /** What the owner still has to close. No secrets. */
  prompt: string;
  status: MuseTaskStatus;
  /** Why Muse leaves the task open. */
  note: string;
}

const RELEASE_BLOCKERS: readonly MuseTask[] = [
  {
    id: 'private-model-url',
    title: 'Private authenticated model URL',
    prompt:
      'Ship the product model behind a private authenticated URL. Do not send that traffic through the Lovable gateway.',
    status: 'open',
    note: 'Muse review traffic stays on local fleet Ollama. This module does not call a hosted gateway.',
  },
  {
    id: 'gmail-calendar-oauth',
    title: 'Live Gmail and Calendar OAuth',
    prompt:
      'Gmail and Calendar need a live OAuth grant. Keep access tokens and refresh tokens out of the repository.',
    status: 'open',
    note: 'This module does not start an OAuth flow, read token files, or store Gmail or Calendar credentials.',
  },
  {
    id: 'authenticated-e2e-chat',
    title: 'Authenticated end-to-end chat test',
    prompt:
      'An authenticated end-to-end chat test must pass before release. Session cookies and bearer tokens stay out of git.',
    status: 'open',
    note: 'This module does not run that test and does not mark it done from a local model reply.',
  },
  {
    id: 'supabase-rls',
    title: 'Supabase RLS isolation',
    prompt:
      'Supabase row-level security must isolate one tenant’s rows from another. Do not ship a service-role key in the repo.',
    status: 'open',
    note: 'This module does not connect to Supabase and does not embed database credentials.',
  },
  {
    id: 'production-gate-2026-10-16',
    title: 'Close the 2026-10-16 production gate blockers',
    prompt:
      'Close the production gate blockers recorded on 2026-10-16. Confirm the gate outside this repository.',
    status: 'open',
    note: 'This module does not change production and does not treat a model summary as closing the gate.',
  },
];

/** Fresh copies so a caller cannot rewrite the catalog. */
export function listReleaseBlockers(): MuseTask[] {
  return RELEASE_BLOCKERS.map((task) => ({ ...task }));
}
