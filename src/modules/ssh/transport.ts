/**
 * Narrow ssh2 surface Jewbot actually calls. Tests substitute a scripted client.
 * The real factory returns an ssh2 Client and does not connect by itself.
 */

import { Client } from 'ssh2';

export interface SshExecStream {
  on(event: 'data', listener: (data: Buffer | string) => void): this;
  on(event: 'close', listener: (code?: number | null, signal?: string) => void): this;
  on(event: 'exit', listener: (code: number | null, signal?: string) => void): this;
  stderr: {
    on(event: 'data', listener: (data: Buffer | string) => void): void;
  };
  close(): void;
  signal?(signalName?: string): void;
}

export interface SshConnectConfig {
  host: string;
  port: number;
  username: string;
  readyTimeout: number;
  keepaliveInterval?: number;
  tryKeyboard?: boolean;
  authHandler?: Array<'publickey' | 'password' | 'agent'>;
  privateKey?: Buffer;
  passphrase?: string;
  password?: string;
  agent?: string;
  hostVerifier?: (key: Buffer, verify: (accepted: boolean) => void) => void;
}

export interface SshClientLike {
  connect(config: SshConnectConfig): void;
  exec(
    command: string,
    options: Record<string, unknown>,
    callback: (err: Error | undefined, stream: SshExecStream) => void,
  ): void;
  on(event: 'ready', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: () => void): this;
  end(): void;
  destroy(): void;
}

export type SshClientFactory = () => SshClientLike;

/** Build a real ssh2 client. Calling this does not open a socket; connect() does. */
export function ssh2ClientFactory(): SshClientLike {
  return new Client() as unknown as SshClientLike;
}

export function isRealSsh2Client(client: SshClientLike): boolean {
  return client instanceof Client;
}
