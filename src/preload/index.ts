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
});

export {};
