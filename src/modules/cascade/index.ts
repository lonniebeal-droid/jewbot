/**
 * Cascade runner: when one milestone finishes, start the next without waiting.
 * Inspired by ju-command-center commander loop + receipt statuses.
 */

import { EventEmitter } from 'events';

export type MilestoneStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'blocked'
  | 'needs_confirmation';

export interface Milestone {
  id: string;
  title: string;
  status: MilestoneStatus;
  run: () => Promise<{ status: Exclude<MilestoneStatus, 'pending' | 'running'>; detail?: string }>;
  detail?: string;
}

export class CascadeRunner extends EventEmitter {
  private queue: Milestone[] = [];
  private active = false;
  private stopped = false;

  enqueue(m: Milestone): void {
    this.queue.push({ ...m, status: 'pending' });
    this.emit('enqueued', m.id);
  }

  list(): Milestone[] {
    return [...this.queue];
  }

  stop(): void {
    this.stopped = true;
  }

  /** Run pending milestones in order; auto-advance on done. */
  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.stopped = false;
    try {
      while (!this.stopped) {
        const next = this.queue.find((m) => m.status === 'pending');
        if (!next) break;
        next.status = 'running';
        this.emit('start', next.id);
        const result = await next.run();
        next.status = result.status;
        next.detail = result.detail;
        this.emit('finish', next.id, result.status, result.detail);
        if (result.status !== 'done') {
          // Pause cascade — owner must unblock
          this.emit('paused', next.id, result.status);
          break;
        }
        // Cascade: immediately continue to next pending milestone
      }
    } finally {
      this.active = false;
    }
  }
}

/** Built-in M0 receipt for this scaffold milestone. */
export const M0_MILESTONE: Omit<Milestone, 'run'> = {
  id: 'M0',
  title: 'Architecture + scaffold',
  status: 'done',
  detail: 'ARCHITECTURE.md + Electron/TS stubs committed',
};
