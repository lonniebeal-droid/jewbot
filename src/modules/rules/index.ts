/**
 * M18 rules. Local files only. No network.
 */

import type { JewbotModule } from '../plugin/types';

export { loadRules, rulesEnabled, setRulesEnabled, settingsPath, systemWithRules } from './load';

export const jewbotModule: JewbotModule = {
  id: 'rules',
  title: 'Rules',
  description: 'Loads .jewbot/rules.md and per-folder rules.md into the agent system prompt. A settings toggle can turn that off.',
  version: '0.3.0',
  capabilities: ['files', 'local-only'],
  tools: [{ name: 'rules_load', description: 'Read project rules when the settings toggle is on.' }],
  health() {
    return { ok: true, detail: 'rules idle' };
  },
};
