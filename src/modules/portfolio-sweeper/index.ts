/**
 * Portfolio sweeper: a local checklist of JU Portfolio production-readiness
 * gates. Tools read and mark status in `.jewbot/portfolio-gates.json`.
 * They do not deploy, call a brokerage, or spend.
 */

import type { JewbotModule } from '../plugin/types';
import { portfolioHealth } from './health';
import { listGates, markGate, nextFreeGate, type GateSource, type MarkGateResult } from './store';

export type { BlockerKind, GateBlocker, GateStatus, PortfolioGate, PortfolioGateFile, PortfolioGateId } from './checklist';
export { bundledGateFile, bundledGates, GATE_FILE_VERSION, GATE_STATUSES, PORTFOLIO_GATE_IDS } from './checklist';
export { portfolioHealth } from './health';
export type { GateSource, MarkGateResult } from './store';
export {
  gateFilePath,
  isFreeGate,
  isOwnerOrHumanBlocker,
  listGates,
  markGate,
  nextFreeGate,
  resolvePortfolioRoot,
} from './store';

export const PORTFOLIO_TOOL_NAMES = ['portfolio_list_gates', 'portfolio_mark_gate', 'portfolio_next_free'] as const;

export type PortfolioToolName = (typeof PORTFOLIO_TOOL_NAMES)[number];

export type PortfolioToolResult = GateSource | MarkGateResult | ReturnType<typeof nextFreeGate>;

export function portfolioListGates(root?: string): GateSource {
  return listGates(root);
}

export function portfolioMarkGate(id: string, status: string, root?: string): MarkGateResult {
  return markGate(id, status, root);
}

export function portfolioNextFree(root?: string): ReturnType<typeof nextFreeGate> {
  return nextFreeGate(root);
}

function formatGateLine(gate: { id: string; title: string; status: string; blocker: { kind: string; note: string } | null }): string {
  const blocker = gate.blocker ? `${gate.blocker.kind}${gate.blocker.note ? `: ${gate.blocker.note}` : ''}` : 'none';
  return `${gate.id} status=${gate.status} blocker=${blocker} title=${gate.title}`;
}

export function formatPortfolioList(source: GateSource): string {
  const lines = source.gates.map(formatGateLine);
  return [`source=${source.source}`, `path=${source.path}`, ...(lines.length ? lines : ['(no gates)'])].join('\n');
}

export function formatPortfolioNext(result: ReturnType<typeof nextFreeGate>): string {
  if (!result.gate) return `source=${result.source}\npath=${result.path}\nnext=none`;
  return `source=${result.source}\npath=${result.path}\nnext=${formatGateLine(result.gate)}`;
}

export function formatPortfolioMark(result: MarkGateResult): string {
  return `deployed=false\npath=${result.path}\n${formatGateLine(result.gate)}`;
}

export function portfolioCallTool(
  name: string,
  args: Record<string, unknown> = {},
  root?: string,
): PortfolioToolResult {
  if (name === 'portfolio_list_gates') return portfolioListGates(root);
  if (name === 'portfolio_next_free') return portfolioNextFree(root);
  if (name === 'portfolio_mark_gate') {
    if (typeof args.id !== 'string' || typeof args.status !== 'string') {
      throw new Error('portfolio_mark_gate needs string id and status.');
    }
    return portfolioMarkGate(args.id, args.status, root);
  }
  throw new Error(`Unknown portfolio tool: ${name}`);
}

const portfolioModule = {
  id: 'portfolio-sweeper',
  title: 'Portfolio Sweeper',
  description:
    'Tracks JU Portfolio production-readiness gates in a local checklist. Status changes stay in .jewbot/portfolio-gates.json. This module does not deploy, call a brokerage, or spend.',
  version: '0.2.0',
  capabilities: ['checklist', 'ops', 'local-only'],
  tools: [
    {
      name: 'portfolio_list_gates',
      description:
        'List production-readiness gates from .jewbot/portfolio-gates.json, or the bundled checklist when that file is absent.',
    },
    {
      name: 'portfolio_mark_gate',
      description:
        'Set one gate status (open, blocked, or done) in the local checklist only. Does not deploy or contact a brokerage.',
    },
    {
      name: 'portfolio_next_free',
      description: 'Return the next open gate that has no owner or human blocker.',
    },
  ],
  health: portfolioHealth,
} satisfies JewbotModule;

export const jewbotModule = Object.assign(portfolioModule, {
  call(name: string, args: Record<string, unknown> = {}, root?: string): PortfolioToolResult {
    return portfolioCallTool(name, args, root);
  },
});
