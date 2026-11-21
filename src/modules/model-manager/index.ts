/**
 * M17 model manager. Local and LAN Ollama only.
 */

import type { JewbotModule } from '../plugin/types';

export { featureModel, loadSettings, saveFeatureModels, settingsPath } from './settings';
export type { FeatureName } from './settings';
export { deleteLocalModel, listLocalModels, modelDeleteCommand, pullLocalModel } from './manager';

export const jewbotModule: JewbotModule = {
  id: 'model-manager',
  title: 'Model manager',
  description: 'List, pull, and delete local Ollama models. Per-feature model choice is saved in ~/.jewbot/settings.json. Delete needs the confirm grant.',
  version: '0.3.0',
  capabilities: ['ollama', 'local-only'],
  tools: [
    { name: 'models_list', description: 'List models on one local or LAN Ollama host.' },
    { name: 'models_pull', description: 'Pull a model onto a local or LAN Ollama host.' },
    { name: 'models_delete', description: 'Delete a local model after the owner confirms.' },
  ],
  health() {
    return { ok: true, detail: 'model settings idle' };
  },
};
