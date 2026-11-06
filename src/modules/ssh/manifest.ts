import { builtinModule } from '../plugin/builtin';

export const jewbotModule = builtinModule({
  id: 'ssh',
  title: 'SSH',
  description: 'Allowlisted SSH sessions with TOFU host keys. Passphrases stay in memory.',
  capabilities: ['ssh'],
  tools: [
    { name: 'ssh_list_hosts', description: 'List hosts from the local hosts file.' },
    { name: 'ssh_connect', description: 'Open a session after the owner trusts the host key.' },
    { name: 'ssh_exec', description: 'Stream a remote command. Destructive commands need a grant.' },
    { name: 'ssh_disconnect', description: 'Close a session and drop any in-memory secret.' },
  ],
});
