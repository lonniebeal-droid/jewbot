import { builtinModule } from '../plugin/builtin';

export const jewbotModule = builtinModule({
  id: 'files',
  title: 'Files',
  description: 'Project-jailed reads and diff previews. Writes land only after Accept.',
  capabilities: ['files'],
  tools: [
    { name: 'read_file', description: 'Read a file inside the project root.' },
    { name: 'write_file', description: 'Show a unified diff and wait for Accept.' },
  ],
});
