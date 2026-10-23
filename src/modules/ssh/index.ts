/**
 * SSH session manager — connect, run commands, manage sessions.
 * Patterns from ju-command-center fleet probe: timeouts, allowlists, no embedded creds.
 */

import { EventEmitter } from 'events';
import { checkShellCommand } from '../safety';

export interface SshHostConfig {
  name: string;
  host: string;
  port?: number;
  username: string;
  /** Path to private key; never commit the key itself. */
  privateKeyPath?: string;
  /** Use ssh-agent if true. */
  agent?: boolean;
}

export interface SshExecResult {
  host: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  status: 'EXECUTED' | 'FAILED' | 'BLOCKED' | 'TIMED_OUT';
}

type ClientFactory = () => Promise<{
  exec: (command: string, timeoutMs: number) => Promise<SshExecResult>;
  end: () => void;
}>;

/**
 * Stub session manager. Real ssh2 wiring lands in M5.
 * Keeps API stable so cascade/agent can call it now.
 */
export class SshManager extends EventEmitter {
  private hosts = new Map<string, SshHostConfig>();
  private sessions = new Map<string, { end: () => void }>();

  registerHost(cfg: SshHostConfig): void {
    this.hosts.set(cfg.name, cfg);
  }

  listHosts(): SshHostConfig[] {
    return [...this.hosts.values()];
  }

  async connect(name: string): Promise<void> {
    const cfg = this.hosts.get(name);
    if (!cfg) throw new Error(`Unknown SSH host: ${name}`);
    // M5: open ssh2 Client with privateKey / agent, BatchMode semantics.
    this.sessions.set(name, {
      end: () => {
        this.sessions.delete(name);
        this.emit('disconnected', name);
      },
    });
    this.emit('connected', name);
  }

  async disconnect(name: string): Promise<void> {
    this.sessions.get(name)?.end();
  }

  async exec(
    name: string,
    command: string,
    opts: { timeoutMs?: number; approved?: boolean; executionId?: string } = {},
  ): Promise<SshExecResult> {
    const decision = checkShellCommand(command, {
      approved: opts.approved,
      executionId: opts.executionId,
      requireApproval: false,
    });
    if (!decision.ok) {
      return {
        host: name,
        exitCode: null,
        stdout: '',
        stderr: decision.reason,
        status: 'BLOCKED',
      };
    }
    if (!this.sessions.has(name)) {
      return {
        host: name,
        exitCode: null,
        stdout: '',
        stderr: 'Not connected — call connect() first (M5 implements transport)',
        status: 'BLOCKED',
      };
    }
    // Placeholder until ssh2 transport is wired
    return {
      host: name,
      exitCode: null,
      stdout: '',
      stderr: 'SSH transport stub (M5) — host registered and session marked connected',
      status: 'BLOCKED',
    };
  }
}

export const defaultSshManager = new SshManager();

/** Allowlist helper mirroring ju_fleet_remote_probe style. */
export function assertAllowlistedHost(name: string, allow: string[]): void {
  if (!allow.includes(name)) throw new Error(`Host not allowlisted: ${name}`);
}

// Keep type importable for tests without requiring ssh2 at compile time of stubs
export type { ClientFactory };
