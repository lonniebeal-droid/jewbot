import { builtinModule } from '../plugin/builtin';

export const jewbotModule = builtinModule({
  id: 'context',
  title: 'Context',
  description: 'Gitignore-aware project index. Secret files stay out of the snapshot.',
  capabilities: ['context'],
  tools: [
    { name: 'get_project_summary', description: 'Summarize the open project.' },
    { name: 'find_files', description: 'Find files by substring or glob.' },
    { name: 'search_context', description: 'Return short excerpts.' },
  ],
});
