import { migrationStub } from '../plugin/stub';

/** Echo, the general local worker. No cloud agent endpoint. */
export const jewbotModule = migrationStub({
  id: 'echo',
  title: 'Echo',
  description: 'General worker. Future tasks go through moduleChat on local Ollama. This stub only reports health.',
  version: '0.1.0',
  capabilities: ['stub', 'chat', 'worker'],
  tools: [
    {
      name: 'echo_task',
      description: 'Reserved. When wired, it repeats a task through moduleChat. It does not call a paid agent API.',
    },
  ],
});
