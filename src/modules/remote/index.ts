/**
 * M15 remote workspace. The folder is on an allowlisted host from ~/.jewbot/hosts.json.
 */

import type { JewbotModule } from '../plugin/types';

export { RemoteWorkspace, remoteCommand, remoteCommandGate } from './workspace';
export type { SftpDirEntry, SftpLike } from './workspace';

export function assertAllowlisted(hosts: Array<{ name: string }>, name: string): void {
  if (!hosts.some((host) => host.name === name)) throw new Error(`Host not allowlisted: ${name}`);
}

export const jewbotModule: JewbotModule = {
  id: 'remote',
  title: 'Remote SSH',
  description: 'Open a folder on an allowlisted SSH host over SFTP. Host-key confirm and the destructive grant still apply.',
  version: '0.3.0',
  capabilities: ['ssh', 'files', 'local-only'],
  tools: [
    { name: 'remote_open', description: 'Open a remote folder on a host from ~/.jewbot/hosts.json. Refuses unknown hosts.' },
  ],
  health() {
    return { ok: true, detail: 'sftp workspace idle' };
  },
};
