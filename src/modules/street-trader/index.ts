import { migrationStub } from '../plugin/stub';

/** Street Trader stub. Does not place orders or call a broker. */
export const jewbotModule = migrationStub({
  id: 'street-trader',
  title: 'Street Trader',
  description:
    'Former cloud trading agent, now a local stub. This build does not place orders or call a brokerage API.',
  version: '0.1.0',
  capabilities: ['stub', 'chat'],
  tools: [
    {
      name: 'review_notes',
      description: 'Reserved. When wired, it calls moduleChat only. Broker keys stay owner-local and are not read.',
    },
  ],
});
