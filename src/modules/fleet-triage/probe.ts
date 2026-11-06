/**
 * Fleet health. Localhost uses the Ollama tags ping. Every other machine is
 * an allowlisted SSH host and is checked with one read-only curl to its own
 * loopback Ollama. The destructive-command gate still wraps that exec.
 */

import { checkShellCommand } from '../safety';
import type { ConnectOptions, SshExecResult, SshManager } from '../ssh';
import {
  assertOllamaAllowed,
  defaultOllamaConfig,
  isLocalOllamaHost,
  isPaidProviderHost,
  normalizeOllamaHost,
  probeOllama,
  type OllamaConfig,
} from '../llm/ollama';
import { defaultFleetPath, loadFleetFile, type FleetFileEntry, type FleetVia } from './config';

/** Safe read-only probe. Sent only after checkShellCommand accepts it. */
export const FLEET_TAGS_COMMAND = 'curl -s http://127.0.0.1:11434/api/tags';

export const FLEET_SIGNALS = [
  'Local Ollama answers GET /api/tags.',
  'Each allowlisted SSH host runs curl -s http://127.0.0.1:11434/api/tags.',
  'A failed tags probe means that Ollama service is down.',
  'Disk and failed systemd timers are not collected.',
] as const;

export interface FleetMember {
  name: string;
  via: FleetVia;
  sshName?: string;
  ollamaHost?: string;
  /** Null for local members. SSH members are true only when the name is allowlisted. */
  allowlisted: boolean | null;
}

export interface FleetInventory {
  path: string;
  source: 'fleet.json' | 'implicit';
  error: string | null;
  hosts: FleetMember[];
  signals: readonly string[];
}

export type FleetHostStatus = 'up' | 'down' | 'not_allowlisted' | 'blocked' | 'refused';

export interface FleetHostHealth {
  name: string;
  via?: FleetVia;
  ok: boolean;
  models: string[];
  status: FleetHostStatus;
  error?: string;
}

export interface FleetHealthReport {
  ok: boolean;
  checkedAt: string;
  hosts: FleetHostHealth[];
  error?: string;
}

export interface FleetProbeDeps {
  ssh: SshManager;
  fleetPath?: string;
  confirmHostKey?: ConnectOptions['confirmHostKey'];
  promptSshSecret?: ConnectOptions['promptSecret'];
  signal?: AbortSignal;
  probeLocal?: (cfg: OllamaConfig) => Promise<{ ok: boolean; models: string[]; error?: string }>;
}

const REMOTE_TIMEOUT_MS = 8_000;

export function listFleet(deps: Pick<FleetProbeDeps, 'ssh' | 'fleetPath'>): FleetInventory {
  const fleetPath = deps.fleetPath ?? defaultFleetPath();
  const loaded = loadFleetFile(fleetPath);
  if (loaded.error) {
    return { path: fleetPath, source: 'fleet.json', error: loaded.error, hosts: [], signals: FLEET_SIGNALS };
  }
  const allow = new Set(deps.ssh.listHosts().map((host) => host.name));
  const entries = loaded.missing ? implicitEntries(deps.ssh) : loaded.hosts || [];
  return {
    path: fleetPath,
    source: loaded.missing ? 'implicit' : 'fleet.json',
    error: null,
    hosts: entries.map((entry) => toMember(entry, allow)),
    signals: FLEET_SIGNALS,
  };
}

export async function checkFleet(deps: FleetProbeDeps, opts?: { host?: string }): Promise<FleetHealthReport> {
  const inventory = listFleet(deps);
  const checkedAt = new Date().toISOString();
  if (inventory.error) return { ok: false, checkedAt, hosts: [], error: inventory.error };
  let members = inventory.hosts;
  const wanted = opts?.host?.trim();
  if (wanted) {
    members = members.filter((member) => member.name === wanted);
    if (!members.length) {
      return {
        ok: false,
        checkedAt,
        hosts: [
          {
            name: wanted,
            ok: false,
            models: [],
            status: 'down',
            error: `Host not in the fleet: ${wanted}`,
          },
        ],
      };
    }
  }
  const hosts: FleetHostHealth[] = [];
  for (const member of members) {
    if (deps.signal?.aborted) {
      hosts.push({
        name: member.name,
        via: member.via,
        ok: false,
        models: [],
        status: 'refused',
        error: 'Cancelled',
      });
      continue;
    }
    hosts.push(await checkMember(deps, member));
  }
  return { ok: hosts.length > 0 && hosts.every((host) => host.ok), checkedAt, hosts };
}

/**
 * Classify `command` before any SSH exec. A destructive command is returned
 * as BLOCKED and is not sent. Fleet health calls this with FLEET_TAGS_COMMAND.
 */
export async function runGatedRemote(
  ssh: SshManager,
  target: string,
  command: string,
  signal?: AbortSignal,
): Promise<SshExecResult> {
  const decision = checkShellCommand(command, { requireApproval: false });
  if (!decision.ok) {
    return {
      host: target,
      exitCode: null,
      stdout: '',
      stderr: decision.reason,
      status: 'BLOCKED',
      killed: false,
      truncated: false,
      timedOut: false,
    };
  }
  return ssh.exec(target, command, { signal, timeoutMs: REMOTE_TIMEOUT_MS });
}

