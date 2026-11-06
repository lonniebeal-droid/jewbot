import { migrationStub } from '../plugin/stub';

/** Twinrent stub. Rental-platform tokens stay off this machine's repo. */
export const jewbotModule = migrationStub({
  id: 'twinrent',
  title: 'Twinrent',
  description:
    'Rental assistant stub. Platform tokens stay owner-local. This build does not talk to a rental API.',
  version: '0.1.0',
  capabilities: ['stub', 'chat'],
  tools: [
    {
      name: 'draft_listing_note',
      description: 'Reserved. When wired, it calls moduleChat on local Ollama. It does not publish a listing.',
    },
  ],
});
