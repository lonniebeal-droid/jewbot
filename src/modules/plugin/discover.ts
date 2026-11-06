/**
 * Load `manifest.ts` / `manifest.js` or `jewbot.module.json` from each
 * immediate child of the modules root. The `plugin` directory is the hub
 * itself and is not a module.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pingLocalOllama } from './health';
import { validateModule } from './registry';
import type { JewbotModule, ModuleTool } from './types';

const SKIP_DIRS = new Set(['plugin']);

export interface DiscoverResult {
  modules: JewbotModule[];
  errors: string[];
}

export function discoverModules(modulesRoot: string): DiscoverResult {
  const modules: JewbotModule[] = [];
  const errors: string[] = [];
  if (!fs.existsSync(modulesRoot)) {
    errors.push(`Modules root not found: ${modulesRoot}`);
    return { modules, errors };
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(modulesRoot, { withFileTypes: true });
  } catch (err) {
    errors.push(message(err));
    return { modules, errors };
  }
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of dirs) {
    const dir = path.join(modulesRoot, entry.name);
    try {
      const loaded = loadOne(dir);
      if (!loaded) continue;
      if (loaded.id !== entry.name) {
        errors.push(`${entry.name}: manifest id "${loaded.id}" does not match the directory`);
        continue;
      }
      const problem = validateModule(loaded);
      if (problem) {
        errors.push(`${entry.name}: ${problem}`);
        continue;
      }
      if (modules.some((mod) => mod.id === loaded.id)) {
        errors.push(`${entry.name}: duplicate id ${loaded.id}`);
        continue;
      }
      modules.push(loaded);
    } catch (err) {
      errors.push(`${entry.name}: ${message(err)}`);
    }
  }
  return { modules, errors };
}

function loadOne(dir: string): JewbotModule | null {
  const js = path.join(dir, 'manifest.js');
  const ts = path.join(dir, 'manifest.ts');
  const json = path.join(dir, 'jewbot.module.json');
  const code = fs.existsSync(js) ? js : fs.existsSync(ts) ? ts : null;
  if (code) {
    const loaded = require(code) as Record<string, unknown>;
    const picked = loaded.jewbotModule ?? loaded.module ?? loaded.default;
    if (!picked || typeof picked !== 'object') {
      throw new Error(`manifest must export jewbotModule (found: ${Object.keys(loaded).join(', ') || 'none'})`);
    }
    return picked as JewbotModule;
  }
  if (fs.existsSync(json)) return moduleFromJson(json);
  return null;
}

function moduleFromJson(file: string): JewbotModule {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('jewbot.module.json must be an object');
  }
  const body = raw as Record<string, unknown>;
  return {
    id: requiredString(body.id, 'id'),
    title: requiredString(body.title, 'title'),
    description: requiredString(body.description, 'description'),
    version: requiredString(body.version, 'version'),
    capabilities: requiredStrings(body.capabilities, 'capabilities'),
    tools: body.tools === undefined ? undefined : parseTools(body.tools),
    health: pingLocalOllama,
  };
}

function parseTools(value: unknown): ModuleTool[] {
  if (!Array.isArray(value)) throw new Error('tools must be an array');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('tool must be an object');
    const tool = item as Record<string, unknown>;
    return {
      name: requiredString(tool.name, 'tool.name'),
      description: requiredString(tool.description, 'tool.description'),
    };
  });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string`);
  return value.trim();
}

function requiredStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`);
  return value.map((item, index) => requiredString(item, `${label}[${index}]`));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
