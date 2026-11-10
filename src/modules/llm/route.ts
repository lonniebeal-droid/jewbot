/**
 * LAN Ollama routing for the hub.
 *
 * Every host goes through assertLocalSpendOnly(false) before /api/tags.
 * Loopback, private LAN, and Tailscale 100.64/10 (plus IPv6 ULA) may be probed.
 * Public addresses and paid hostnames are refused and are not fetched.
 * The first healthy host that has the requested model wins. Later hosts are
 * still probed so health() can list them. This file does not open SSH.
 */

import { assertLocalSpendOnly } from '../safety';
import type { ModuleHealth } from '../plugin/types';
import { loadOllamaHosts, type OllamaHostEntry } from './hosts';
import {
  assertOllamaAllowed,
  chatOnce,
  type ChatMessage,
  type ChatStreamOptions,
  isPaidProviderHost,
  isRoutableFreeHost,
  listModels,
  normalizeOllamaHost,
  type OllamaConfig,
} from './ollama';

const DEFAULT_MODEL = 'qwen2.5-coder:7b';

export interface HostHealth {
  name: string;
  host: string;
  ok: boolean;
  refused: boolean;
  models: string[];
  error?: string;
}

export interface OllamaRouteReport {
  model: string;
  hosts: HostHealth[];
  /** First healthy host in registry order whose tags include `model`. */
  selected: { name: string; host: string } | null;
}

export function requestedRouteModel(explicit?: string): string {
  const fromCaller = explicit?.trim();
  if (fromCaller) return fromCaller;
  const fromEnv = process.env.JEWBOT_MODEL?.trim();
  return fromEnv || DEFAULT_MODEL;
}

/**
 * Spend gate for one registry host. assertLocalSpendOnly(false) always runs.
 * A refused host throws before the caller can open a socket.
 */
function closedSpendReason(): string {
  const decision = assertLocalSpendOnly(false);
  if (!decision.ok) return decision.reason;
  return 'LAN routing keeps the spend gate closed.';
}

export function assertRoutableOllamaHost(host: string): string {
  let normalized: string;
  try {
    normalized = normalizeOllamaHost(host);
  } catch {
    throw new Error(`${closedSpendReason()} Refusing ${host}.`);
  }
  const decision = assertLocalSpendOnly(false);
  const allowed = isRoutableFreeHost(normalized) && !isPaidProviderHost(normalized);
  if (!allowed || decision.ok) {
    const reason = decision.ok ? 'LAN routing keeps the spend gate closed.' : decision.reason;
    throw new Error(`${reason} Refusing ${normalized}.`);
  }
  return normalized;
}

export function hostHasModel(models: string[], requested: string): boolean {
  const want = requested.trim().toLowerCase();
  if (!want) return false;
  const wantBase = want.split(':')[0];
  return models.some((name) => {
    const got = name.trim().toLowerCase();
    if (!got) return false;
    if (got === want) return true;
    const gotBase = got.split(':')[0];
    return gotBase === want || got === wantBase;
  });
}

/**
 * Probe every registry host with GET /api/tags, in order.
 * Refused hosts are recorded and not fetched.
 */
export async function inspectOllamaHosts(options?: {
  model?: string;
  entries?: OllamaHostEntry[];
}): Promise<OllamaRouteReport> {
  const model = requestedRouteModel(options?.model);
  const entries = options?.entries ?? loadOllamaHosts();
  const hosts: HostHealth[] = [];
  let selected: OllamaRouteReport['selected'] = null;
  for (const entry of entries) {
    const row = await probeEntry(entry);
    hosts.push(row);
    if (!selected && row.ok && hostHasModel(row.models, model)) {
      selected = { name: row.name, host: row.host };
    }
  }
  return { model, hosts, selected };
}

/** Hub health for the Ollama module. Lists every registry host and the pick. */
export async function hubOllamaHealth(): Promise<ModuleHealth> {
  try {
    const report = await inspectOllamaHosts();
    return {
      ok: report.selected !== null,
      detail: formatRouteReport(report),
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export function formatRouteReport(report: OllamaRouteReport): string {
  const parts = report.hosts.map((host) => {
    if (host.refused) return `${host.name}=refused`;
    return `${host.name}=${host.ok ? 'ok' : 'down'}`;
  });
  const selected = report.selected ? report.selected.name : 'none';
  return `hosts ${parts.join(',') || '(none)'} selected=${selected} model=${report.model}`;
}

/**
 * One chat on the selected host. The config passed to chatOnce has the spend
 * gate closed and allowPrivateLan set, so a private address can be used and a
 * public one cannot.
 */
export async function routedChatOnce(
  messages: ChatMessage[],
  options?: ChatStreamOptions & { model?: string; entries?: OllamaHostEntry[] },
): Promise<{ host: string; name: string; text: string }> {
  const report = await inspectOllamaHosts({ model: options?.model, entries: options?.entries });
  if (!report.selected) {
    throw new Error(`No healthy Ollama host has model ${report.model}.`);
  }
  const cfg = routedConfig(report.selected.host, report.model);
  const text = await chatOnce(messages, cfg, options);
  return { host: cfg.host, name: report.selected.name, text };
}

function routedConfig(host: string, model: string): OllamaConfig {
  const normalized = assertRoutableOllamaHost(host);
  return { host: normalized, model, allowPaidApis: false, allowPrivateLan: true };
}

async function probeEntry(entry: OllamaHostEntry): Promise<HostHealth> {
  if (entry.error || !entry.host) {
    return {
      name: entry.name,
      host: entry.host,
      ok: false,
      refused: true,
      models: [],
      error: entry.error || closedSpendReason(),
    };
  }
  let host = entry.host;
  try {
    host = assertRoutableOllamaHost(entry.host);
  } catch (err) {
    return {
      name: entry.name,
      host: entry.host,
      ok: false,
      refused: true,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    const cfg = routedConfig(host, requestedRouteModel());
    assertOllamaAllowed(cfg);
    const models = await listModels(cfg);
    return { name: entry.name, host, ok: true, refused: false, models };
  } catch (err) {
    return {
      name: entry.name,
      host,
      ok: false,
      refused: false,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
