import { builtinModule } from '../plugin/builtin';

export const jewbotModule = builtinModule({
  id: 'safety',
  title: 'Safety',
  description: 'Spend gate, destructive-command gate, and project path jail. Default spend is $0.',
  capabilities: ['safety'],
  tools: [{ name: 'assert_local_spend', description: 'Refuse paid or non-local model hosts unless the owner opts in.' }],
});
