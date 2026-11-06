import { builtinModule } from '../plugin/builtin';

export const jewbotModule = builtinModule({
  id: 'cascade',
  title: 'Cascade',
  description: 'Local task queue. The next pending task starts when the current one finishes cleanly.',
  capabilities: ['queue', 'chat'],
  chats: true,
  tools: [{ name: 'enqueue', description: 'Add a local task. The runner does not approve human gates.' }],
});
