/**
 * Bundled JU Portfolio production-readiness gates.
 *
 * This is the checklist used when `<project>/.jewbot/portfolio-gates.json`
 * is absent. The same list is documented in `docs/migrations/portfolio-sweeper.md`.
 * Status changes are written only to that local file. Nothing here deploys,
 * calls a brokerage, or stores account numbers.
 */

export const GATE_FILE_VERSION = 1;

export const PORTFOLIO_GATE_IDS = [
  'local-change-report',
  'readiness-checklist',
  'secrets-stay-local',
  'no-orders',
  'production-signoff',
  'paid-spend-off',
] as const;

export type PortfolioGateId = (typeof PORTFOLIO_GATE_IDS)[number];

export const GATE_STATUSES = ['open', 'blocked', 'done'] as const;

export type GateStatus = (typeof GATE_STATUSES)[number];

export type BlockerKind = 'owner' | 'human' | 'local';

export interface GateBlocker {
  kind: BlockerKind;
  note: string;
}

export interface PortfolioGate {
  id: string;
  title: string;
  status: GateStatus;
  blocker: GateBlocker | null;
}

export interface PortfolioGateFile {
  version: number;
  gates: PortfolioGate[];
}

const BUNDLED_GATES: readonly PortfolioGate[] = [
  {
    id: 'local-change-report',
    title: 'Record what changed in the local portfolio folder',
    status: 'open',
    blocker: null,
  },
  {
    id: 'readiness-checklist',
    title: 'Keep the JU Portfolio production-readiness checklist in the local gate file',
    status: 'open',
    blocker: null,
  },
  {
    id: 'secrets-stay-local',
    title: 'Keep brokerage logins, API keys, and account numbers off git',
    status: 'open',
    blocker: {
      kind: 'owner',
      note: 'Owner confirms secrets stay on this machine. This module does not read them.',
    },
  },
  {
    id: 'no-orders',
    title: 'Confirm the sweeper never places an order or sends money',
    status: 'open',
    blocker: null,
  },
  {
    id: 'production-signoff',
    title: 'Owner signs the JU Portfolio production-readiness gate',
    status: 'blocked',
    blocker: {
      kind: 'human',
      note: 'A person signs off. Marking this gate does not deploy.',
    },
  },
  {
    id: 'paid-spend-off',
    title: 'Confirm review stays on local Ollama at $0',
    status: 'open',
    blocker: null,
  },
];

export function cloneGate(gate: PortfolioGate): PortfolioGate {
  return {
    id: gate.id,
    title: gate.title,
    status: gate.status,
    blocker: gate.blocker ? { kind: gate.blocker.kind, note: gate.blocker.note } : null,
  };
}

/** Fresh copies so a caller cannot rewrite the bundled catalog. */
export function bundledGates(): PortfolioGate[] {
  return BUNDLED_GATES.map(cloneGate);
}

export function bundledGateFile(): PortfolioGateFile {
  return { version: GATE_FILE_VERSION, gates: bundledGates() };
}
