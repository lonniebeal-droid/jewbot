import { migrationStub } from '../plugin/stub';

/** Fleet triage. Uses Jewbot SSH and terminal later. No cloud control plane. */
export const jewbotModule = migrationStub({
  id: 'fleet-triage',
  title: 'Fleet Triage',
  description:
    'Ops triage for machines already listed in the local SSH hosts file. No extra cloud inventory API.',
  version: '0.1.0',
  capabilities: ['stub', 'chat', 'ops'],
  tools: [
    {
      name: 'triage_host',
      description: 'Reserved. When wired, it uses the SSH module and moduleChat. It does not store host passwords.',
    },
  ],
});
