import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export interface StreamEvent {
  requestId: string;
  type: string;
  text?: string;
  name?: string;
  args?: Record<string, unknown>;
  observation?: string;
  status?: string;
  message?: string;
  finalText?: string;
  blockReason?: string;
  steps?: unknown;
  confirmId?: string;
  command?: string;
  reason?: string;
  category?: string;
  stream?: 'stdout' | 'stderr';
  editId?: string;
  path?: string;
  unifiedDiff?: string;
  created?: boolean;
  secret?: boolean;
  tool?: string;
}

export interface SshPanelEvent {
  type: 'chunk' | 'exit' | 'connected' | 'disconnected' | 'hostkey_required' | 'secret_required';
  sessionId?: string;
  execId?: string;
  stream?: 'stdout' | 'stderr';
  text?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  truncated?: boolean;
  killed?: boolean;
  status?: string;
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  fingerprint?: string;
  algorithm?: string;
  mismatch?: boolean;
  previousFingerprint?: string;
  confirmId?: string;
  promptId?: string;
  kind?: 'passphrase' | 'password';
}

export interface SshStartResult {
  ok: boolean;
  started: boolean;
  sessionId?: string;
  execId?: string;
  needsConfirmation?: boolean;
  reason?: string;
  category?: string;
  pattern?: string;
  executionId?: string;
}

export interface CascadeTaskView {
  id: string;
  title: string;
  prompt: string;
  status: string;
  acceptance?: string;
  reason?: string;
  receipt?: string;
}

export interface CascadeSnapshot {
  runState: 'idle' | 'running' | 'paused';
  tasks: CascadeTaskView[];
  error: string | null;
  maxSteps: number;
  maxWallMs: number;
  allowPaidApis: boolean;
}

export interface TerminalPanelEvent {
  type: 'chunk' | 'exit';
  sessionId: string;
  stream?: 'stdout' | 'stderr';
  text?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  truncated?: boolean;
  killed?: boolean;
  backend?: string;
}

export interface TerminalStartResult {
  ok: boolean;
  started: boolean;
  sessionId?: string;
  backend?: string;
  needsConfirmation?: boolean;
  reason?: string;
  category?: string;
  pattern?: string;
}

