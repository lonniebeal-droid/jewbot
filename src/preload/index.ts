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
  terminalRun: (command: string, approved?: boolean, executionId?: string) =>
    ipcRenderer.invoke('jewbot:terminalRun', command, approved, executionId),
  contextSummary: () => ipcRenderer.invoke('jewbot:contextSummary'),
});

export {};
