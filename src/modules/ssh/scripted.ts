/**
 * In-memory ssh2 stand-in for tests and the UI smoke. It never opens a socket.
 * Production connects through ssh2ClientFactory unless a caller injects this.
 */

import { EventEmitter } from 'events';
import type { SshClientFactory, SshClientLike, SshConnectConfig, SshExecStream } from './transport';

export interface ScriptedChunk {
  stream: 'stdout' | 'stderr';
  text: string;
  delayMs?: number;
}

export interface ScriptedExec {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  chunks?: ScriptedChunk[];
  hang?: boolean;
}

export interface ScriptedSshOptions {
  hostKey: Buffer;
  failAuth?: boolean;
  onConnect?: (config: SshConnectConfig) => void;
  onExec?: (command: string, config: SshConnectConfig) => ScriptedExec | undefined;
  onEnd?: () => void;
}

class ScriptedStream extends EventEmitter implements SshExecStream {
  stderr = new EventEmitter();
  private closed = false;

  constructor(private behavior: ScriptedExec) {
    super();
  }

  begin(): void {
    if (this.behavior.hang) return;
    const chunks: ScriptedChunk[] = this.behavior.chunks ?? [
      ...(this.behavior.stdout ? [{ stream: 'stdout' as const, text: this.behavior.stdout, delayMs: 0 }] : []),
      ...(this.behavior.stderr ? [{ stream: 'stderr' as const, text: this.behavior.stderr, delayMs: 0 }] : []),
    ];
    let at = 0;
    for (const chunk of chunks) {
      at += chunk.delayMs ?? 0;
      const wait = at;
      setTimeout(() => {
        if (this.closed) return;
        const buf = Buffer.from(chunk.text);
        if (chunk.stream === 'stderr') this.stderr.emit('data', buf);
        else this.emit('data', buf);
      }, wait);
    }
    setTimeout(() => this.finish(this.behavior.exitCode ?? 0), at + 5);
  }

  signal(_signalName?: string): void {
    this.finish(null);
  }

  close(): void {
    this.finish(null);
  }

  private finish(code: number | null): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('exit', code);
    this.emit('close', code);
  }
}

class ScriptedClient extends EventEmitter implements SshClientLike {
  private config: SshConnectConfig | null = null;

  constructor(private script: ScriptedSshOptions) {
    super();
  }

  connect(config: SshConnectConfig): void {
    this.config = config;
    setTimeout(() => {
      void this.handshake(config);
    }, 0);
  }

  exec(
    command: string,
    _options: Record<string, unknown>,
    callback: (err: Error | undefined, stream: SshExecStream) => void,
  ): void {
    const config = this.config;
    if (!config) {
      callback(new Error('SSH exec before connect'), undefined as unknown as SshExecStream);
      return;
    }
    const behavior = this.script.onExec?.(command, config) ?? { stdout: '', exitCode: 0 };
    const stream = new ScriptedStream(behavior);
    callback(undefined, stream);
    setTimeout(() => stream.begin(), 0);
  }

  end(): void {
    this.script.onEnd?.();
    this.emit('close');
  }

  destroy(): void {
    this.end();
  }

  private async handshake(config: SshConnectConfig): Promise<void> {
    try {
      const verifier = config.hostVerifier;
      if (verifier) {
        const accepted = await new Promise<boolean>((resolve) => {
          let settled = false;
          const done = (ok: boolean) => {
            if (settled) return;
            settled = true;
            resolve(ok === true);
          };
          verifier(this.script.hostKey, done);
        });
        if (!accepted) {
          this.emit('error', new Error('Host denied (verification failed)'));
          return;
        }
      }
      this.script.onConnect?.(config);
      if (this.script.failAuth) {
        this.emit('error', new Error('All configured authentication methods failed'));
        return;
      }
      this.emit('ready');
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error('SSH handshake failed'));
    }
  }
}

export function createScriptedClientFactory(script: ScriptedSshOptions): SshClientFactory {
  return () => new ScriptedClient(script);
}
