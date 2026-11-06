/**
 * Fleet triage. Local Ollama plus allowlisted SSH hosts. No cloud inventory
 * and no paid API. Panel health is the shared local tags ping. The agent
 * tools fleet_list and fleet_health do the sweep.
 */

import { pingLocalOllama } from '../plugin/health';
import type { JewbotModule } from '../plugin/types';

export type { FleetFileEntry, FleetFileLoad, FleetVia } from './config';
export { defaultFleetPath, loadFleetFile, parseFleetDocument } from './config';
export type { FleetHealthReport, FleetHostHealth, FleetHostStatus, FleetInventory, FleetMember, FleetProbeDeps } from './probe';
export {
  FLEET_SIGNALS,
  FLEET_TAGS_COMMAND,
  checkFleet,
  formatFleetHealth,
  formatFleetList,
  listFleet,
  runGatedRemote,
} from './probe';

export const jewbotModule: JewbotModule = {
  id: 'fleet-triage',
  title: 'Fleet Triage',
  description:
    'Checks local Ollama and allowlisted SSH hosts from ~/.jewbot/fleet.json or ~/.jewbot/hosts.json. No cloud control plane and no paid API.',
  version: '0.2.0',
  capabilities: ['fleet', 'ops', 'local-only'],
  tools: [
    {
      name: 'fleet_list',
      description:
        'List fleet hosts. Uses ~/.jewbot/fleet.json when it exists, otherwise localhost plus the SSH allowlist. Does not print secrets.',
    },
    {
      name: 'fleet_health',
      description:
        'Ping local Ollama /api/tags and curl the same path on each allowlisted SSH host. A command argument is ignored. Destructive commands stay gated.',
    },
  ],
  health: pingLocalOllama,
};
