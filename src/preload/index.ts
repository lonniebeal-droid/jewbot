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
