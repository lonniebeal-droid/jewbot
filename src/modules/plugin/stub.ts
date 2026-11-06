/**
 * Thin migration stub. Health is a local Ollama /api/tags ping.
 * No cloud SDK. Chat, when added later, must use `moduleChat`.
 */

import { pingLocalOllama } from './health';
import type { JewbotModule } from './types';

export function migrationStub(
  spec: Omit<JewbotModule, 'health'> & { health?: JewbotModule['health'] },
): JewbotModule {
  return {
    ...spec,
    health: spec.health ?? pingLocalOllama,
  };
}
