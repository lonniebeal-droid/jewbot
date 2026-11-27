/**
 * M0.6 inbox worker. Local or LAN only.
 */

import type { JewbotModule } from '../plugin/types';

export {
  MAX_ATTEMPTS,
  STALE_CLAIM_SECONDS,
  agentRunner,
  assertInboxUrl,
  inboxLayout,
  pollInbox,
  pollInboxHttp,
  reclaimStale,
  writeReceipt,
} from './worker';
export type { InboxReceipt, InboxTask, OwnerStatus } from './worker';

export const jewbotModule: JewbotModule = {
  id: 'inbox',
  title: 'Action inbox',
  description: 'Poll a ju-command-center inbox, claim one task, and write a $0 receipt. Person steps stay BLOCKED.',
  version: '0.6.0',
  capabilities: ['files', 'local-only'],
  tools: [{ name: 'inbox_poll', description: 'Claim one local or LAN inbox task. Confirm gates are never auto-approved.' }],
  health() {
    return { ok: true, detail: 'inbox idle' };
  },
};
