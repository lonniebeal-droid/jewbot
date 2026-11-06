/**
 * Music Release Engine for the JU Music weekly album pipeline.
 *
 * Checklist state lives in `.jewbot/music-release.json`. Free steps are local.
 * DistroKid, store login, and payment are a human gate. Optional notes are
 * drafted with local Ollama (`assertLocalSpendOnly` + `chatOnce`).
 */

import type { OllamaConfig } from '../llm/ollama';
import { pingLocalOllama } from '../plugin/health';
import type { JewbotModule } from '../plugin/types';
import { draftReleaseNotes } from './draft';
import {
  blockRelease,
  humanGateFromFlags,
  loadMusicQueue,
  MUSIC_HUMAN_GATE_REASON,
  musicListReleases,
  musicMark,
  patchRelease,
  type MusicGateFlags,
  type MusicMarkInput,
  type MusicRelease,
  type MusicStoreOptions,
} from './queue';

export type {
  MusicGateFlags,
  MusicMarkInput,
  MusicQueueFile,
  MusicRelease,
  MusicReleaseInput,
  MusicReleaseStatus,
  MusicReleaseStep,
  MusicStoreOptions,
  MusicTrack,
} from './queue';
export {
  addMusicRelease,
  humanGateFromFlags,
  loadMusicQueue,
  MUSIC_HUMAN_GATE_REASON,
  musicListReleases,
  musicMark,
  parseMusicQueue,
  QUEUE_VERSION,
} from './queue';
export { assertMusicDraftLocal, draftPrompt, draftReleaseNotes, resolveMusicDraftConfig } from './draft';

export interface MusicNextFreeOptions extends MusicStoreOptions, MusicGateFlags {
  /** When true, empty notes are drafted on local Ollama. Default is off. */
  draft?: boolean;
  config?: Partial<OllamaConfig>;
}

export interface MusicNextFreeResult {
  module: 'music-release';
  spend: 'local-only';
  release: MusicRelease | null;
  action: 'none' | 'advanced' | 'drafted' | 'blocked' | 'waiting';
  detail: string;
  humanGate: boolean;
}

export interface MusicToolOptions extends MusicStoreOptions {
  config?: Partial<OllamaConfig>;
}

export const jewbotModule: JewbotModule = {
  id: 'music-release',
  title: 'Music Release Engine',
  description:
    'Local checklist for the JU Music weekly album pipeline. Drafts notes on local Ollama. DistroKid, Spotify login, and payment stay a human gate.',
  version: '0.2.0',
  capabilities: ['checklist', 'chat', 'local-only', 'release'],
  tools: [
    {
      name: 'music_list_releases',
      description: 'Read the local weekly album checklist (.jewbot/music-release.json). No distributor call.',
    },
    {
      name: 'music_next_free',
      description:
        'Advance one free local step (tracks, then notes). DistroKid, login, and payment are marked blocked and are not automated.',
    },
    {
      name: 'music_mark',
      description:
        'Set a release to pending, blocked, or done in the local file. Marking done records the owner’s own gate. It does not upload or pay.',
    },
  ],
  health: pingLocalOllama,
};

export async function musicNextFree(options: MusicNextFreeOptions = {}): Promise<MusicNextFreeResult> {
  const storeRoot = options.storeRoot;
  const gate = humanGateFromFlags(options);
  if (gate) return blockHead(storeRoot, gate);

  const queue = loadMusicQueue(storeRoot || process.cwd());
  const current = queue.releases.find((row) => row.status === 'pending') || null;
  if (!current) {
    return result(null, 'none', 'No pending release is on the local checklist.', false);
  }
  if (current.step === 'tracks') {
    if (!current.artist.trim() || current.tracks.length === 0) {
      return result(
        current,
        'waiting',
        'Add at least one track title and an artist on the local checklist before this release can move on.',
        false,
      );
    }
    const release = patchRelease(storeRoot || process.cwd(), current.id, (row) => {
      row.step = 'notes';
    });
    return result(release, 'advanced', 'Track list and artist are on the local checklist. Next free step is release notes.', false);
  }
  if (current.step === 'notes') {
    if (current.notes.trim()) {
      const release = patchRelease(storeRoot || process.cwd(), current.id, (row) => {
        row.step = 'ready';
      });
      return result(release, 'advanced', 'Release notes are already on the local checklist.', false);
    }
    if (options.draft !== true) {
      return result(
        current,
        'waiting',
        'Notes are empty. Write them in the local file, or call music_next_free with draft:true for a local Ollama draft. No distributor is contacted.',
        false,
      );
    }
    try {
      const notes = await draftReleaseNotes(current, options.config);
      const release = patchRelease(storeRoot || process.cwd(), current.id, (row) => {
        row.notes = notes;
        row.step = 'ready';
      });
      return result(
        release,
        'drafted',
        'Drafted release notes on local Ollama. The text is notes only. Status stays pending.',
        false,
      );
    } catch (err) {
      return result(current, 'waiting', err instanceof Error ? err.message : String(err), false);
    }
  }
  const release = blockRelease(storeRoot || process.cwd(), current.id, MUSIC_HUMAN_GATE_REASON);
  return result(release, 'blocked', MUSIC_HUMAN_GATE_REASON, true);
}

export async function runMusicTool(
  name: string,
  args: Record<string, unknown> = {},
  options: MusicToolOptions = {},
): Promise<MusicNextFreeResult | MusicRelease | { releases: MusicRelease[] }> {
  if (name === 'music_list_releases') {
    return { releases: musicListReleases({ storeRoot: options.storeRoot }) };
  }
  if (name === 'music_next_free') {
    return musicNextFree({
      storeRoot: options.storeRoot,
      draft: args.draft === true,
      config: options.config,
      ...flagsFrom(args),
    });
  }
  if (name === 'music_mark') {
    const status = args.status;
    if (status !== 'pending' && status !== 'blocked' && status !== 'done') {
      throw new Error('Music release status must be pending, blocked, or done.');
    }
    const input: MusicMarkInput = {
      id: typeof args.id === 'string' ? args.id : '',
      status,
      ...flagsFrom(args),
    };
    if (typeof args.notes === 'string') input.notes = args.notes;
    if (typeof args.reason === 'string') input.reason = args.reason;
    return musicMark(input, { storeRoot: options.storeRoot });
  }
  throw new Error(
    `Unknown music tool: ${name}. Live tools: music_list_releases, music_next_free, music_mark.`,
  );
}

async function blockHead(storeRoot: string | undefined, gate: string): Promise<MusicNextFreeResult> {
  const root = storeRoot || process.cwd();
  const pending = loadMusicQueue(root).releases.find((row) => row.status === 'pending') || null;
  if (!pending) return result(null, 'blocked', gate, true);
  const release = blockRelease(root, pending.id, gate);
  return result(release, 'blocked', gate, true);
}

function flagsFrom(args: Record<string, unknown>): MusicGateFlags {
  return {
    intent: typeof args.intent === 'string' ? args.intent : undefined,
    upload: args.upload === true,
    pay: args.pay === true,
    login: args.login === true,
    distribute: args.distribute === true,
  };
}

function result(
  release: MusicRelease | null,
  action: MusicNextFreeResult['action'],
  detail: string,
  humanGate: boolean,
): MusicNextFreeResult {
  return {
    module: 'music-release',
    spend: 'local-only',
    release,
    action,
    detail,
    humanGate,
  };
}
