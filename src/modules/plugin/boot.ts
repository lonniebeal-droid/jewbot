/**
 * Register built-in manifests and anything discoverable on disk.
 * On-disk manifests win when an id is seen twice, so the real Muse
 * module (not a stub) is what the hub runs.
 */

import * as path from 'path';
import { builtinManifests } from './catalog';
import { discoverModules } from './discover';
import { getModule, listModules, registerModule } from './registry';
import type { JewbotModule, ModulePanelRow } from './types';

let bootErrors: string[] = [];

export function defaultModulesRoot(): string {
  return path.resolve(__dirname, '..');
}

export function lastBootErrors(): string[] {
  return [...bootErrors];
}

export async function bootModules(modulesRoot?: string): Promise<JewbotModule[]> {
  bootErrors = [];
  const discovered = discoverModules(modulesRoot ?? defaultModulesRoot());
  bootErrors.push(...discovered.errors);
  const chosen = new Map<string, JewbotModule>();
  for (const mod of builtinManifests) chosen.set(mod.id, mod);
  for (const mod of discovered.modules) chosen.set(mod.id, mod);
  for (const mod of chosen.values()) {
    if (getModule(mod.id)) continue;
    try {
      registerModule(mod);
      if (mod.start) await mod.start();
    } catch (err) {
      bootErrors.push(`${mod.id}: ${message(err)}`);
    }
  }
  for (const line of bootErrors) console.warn(`jewbot module: ${line}`);
  return listModules();
}

export async function shutdownModules(): Promise<void> {
  for (const mod of [...listModules()].reverse()) {
    if (!mod.stop) continue;
    try {
      await mod.stop();
    } catch (err) {
      console.warn(`jewbot module ${mod.id} stop: ${message(err)}`);
    }
  }
}

export async function listModuleHealth(): Promise<ModulePanelRow[]> {
  const rows: ModulePanelRow[] = [];
  for (const mod of listModules()) {
    try {
      const health = await mod.health();
      rows.push(toRow(mod, health.ok, health.detail));
    } catch (err) {
      rows.push(toRow(mod, false, message(err)));
    }
  }
  return rows;
}

function toRow(mod: JewbotModule, ok: boolean, detail: string | undefined): ModulePanelRow {
  return {
    id: mod.id,
    title: mod.title,
    description: mod.description,
    version: mod.version,
    capabilities: [...mod.capabilities],
    health: ok ? 'ok' : 'down',
    detail,
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
