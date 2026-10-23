export {};
declare global {
  interface Window {
    jewbot: {
      status: () => Promise<unknown>;
      agentRun: (goal: string) => Promise<unknown>;
      terminalRun: (command: string, approved?: boolean, executionId?: string) => Promise<unknown>;
      contextSummary: () => Promise<unknown>;
    };
  }
}
