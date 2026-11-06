/**
 * Registers the real Muse finisher (PR #8). This file does not replace
 * `index.ts`, `fleet.ts`, or `checklist.ts`.
 */

import { fleetHealth } from './fleet';
import type { JewbotModule } from '../plugin/types';

export const jewbotModule: JewbotModule = {
  id: 'muse',
  title: 'Muse Finisher',
  description:
    'Local finish line from the merged Muse module. Restates open release blockers on fleet Ollama and cannot close them.',
  version: '0.1.0',
  capabilities: ['chat', 'finish', 'local-only'],
  tools: [
    {
      name: 'list_blockers',
      description: 'Return the five open release blockers. A model reply cannot mark one done.',
    },
    {
      name: 'run_finish_line',
      description: 'Ping local fleet Ollama and optionally restate blockers. No OAuth and no production calls.',
    },
  ],
  async health() {
    try {
      const probe = await fleetHealth();
      if (!probe.ok) return { ok: false, detail: probe.error || 'ollama down' };
      const names = probe.models.slice(0, 3).join(', ');
      return { ok: true, detail: names ? `ollama tags: ${names}` : 'ollama tags: (no models)' };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  },
};
