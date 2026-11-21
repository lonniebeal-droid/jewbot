/**
 * M13 git panel. Local git only. Push, reset, and clean need the confirm grant.
 */

import type { JewbotModule } from '../plugin/types';

export { gitCommand, renderGitCommand, runGit, suggestCommitMessage } from './panel';
export type { GitAction, GitResult } from './panel';

export const jewbotModule: JewbotModule = {
  id: 'git',
  title: 'Git',
  description: 'Status, diffs, stage, commit, and branch switch. Push, reset, and clean wait for the owner. Never auto-push.',
  version: '0.2.0',
  capabilities: ['git', 'local-only'],
  tools: [
    { name: 'git_status', description: 'Show porcelain status. Does not push.' },
    { name: 'git_commit', description: 'Commit staged files. Does not push.' },
    { name: 'git_push', description: 'Push only after the destructive confirm grant. Never automatic.' },
  ],
  health() {
    return { ok: true, detail: 'git panel local' };
  },
};
