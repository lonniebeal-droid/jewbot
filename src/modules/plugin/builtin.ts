/**
 * Built-in module shape. Chat-capable builtins report health with a local
 * Ollama tags ping. Filesystem and shell builtins report that they loaded.
 */

import { pingLocalOllama } from './health';
import type { JewbotModule, ModuleTool } from './types';

export function builtinModule(spec: {
  id: string;
  title: string;
  description: string;
  capabilities: string[];
  tools?: ModuleTool[];
  /** When true, health is the local Ollama tags ping. */
  chats?: boolean;
}): JewbotModule {
  return {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    version: '0.8.0',
    capabilities: spec.capabilities,
    tools: spec.tools,
    health: spec.chats ? pingLocalOllama : async () => ({ ok: true, detail: 'loaded' }),
  };
}
