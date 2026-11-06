import { migrationStub } from '../plugin/stub';

/** Portfolio sweeper stub. No brokerage and no account credentials. */
export const jewbotModule = migrationStub({
  id: 'portfolio-sweeper',
  title: 'Portfolio Sweeper',
  description:
    'Ops review of a local folder. This build does not call a brokerage or move funds.',
  version: '0.1.0',
  capabilities: ['stub', 'chat', 'ops'],
  tools: [
    {
      name: 'summarize_folder',
      description: 'Reserved. When wired, it reads a local folder and calls moduleChat. Account keys are not read.',
    },
  ],
});
