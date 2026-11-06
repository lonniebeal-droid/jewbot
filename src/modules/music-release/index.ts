import { migrationStub } from '../plugin/stub';

/** Music Release Engine. No distributor SDK and no release credentials. */
export const jewbotModule = migrationStub({
  id: 'music-release',
  title: 'Music Release Engine',
  description:
    'Plans a release checklist on local Ollama. Distributor tokens stay on the owner machine and are not read here.',
  version: '0.1.0',
  capabilities: ['stub', 'chat', 'release'],
  tools: [
    {
      name: 'draft_release_notes',
      description: 'Reserved. When wired, it calls moduleChat on local Ollama. It does not upload a release.',
    },
  ],
});
