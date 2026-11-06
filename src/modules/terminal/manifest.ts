import { builtinModule } from '../plugin/builtin';

export const jewbotModule = builtinModule({
  id: 'terminal',
  title: 'Terminal',
  description: 'Local shell in the open project. Destructive commands need an owner grant.',
  capabilities: ['shell'],
  tools: [{ name: 'run_terminal', description: 'Stream stdout and stderr for one local command.' }],
});
