/**
 * M12 composer. A batch of agent edits, reviewed per file and per hunk.
 */

import type { JewbotModule } from '../plugin/types';

export { ComposerBatch } from './batch';
export type { ComposerFile, ComposerHunk, HunkDecision } from './batch';

export const jewbotModule: JewbotModule = {
  id: 'composer',
  title: 'Composer',
  description: 'Review multi-file agent edits in one panel. Accept or reject a file or a hunk. One undo restores the batch.',
  version: '0.2.0',
  capabilities: ['edit', 'local-only'],
  tools: [
    { name: 'composer_apply', description: 'Write the accepted hunks. Rejected hunks stay as they were. One undo restores the batch.' },
  ],
  health() {
    return { ok: true, detail: 'composer review ready' };
  },
};
