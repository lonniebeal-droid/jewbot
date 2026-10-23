import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('jewbot', {
  status: () => ipcRenderer.invoke('jewbot:status'),
  agentRun: (goal: string) => ipcRenderer.invoke('jewbot:agentRun', goal),
  terminalRun: (command: string, approved?: boolean, executionId?: string) =>
    ipcRenderer.invoke('jewbot:terminalRun', command, approved, executionId),
  contextSummary: () => ipcRenderer.invoke('jewbot:contextSummary'),
});

export {};
