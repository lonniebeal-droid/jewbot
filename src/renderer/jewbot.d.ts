export {};

interface StreamEvent {
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

declare global {
  interface Window {
    jewbot: {
      status: () => Promise<{
        milestone?: string;
        projectRoot?: string;
        ollama?: { host?: string; model?: string };
        ollamaOk?: boolean;
        ollamaError?: string | null;
        models?: string[];
        spendGate?: string;
        allowPaidApis?: boolean;
      }>;
      agentRun: (goal: string) => Promise<unknown>;
      startAgent: (payload: { requestId: string; goal: string }) => void;
      startChat: (payload: {
        requestId: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      }) => void;
      cancelStream: (requestId: string) => void;
      onStreamEvent: (cb: (ev: StreamEvent) => void) => () => void;
      pickProjectRoot: () => Promise<{ canceled: boolean; projectRoot: string }>;
      terminalRun: (command: string, approved?: boolean, executionId?: string) => Promise<unknown>;
      contextSummary: () => Promise<unknown>;
    };
  }
}
