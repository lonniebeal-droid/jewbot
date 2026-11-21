/**
 * Adapt an ssh2 SFTP handle to RemoteWorkspace. Host-key checks happen in connect().
 */

import type { SshClientLike } from '../ssh/transport';
import type { SftpRaw } from '../ssh/transport';
import { RemoteWorkspace, type SftpLike } from './workspace';

const S_IFDIR = 0o040000;

export async function workspaceFromClient(host: string, root: string, client: SshClientLike): Promise<RemoteWorkspace> {
  if (typeof client.sftp !== 'function') throw new Error('This SSH session does not provide SFTP.');
  const raw = await new Promise<SftpRaw>((resolve, reject) => {
    client.sftp!((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
  return new RemoteWorkspace(host, root, adaptSftp(raw));
}

export function adaptSftp(raw: SftpRaw): SftpLike {
  return {
    readdir(abs) {
      return new Promise((resolve, reject) => {
        raw.readdir(abs, (err, list) => {
          if (err) reject(err);
          else {
            resolve(
              (list || []).map((entry) => ({
                filename: entry.filename,
                isDirectory: ((entry.attrs?.mode || 0) & S_IFDIR) === S_IFDIR || entry.longname.startsWith('d'),
                size: entry.attrs?.size || 0,
              })),
            );
          }
        });
      });
    },
    readFile(abs) {
      return new Promise((resolve, reject) => {
        raw.readFile(abs, (err, data) => (err || !data ? reject(err || new Error(`no such file: ${abs}`)) : resolve(data)));
      });
    },
    writeFile(abs, data) {
      return new Promise((resolve, reject) => {
        raw.writeFile(abs, data, (err) => (err ? reject(err) : resolve()));
      });
    },
    stat(abs) {
      return new Promise((resolve) => {
        raw.stat(abs, (err, stats) => {
          if (err || !stats) resolve(null);
          else resolve({ isDirectory: stats.isDirectory(), size: stats.size });
        });
      });
    },
  };
}
