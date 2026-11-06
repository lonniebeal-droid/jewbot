/**
 * Process-local module registry. Registration does not start network calls.
 */

import type { JewbotModule } from './types';

const modules = new Map<string, JewbotModule>();

const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function validateModule(mod: JewbotModule): string | null {
  if (!mod || typeof mod !== 'object') return 'module is not an object';
  if (typeof mod.id !== 'string' || !ID_RE.test(mod.id)) return `invalid id: ${String(mod.id)}`;
  if (typeof mod.title !== 'string' || !mod.title.trim()) return `${mod.id}: title is required`;
  if (typeof mod.description !== 'string' || !mod.description.trim()) return `${mod.id}: description is required`;
  if (typeof mod.version !== 'string' || !VERSION_RE.test(mod.version)) return `${mod.id}: version must be semver`;
  if (!Array.isArray(mod.capabilities) || mod.capabilities.length === 0) {
    return `${mod.id}: capabilities must be a non-empty string array`;
  }
  if (mod.capabilities.some((cap) => typeof cap !== 'string' || !cap.trim())) {
    return `${mod.id}: capabilities must be non-empty strings`;
  }
  if (mod.tools !== undefined) {
    if (!Array.isArray(mod.tools)) return `${mod.id}: tools must be an array`;
    for (const tool of mod.tools) {
      if (!tool || typeof tool.name !== 'string' || !tool.name.trim()) return `${mod.id}: tool name is required`;
      if (typeof tool.description !== 'string' || !tool.description.trim()) {
        return `${mod.id}: tool ${tool.name} needs a description`;
      }
    }
  }
  if (mod.start !== undefined && typeof mod.start !== 'function') return `${mod.id}: start must be a function`;
  if (mod.stop !== undefined && typeof mod.stop !== 'function') return `${mod.id}: stop must be a function`;
  if (typeof mod.health !== 'function') return `${mod.id}: health() is required`;
  return null;
}

export function registerModule(mod: JewbotModule): JewbotModule {
  const problem = validateModule(mod);
  if (problem) throw new Error(problem);
  if (modules.has(mod.id)) throw new Error(`Module already registered: ${mod.id}`);
  modules.set(mod.id, mod);
  return mod;
}

export function listModules(): JewbotModule[] {
  return [...modules.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function getModule(id: string): JewbotModule | undefined {
  return modules.get(id);
}

/** Removes the registration. Does not call `stop` (see `shutdownModules`). */
export function unregisterModule(id: string): boolean {
  return modules.delete(id);
}

/** Test helper. Does not call `stop`. */
export function resetRegistry(): void {
  modules.clear();
}
