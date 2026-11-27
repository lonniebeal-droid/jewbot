/**
 * Opt-in voice. Off unless settings say persona "based".
 */

import type { JewbotModule } from '../plugin/types';

export { personaMode, personaSettingsPath, personaSuffix } from './settings';

export const jewbotModule: JewbotModule = {
  id: 'persona',
  title: 'Persona',
  description: 'Optional blunt voice. Off by default. It does not weaken a safety gate.',
  version: '0.6.0',
  capabilities: ['local-only'],
  health() {
    return { ok: true, detail: 'persona off unless settings say based' };
  },
};
