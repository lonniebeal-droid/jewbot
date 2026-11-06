export type { JewbotModule, ModuleHealth, ModulePanelRow, ModuleTool } from './types';
export {
  getModule,
  listModules,
  registerModule,
  resetRegistry,
  unregisterModule,
  validateModule,
} from './registry';
export { discoverModules, type DiscoverResult } from './discover';
export { pingLocalOllama, resetOllamaHealthCache } from './health';
export { assertModuleChatAllowed, moduleChat, moduleChatStream, resolveModuleChatConfig } from './chat';
export { migrationStub } from './stub';
export { bootModules, defaultModulesRoot, lastBootErrors, listModuleHealth, shutdownModules } from './boot';