contextBridge.exposeInMainWorld('jewbot', {
  status: () => ipcRenderer.invoke('jewbot:status'),
  agentRun: (goal: string) => ipcRenderer.invoke('jewbot:agentRun', goal),
  startAgent: (payload: { requestId: string; goal: string }) => ipcRenderer.send('jewbot:agentStart', payload),
  startChat: (payload: { requestId: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> }) =>
    ipcRenderer.send('jewbot:chatStart', payload),
  cancelStream: (requestId: string) => ipcRenderer.send('jewbot:streamCancel', requestId),
  onStreamEvent: (cb: (ev: StreamEvent) => void) => {
    const listener = (_event: IpcRendererEvent, data: StreamEvent) => cb(data);
    ipcRenderer.on('jewbot:streamEvent', listener);
    return () => ipcRenderer.removeListener('jewbot:streamEvent', listener);
  },
  pickProjectRoot: () => ipcRenderer.invoke('jewbot:pickProjectRoot'),
  terminalStart: (payload: { command: string; executionId?: string }) =>
    ipcRenderer.invoke('jewbot:terminalStart', payload) as Promise<TerminalStartResult>,
  terminalConfirm: (command: string) =>
    ipcRenderer.invoke('jewbot:terminalConfirm', command) as Promise<TerminalStartResult & { executionId?: string }>,
  terminalKill: (sessionId: string) => ipcRenderer.invoke('jewbot:terminalKill', sessionId) as Promise<{ killed: boolean }>,
  terminalRun: (command: string) => ipcRenderer.invoke('jewbot:terminalRun', command),
  confirmReply: (payload: { confirmId: string; approved: boolean }) => ipcRenderer.send('jewbot:confirmReply', payload),
  editReply: (payload: { editId: string; accepted: boolean }) => ipcRenderer.send('jewbot:editReply', payload),
  editUndo: (editId: string) =>
    ipcRenderer.invoke('jewbot:editUndo', editId) as Promise<{ ok: boolean; filePath?: string; action?: string; reason?: string }>,
  onTerminalEvent: (cb: (ev: TerminalPanelEvent) => void) => {
    const listener = (_event: IpcRendererEvent, data: TerminalPanelEvent) => cb(data);
    ipcRenderer.on('jewbot:terminalEvent', listener);
    return () => ipcRenderer.removeListener('jewbot:terminalEvent', listener);
  },
  contextSummary: () => ipcRenderer.invoke('jewbot:contextSummary'),
  sshList: () => ipcRenderer.invoke('jewbot:sshList'),
  sshConnect: (name: string) => ipcRenderer.invoke('jewbot:sshConnect', name),
  sshDisconnect: (target: string) => ipcRenderer.invoke('jewbot:sshDisconnect', target) as Promise<{ ok: boolean }>,
  sshExec: (payload: { target: string; command: string; executionId?: string }) =>
    ipcRenderer.invoke('jewbot:sshExec', payload) as Promise<SshStartResult>,
  sshConfirm: (command: string) => ipcRenderer.invoke('jewbot:sshConfirm', command) as Promise<SshStartResult>,
  sshKill: (execId: string) => ipcRenderer.invoke('jewbot:sshKill', execId) as Promise<{ killed: boolean }>,
  sshHostKeyReply: (payload: { confirmId: string; approved: boolean }) => ipcRenderer.send('jewbot:sshHostKeyReply', payload),
  sshSecretReply: (payload: { promptId: string; secret: string | null }) => ipcRenderer.send('jewbot:sshSecretReply', payload),
  onSshEvent: (cb: (ev: SshPanelEvent) => void) => {
    const listener = (_event: IpcRendererEvent, data: SshPanelEvent) => cb(data);
    ipcRenderer.on('jewbot:sshEvent', listener);
    return () => ipcRenderer.removeListener('jewbot:sshEvent', listener);
  },
  cascadeList: () => ipcRenderer.invoke('jewbot:cascadeList') as Promise<CascadeSnapshot>,
  cascadeAdd: (payload: { title: string; prompt: string; acceptance?: string }) =>
    ipcRenderer.invoke('jewbot:cascadeAdd', payload) as Promise<{ ok: boolean; reason?: string; task?: CascadeTaskView }>,
  cascadeStart: () => ipcRenderer.invoke('jewbot:cascadeStart') as Promise<CascadeSnapshot & { ok?: boolean; reason?: string }>,
  cascadePause: () => ipcRenderer.invoke('jewbot:cascadePause') as Promise<CascadeSnapshot>,
  cascadeStop: () => ipcRenderer.invoke('jewbot:cascadeStop') as Promise<CascadeSnapshot>,
  cascadeRequeue: (id: string) => ipcRenderer.invoke('jewbot:cascadeRequeue', id) as Promise<{ ok: boolean; reason?: string }>,
  cascadeRemove: (id: string) => ipcRenderer.invoke('jewbot:cascadeRemove', id) as Promise<{ ok: boolean; reason?: string }>,
  onCascadeEvent: (cb: (snap: CascadeSnapshot) => void) => {
    const listener = (_event: IpcRendererEvent, data: CascadeSnapshot) => cb(data);
    ipcRenderer.on('jewbot:cascadeEvent', listener);
    return () => ipcRenderer.removeListener('jewbot:cascadeEvent', listener);
  },
  rulesGet: () => ipcRenderer.invoke('jewbot:rulesGet') as Promise<{ enabled: boolean; text: string }>,
  rulesSet: (enabled: boolean) => ipcRenderer.invoke('jewbot:rulesSet', enabled) as Promise<{ enabled: boolean }>,
  modelsList: (host: string) => ipcRenderer.invoke('jewbot:modelsList', host) as Promise<{ models: string[]; error?: string }>,
  modelsPull: (payload: { host: string; name: string }) => ipcRenderer.invoke('jewbot:modelsPull', payload) as Promise<{ ok: boolean; error?: string }>,
  modelsDelete: (payload: { host: string; name: string }) =>
    ipcRenderer.invoke('jewbot:modelsDelete', payload) as Promise<{ ok: boolean; needsConfirmation?: boolean; error?: string }>,
  modelsSettings: (payload?: { models: Record<string, string> }) =>
    ipcRenderer.invoke('jewbot:modelsSettings', payload) as Promise<{ models: Record<string, string> }>,
  backgroundRun: (payload: { host: string; model: string; goal: string }) =>
    ipcRenderer.invoke('jewbot:backgroundRun', payload) as Promise<{ ok: boolean; error?: string; task?: { id: string; diff?: string; status: string } }>,
  backgroundAccept: (id: string) => ipcRenderer.invoke('jewbot:backgroundAccept', id) as Promise<{ ok: boolean; error?: string }>,
  mcpList: () => ipcRenderer.invoke('jewbot:mcpList') as Promise<{ servers: Array<{ name: string; allow: boolean; line: string }>; error?: string }>,
  mcpAllow: (payload: { name: string; allow: boolean }) =>
    ipcRenderer.invoke('jewbot:mcpAllow', payload) as Promise<{ ok: boolean; error?: string }>,
  expandMentions: (text: string) => ipcRenderer.invoke('jewbot:expandMentions', text) as Promise<{ text: string; error?: string }>,
  composerAdd: (payload: { path: string; proposed: string }) => ipcRenderer.invoke('jewbot:composerAdd', payload),
  composerState: () => ipcRenderer.invoke('jewbot:composerState'),
  composerDecide: (payload: { scope: 'file' | 'hunk'; path?: string; id?: string; decision: 'accept' | 'reject' }) =>
    ipcRenderer.invoke('jewbot:composerDecide', payload),
  composerApply: () => ipcRenderer.invoke('jewbot:composerApply'),
  composerUndo: () => ipcRenderer.invoke('jewbot:composerUndo'),
  gitRun: (payload: { action: string; args?: string[]; executionId?: string }) => ipcRenderer.invoke('jewbot:gitRun', payload),
  gitConfirm: (payload: { action: 'push' | 'reset' | 'clean'; args?: string[] }) => ipcRenderer.invoke('jewbot:gitConfirm', payload),
  gitSuggest: () => ipcRenderer.invoke('jewbot:gitSuggest') as Promise<{ message: string; error?: string }>,
  remoteOpen: (payload: { host: string; root: string }) => ipcRenderer.invoke('jewbot:remoteOpen', payload) as Promise<{ host: string; root: string }>,
  editorList: (rel?: string) => ipcRenderer.invoke('jewbot:editorList', rel) as Promise<string[]>,
  editorOpen: (rel: string) =>
    ipcRenderer.invoke('jewbot:editorOpen', rel) as Promise<{
      text: string;
      dirty: boolean;
      origin: 'human' | 'agent';
      active: string | null;
      labels: string[];
    }>,
  editorEdit: (payload: { path: string; text: string }) =>
    ipcRenderer.invoke('jewbot:editorEdit', payload) as Promise<{
      dirty: boolean;
      label: string;
      origin: 'human' | 'agent';
      active: string | null;
      labels: string[];
    }>,
  editorInline: (payload: { path: string; fileText: string; selection: string; prompt: string }) =>
    ipcRenderer.invoke('jewbot:editorInline', payload) as Promise<{
      path: string;
      original: string;
      proposed: string;
      unifiedDiff: string;
      replacement: string;
    }>,
  editorInlineAccept: (proposal: {
    path: string;
    original: string;
    proposed: string;
    unifiedDiff: string;
    replacement: string;
  }) => ipcRenderer.invoke('jewbot:editorInlineAccept', proposal) as Promise<{ ok: boolean; path: string }>,
  editorComplete: (payload: { prefix: string; suffix: string }) =>
    ipcRenderer.invoke('jewbot:editorComplete', payload) as Promise<{ disabled: boolean; ghost: string }>,
  editorSave: (rel: string) =>
    ipcRenderer.invoke('jewbot:editorSave', rel) as Promise<{ kind: 'clean' | 'saved' | 'review'; path: string; preview?: { unifiedDiff: string } }>,
  editorAccept: (rel: string) => ipcRenderer.invoke('jewbot:editorAccept', rel) as Promise<{ ok: boolean; path: string }>,
  modulesList: () =>
    ipcRenderer.invoke('jewbot:modules') as Promise<
      Array<{
        id: string;
        title: string;
        description: string;
        version: string;
        capabilities: string[];
        health: 'ok' | 'down';
        detail?: string;
      }>
    >,
});

export {};
