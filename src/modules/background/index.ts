/**
 * M20 background agents. A LAN SSH host runs the prompt against its own Ollama.
 * The diff waits for Accept.
 */

import type { JewbotModule } from '../plugin/types';

export {
  acceptBackgroundTask,
  assertBackgroundHost,
  enqueueBackgroundTask,
  parseFiles,
  remoteChatCommand,
  runBackgroundTask,
} from './run';
export type { BackgroundFile, BackgroundHost, BackgroundRunner, BackgroundTask } from './run';

export const jewbotModule: JewbotModule = {
  id: 'background',
  title: 'Background agents',
  description: 'Queue a headless task on a LAN SSH host. The model is that host’s local Ollama. The result is a diff and is not applied on its own.',
  version: '0.4.0',
  capabilities: ['ssh', 'ollama', 'local-only'],
  tools: [
    { name: 'background_run', description: 'Run a goal on an allowlisted LAN host. Returns a reviewable diff and does not write.' },
  ],
  health() {
    return { ok: true, detail: 'background queue idle' };
  },
};
