import type { JewbotModule } from '../plugin/types';
import { hubOllamaHealth } from './route';

/** Hub Ollama binding. health() lists the LAN registry and the selected host. */
export const jewbotModule: JewbotModule = {
  id: 'llm',
  title: 'Ollama',
  description:
    'Local chat runtime. Hub health lists the Ollama host registry (loopback, private LAN, and Tailscale) and picks the first healthy host that has the requested model.',
  version: '0.8.0',
  capabilities: ['chat', 'models'],
  tools: [
    { name: 'chat', description: 'Stream a completion from the selected local or LAN Ollama host.' },
    { name: 'list_models', description: 'List models from Ollama /api/tags.' },
  ],
  health: hubOllamaHealth,
};