export function formatFleetList(inventory: FleetInventory): string {
  if (inventory.error) return `ERROR: ${inventory.error}`;
  const lines = [`source: ${inventory.source}`, `path: ${inventory.path}`];
  if (!inventory.hosts.length) lines.push('(no hosts)');
  for (const host of inventory.hosts) {
    if (host.via === 'local') {
      lines.push(`${host.name} via=local${host.ollamaHost ? ` ollama=${host.ollamaHost}` : ''}`);
    } else {
      lines.push(`${host.name} via=ssh ssh=${host.sshName} allowlisted=${host.allowlisted ? 'yes' : 'no'}`);
    }
  }
  lines.push('signals:');
  for (const signal of inventory.signals) lines.push(`- ${signal}`);
  return lines.join('\n');
}

export function formatFleetHealth(report: FleetHealthReport): string {
  const lines = [`ok: ${report.ok}`, `checked_at: ${report.checkedAt}`];
  if (report.error) lines.push(`error: ${report.error}`);
  for (const host of report.hosts) {
    const via = host.via ? ` via=${host.via}` : '';
    const models = host.models.length ? ` models=${host.models.join(',')}` : '';
    const error = host.error ? ` error=${host.error}` : '';
    lines.push(`${host.name}${via} status=${host.status}${models}${error}`);
  }
  return lines.join('\n');
}

function implicitEntries(ssh: SshManager): FleetFileEntry[] {
  return [
    { name: 'localhost', via: 'local' },
    ...ssh.listHosts().map((host) => ({ name: host.name, via: 'ssh' as const, sshName: host.name })),
  ];
}

function toMember(entry: FleetFileEntry, allow: Set<string>): FleetMember {
  if (entry.via === 'local') {
    return { name: entry.name, via: 'local', ollamaHost: entry.ollamaHost, allowlisted: null };
  }
  const sshName = entry.sshName || entry.name;
  return { name: entry.name, via: 'ssh', sshName, allowlisted: allow.has(sshName) };
}

async function checkMember(deps: FleetProbeDeps, member: FleetMember): Promise<FleetHostHealth> {
  if (member.via === 'local') return checkLocal(deps, member);
  return checkRemote(deps, member);
}

async function checkLocal(deps: FleetProbeDeps, member: FleetMember): Promise<FleetHostHealth> {
  const base = { name: member.name, via: 'local' as const, models: [] as string[] };
  let cfg: OllamaConfig;
  try {
    cfg = localProbeConfig(member.ollamaHost);
    assertFleetProbeLocal(cfg);
  } catch (err) {
    return { ...base, ok: false, status: 'refused', error: messageOf(err) };
  }
  const probe = deps.probeLocal ?? probeOllama;
  const result = await probe(cfg);
  if (!result.ok) return { ...base, ok: false, status: 'down', error: result.error || 'ollama down' };
  return { ...base, ok: true, status: 'up', models: result.models };
}

async function checkRemote(deps: FleetProbeDeps, member: FleetMember): Promise<FleetHostHealth> {
  const base = { name: member.name, via: 'ssh' as const, models: [] as string[] };
  const sshName = member.sshName || member.name;
  if (!member.allowlisted) {
    return { ...base, ok: false, status: 'not_allowlisted', error: `Host not allowlisted: ${sshName}` };
  }
  const decision = checkShellCommand(FLEET_TAGS_COMMAND, { requireApproval: false });
  if (!decision.ok) return { ...base, ok: false, status: 'blocked', error: decision.reason };
  const already = deps.ssh.listSessions().some((session) => session.name === sshName);
  try {
    if (!already) {
      await deps.ssh.connect(sshName, {
        confirmHostKey: deps.confirmHostKey,
        promptSecret: deps.promptSshSecret,
        signal: deps.signal,
      });
    }
    const result = await runGatedRemote(deps.ssh, sshName, FLEET_TAGS_COMMAND, deps.signal);
    if (result.status === 'BLOCKED') return { ...base, ok: false, status: 'blocked', error: result.stderr || 'blocked' };
    if (result.status !== 'EXECUTED' || result.exitCode !== 0) {
      const tail = result.stderr.trim() || result.stdout.trim();
      const exit = result.exitCode === null ? 'null' : String(result.exitCode);
      const detail = tail ? `exit ${exit}: ${tail}` : `exit ${exit}: ${result.status}`;
      return { ...base, ok: false, status: 'down', error: detail };
    }
    try {
      return { ...base, ok: true, status: 'up', models: modelsFromTags(result.stdout) };
    } catch (err) {
      return { ...base, ok: false, status: 'down', error: messageOf(err) };
    }
  } catch (err) {
    return { ...base, ok: false, status: 'refused', error: messageOf(err) };
  } finally {
    if (!already) deps.ssh.disconnect(sshName);
  }
}

function localProbeConfig(explicit?: string): OllamaConfig {
  if (explicit) return { host: normalizeOllamaHost(explicit), model: 'fleet-probe', allowPaidApis: false };
  const base = defaultOllamaConfig();
  return { host: base.host, model: base.model || 'fleet-probe', allowPaidApis: false };
}

function assertFleetProbeLocal(cfg: OllamaConfig): void {
  const host = normalizeOllamaHost(cfg.host);
  if (!isLocalOllamaHost(host) || isPaidProviderHost(host)) {
    throw new Error(`Fleet triage stays on local Ollama. Refusing ${host}.`);
  }
  assertOllamaAllowed({ ...cfg, host, allowPaidApis: false });
}

function modelsFromTags(stdout: string): string[] {
  const trimmed = stdout.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Remote tags response was not JSON');
    parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Remote tags response was not JSON');
  }
  const models = (parsed as { models?: unknown }).models;
  if (!Array.isArray(models)) throw new Error('Remote tags response has no models array');
  return models
    .map((item) => (item && typeof item === 'object' ? (item as { name?: unknown }).name : undefined))
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
