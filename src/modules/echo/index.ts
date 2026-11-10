/**
 * Echo. A general local worker on Ollama.
 * Default host is 127.0.0.1:11434 and the model is tinyllama.
 * There is no cloud agent endpoint and no paid API.
 */

import type { JewbotModule } from '../plugin/types';
import { echoHealth, echoTask, isSensitiveEchoTask } from './local';

export type { EchoTaskResult } from './local';
export {
  assertEchoLocal,
  ECHO_HOST,
  ECHO_MODEL,
  echoHealth,
  echoTask,
  isSensitiveEchoTask,
  resolveEchoConfig,
} from './local';

export const jewbotModule: JewbotModule = {
  id: 'echo',
  title: 'Echo',
  description:
    'General local worker. Tasks go to Ollama at 127.0.0.1:11434 (model tinyllama) after assertLocalSpendOnly. No cloud agent and no paid API.',
  version: '0.2.0',
  capabilities: ['chat', 'worker', 'local-only'],
  tools: [
    {
      name: 'echo_task',
      description:
        'Run one task on local Ollama at 127.0.0.1:11434 with model tinyllama after assertLocalSpendOnly. Refuses paid hosts, credentials, and keystroke capture.',
    },
  ],
  health() {
    return echoHealth();
  },
};

export const echoTools = {
  task: echoTask,
  sensitive: isSensitiveEchoTask,
};
