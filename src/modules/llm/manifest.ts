import { builtinModule } from '../plugin/builtin';

export const jewbotModule = builtinModule({
  id: 'llm',
  title: 'Ollama',
  description: 'Local chat runtime. Hub modules that talk to a model go through this binding.',
  capabilities: ['chat', 'models'],
  chats: true,
  tools: [
    { name: 'chat', description: 'Stream a completion from the local Ollama host.' },
    { name: 'list_models', description: 'List models from Ollama /api/tags.' },
  ],
});
