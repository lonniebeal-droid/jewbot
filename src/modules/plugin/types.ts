/**
 * Hub module contract. Every Lonnie bot that runs inside Jewbot implements this.
 * Chat goes through the local Ollama binding, not a paid SDK.
 */

export interface ModuleTool {
  name: string;
  description: string;
}

export interface ModuleHealth {
  ok: boolean;
  detail?: string;
}

export interface JewbotModule {
  id: string;
  title: string;
  description: string;
  version: string;
  capabilities: string[];
  tools?: ModuleTool[];
  start?: () => void | Promise<void>;
  stop?: () => void | Promise<void>;
  health: () => ModuleHealth | Promise<ModuleHealth>;
}

export interface ModulePanelRow {
  id: string;
  title: string;
  description: string;
  version: string;
  capabilities: string[];
  health: 'ok' | 'down';
  detail?: string;
}
