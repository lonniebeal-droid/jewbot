/**
 * Local JU Music weekly album checklist.
 *
 * The queue is `<store>/.jewbot/music-release.json` (the `.jewbot/` directory
 * is gitignored). This file never calls DistroKid, Spotify, or a payment API.
 * A distributor, login, or payment request is stored as `blocked` with a reason.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { redactSecrets } from '../safety';

export const QUEUE_VERSION = 1;
export const MUSIC_HUMAN_GATE_REASON =
  'Human gate: DistroKid upload, Spotify for Artists, store login, and any payment stay with the owner. This module does not call those services and does not spend.';

const MAX_RELEASES = 200;
const MAX_TITLE = 200;
const MAX_ARTIST = 200;
const MAX_TRACKS = 50;
const MAX_NOTES = 4_000;
const MAX_REASON = 2_000;
const ID_RE = /^rel_[a-f0-9]{32}$/;
const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const STATUSES = ['pending', 'blocked', 'done'] as const;
const STEPS = ['tracks', 'notes', 'ready', 'distribute'] as const;

export type MusicReleaseStatus = (typeof STATUSES)[number];
export type MusicReleaseStep = (typeof STEPS)[number];

export interface MusicTrack {
  title: string;
  /** Set when this track credits someone other than the album artist. */
  artist?: string;
}

export interface MusicRelease {
  id: string;
  title: string;
  artist: string;
  tracks: MusicTrack[];
  status: MusicReleaseStatus;
  /** Free local steps, then `distribute` once a human has to leave this module. */
  step: MusicReleaseStep;
  notes: string;
  /** Why a release is blocked. Absent when it is pending or done. */
  reason?: string;
  /** ISO week, for example 2026-W45. */
  week?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MusicQueueFile {
  version: number;
  releases: MusicRelease[];
}

export interface MusicStoreOptions {
  /** Directory that contains `.jewbot/`. Defaults to the process cwd. */
  storeRoot?: string;
}

export interface MusicReleaseInput {
  title: string;
  artist: string;
  tracks: Array<{ title: string; artist?: string }>;
  notes?: string;
  week?: string;
}

export interface MusicGateFlags {
  intent?: string;
  upload?: boolean;
  pay?: boolean;
  login?: boolean;
  distribute?: boolean;
}

export interface MusicMarkInput extends MusicGateFlags {
  id: string;
  status: MusicReleaseStatus;
  notes?: string;
  reason?: string;
}

const GATE_WORDS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /distrokid/i, label: 'DistroKid' },
  { re: /spotify/i, label: 'Spotify' },
  { re: /apple music|itunes/i, label: 'Apple Music' },
  { re: /soundcloud/i, label: 'SoundCloud' },
  { re: /payment|checkout|purchase|billing|spend/i, label: 'payment' },
  { re: /login|log in|sign in|password|oauth/i, label: 'login' },
  { re: /upload|distribute/i, label: 'distribution' },
];

export function humanGateFromFlags(flags: MusicGateFlags): string | null {
  const intent = (flags.intent || '').trim();
  const forced = flags.upload === true || flags.pay === true || flags.login === true || flags.distribute === true;
  let label = '';
  if (intent) {
    const hit = GATE_WORDS.find((entry) => entry.re.test(intent));
    if (hit) label = hit.label;
    else if (!forced) return null;
  }
  if (!label && flags.pay) label = 'payment';
  else if (!label && flags.login) label = 'login';
  else if (!label && (flags.upload || flags.distribute)) label = 'distribution';
  if (!label) return null;
  return `Human gate: ${label} stays with the owner. DistroKid, Spotify login, and payment are not automated and this module does not spend.`;
}

export function parseMusicQueue(raw: unknown): MusicQueueFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Music release queue must be a JSON object.');
  }
  const body = raw as { version?: unknown; releases?: unknown };
  if (body.version !== QUEUE_VERSION) {
    throw new Error('Music release queue version is not supported.');
  }
  if (!Array.isArray(body.releases)) {
    throw new Error('Music release queue has no releases array.');
  }
  if (body.releases.length > MAX_RELEASES) {
    throw new Error(`Music release queue has more than ${MAX_RELEASES} releases.`);
  }
  return {
    version: QUEUE_VERSION,
    releases: body.releases.map((row, index) => parseRelease(row, index)),
  };
}

export function musicListReleases(options: MusicStoreOptions = {}): MusicRelease[] {
  return loadMusicQueue(rootOf(options)).releases.map(clone);
}

export function addMusicRelease(input: MusicReleaseInput, options: MusicStoreOptions = {}): MusicRelease {
  const root = rootOf(options);
  const queue = loadMusicQueue(root);
  if (queue.releases.length >= MAX_RELEASES) {
    throw new Error(`Music release queue is full (${MAX_RELEASES}).`);
  }
  const now = new Date().toISOString();
  const release: MusicRelease = {
    id: newId(),
    title: cleanLine(input.title, MAX_TITLE, 'title'),
    artist: cleanLine(input.artist, MAX_ARTIST, 'artist'),
    tracks: cleanTracks(input.tracks),
    status: 'pending',
    step: 'tracks',
    notes: cleanNotes(input.notes ?? ''),
    createdAt: now,
    updatedAt: now,
  };
  if (input.week != null && String(input.week).trim()) release.week = cleanWeek(input.week);
  queue.releases.push(release);
  writeQueue(root, queue);
  return clone(release);
}

export function musicMark(input: MusicMarkInput, options: MusicStoreOptions = {}): MusicRelease {
  const gate = humanGateFromFlags(input);
  if (gate) return blockRelease(rootOf(options), input.id, gate, input.notes);
  if (!STATUSES.includes(input.status)) {
    throw new Error('Music release status must be pending, blocked, or done.');
  }
  return mutate(rootOf(options), input.id, (release) => {
    release.status = input.status;
    if (typeof input.notes === 'string') release.notes = cleanNotes(input.notes);
    if (input.status === 'done') {
      release.step = 'distribute';
      delete release.reason;
    } else if (input.status === 'pending') {
      delete release.reason;
      if (release.step === 'distribute') release.step = 'ready';
    } else {
      release.reason = cleanReason(input.reason || 'Blocked by owner.');
    }
    return release;
  });
}

export function blockRelease(storeRoot: string, id: string, reason: string, notes?: string): MusicRelease {
  return mutate(storeRoot, id, (release) => {
    release.status = 'blocked';
    release.step = 'distribute';
    release.reason = cleanReason(reason);
    if (typeof notes === 'string') release.notes = cleanNotes(notes);
    return release;
  });
}

export function patchRelease(
  storeRoot: string,
  id: string,
  change: (release: MusicRelease) => void,
): MusicRelease {
  return mutate(storeRoot, id, (release) => {
    change(release);
    return release;
  });
}

export function loadMusicQueue(storeRoot: string): MusicQueueFile {
  const root = path.resolve(storeRoot);
  const file = queuePath(root);
  if (!fs.existsSync(file)) return { version: QUEUE_VERSION, releases: [] };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`Music release queue could not be read. It was left untouched. ${messageOf(err)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Music release queue is not valid JSON. It was left untouched.');
  }
  try {
    return parseMusicQueue(raw);
  } catch (err) {
    const detail = messageOf(err);
    if (detail.includes('left untouched')) throw err instanceof Error ? err : new Error(detail);
    throw new Error(`${detail} It was left untouched.`);
  }
}

function mutate(storeRoot: string, id: string, change: (release: MusicRelease) => MusicRelease): MusicRelease {
  const root = path.resolve(storeRoot);
  const queue = loadMusicQueue(root);
  const index = queue.releases.findIndex((row) => row.id === id);
  if (index < 0) throw new Error(`Music release ${id} was not found.`);
  const next = change(clone(queue.releases[index]));
  next.updatedAt = new Date().toISOString();
  next.notes = redactSecrets(next.notes);
  if (next.reason) next.reason = redactSecrets(next.reason);
  else delete next.reason;
  queue.releases[index] = next;
  writeQueue(root, queue);
  return clone(next);
}

function writeQueue(storeRoot: string, queue: MusicQueueFile): void {
  const file = queuePath(storeRoot);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const body = JSON.stringify({ version: QUEUE_VERSION, releases: queue.releases }, null, 2) + '\n';
  const tmp = path.join(dir, `.music-release.${process.pid}.tmp`);
  fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function queuePath(storeRoot: string): string {
  const root = realRoot(storeRoot);
  const file = materializeInsideSync(root, path.resolve(root, '.jewbot', 'music-release.json'));
  if (file !== root && !file.startsWith(root + path.sep)) {
    throw new Error('Music release queue path escapes the store root.');
  }
  return file;
}

/** Resolve the store root through symlinks, like FileWorkspace.resolveInside. */
function realRoot(storeRoot: string): string {
  const root = path.resolve(storeRoot);
  try {
    return fs.realpathSync(root);
  } catch {
    return root;
  }
}

/**
 * Sync edition of the FileWorkspace ancestor walk: resolve the nearest
 * existing ancestor of `abs` through symlinks, then re-append the missing
 * parts. A `.jewbot` directory (or the queue file itself) that is a symlink
 * outside the store root resolves outside it, and queuePath rejects it.
 */
function materializeInsideSync(rootReal: string, abs: string): string {
  const rootPrefix = rootReal + path.sep;
  if (abs !== rootReal && !abs.startsWith(rootPrefix)) {
    throw new Error(`Music release queue path escapes the store root: ${abs}`);
  }
  const missing: string[] = [];
  let probe = abs;
  while (probe !== rootReal && probe.startsWith(rootPrefix)) {
    try {
      const real = fs.realpathSync(probe);
      return missing.reverse().reduce((acc, part) => path.join(acc, part), real);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      missing.push(path.basename(probe));
      probe = path.dirname(probe);
    }
  }
  return abs;
}

function rootOf(options: MusicStoreOptions): string {
  return path.resolve(options.storeRoot || process.cwd());
}

function parseRelease(raw: unknown, index: number): MusicRelease {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Music release at index ${index} is not an object.`);
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !ID_RE.test(row.id)) {
    throw new Error(`Music release at index ${index} has an invalid id.`);
  }
  if (typeof row.status !== 'string' || !STATUSES.includes(row.status as MusicReleaseStatus)) {
    throw new Error(`Music release ${row.id} has an invalid status.`);
  }
  if (typeof row.step !== 'string' || !STEPS.includes(row.step as MusicReleaseStep)) {
    throw new Error(`Music release ${row.id} has an invalid step.`);
  }
  if (typeof row.notes !== 'string') throw new Error(`Music release ${row.id} needs notes.`);
  if (typeof row.createdAt !== 'string' || !row.createdAt.trim()) {
    throw new Error(`Music release ${row.id} needs createdAt.`);
  }
  if (typeof row.updatedAt !== 'string' || !row.updatedAt.trim()) {
    throw new Error(`Music release ${row.id} needs updatedAt.`);
  }
  const release: MusicRelease = {
    id: row.id,
    title: cleanLine(row.title, MAX_TITLE, 'title'),
    artist: cleanLine(row.artist, MAX_ARTIST, 'artist'),
    tracks: cleanTracks(row.tracks),
    status: row.status as MusicReleaseStatus,
    step: row.step as MusicReleaseStep,
    notes: cleanNotes(row.notes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.week != null && String(row.week).trim()) release.week = cleanWeek(row.week);
  if (typeof row.reason === 'string' && row.reason.trim()) release.reason = cleanReason(row.reason);
  return release;
}

function cleanTracks(value: unknown): MusicTrack[] {
  if (!Array.isArray(value)) throw new Error('Music release tracks must be an array.');
  if (value.length > MAX_TRACKS) throw new Error(`Music release tracks are limited to ${MAX_TRACKS}.`);
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Music track ${index + 1} is not an object.`);
    }
    const row = item as { title?: unknown; artist?: unknown };
    const track: MusicTrack = { title: cleanLine(row.title, MAX_TITLE, `track ${index + 1} title`) };
    if (typeof row.artist === 'string' && row.artist.trim()) {
      track.artist = cleanLine(row.artist, MAX_ARTIST, `track ${index + 1} artist`);
    }
    return track;
  });
}

function cleanLine(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw new Error(`Music release ${label} is required.`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error(`Music release ${label} is required.`);
  if (text.length > max) throw new Error(`Music release ${label} is too long.`);
  return text;
}

function cleanNotes(value: string): string {
  const text = value.trim();
  if (text.length > MAX_NOTES) throw new Error('Music release notes are too long.');
  return text;
}

function cleanReason(value: string): string {
  const text = value.trim();
  if (!text) throw new Error('Music release block reason is required.');
  if (text.length > MAX_REASON) throw new Error('Music release block reason is too long.');
  return text;
}

function cleanWeek(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Music release week must look like 2026-W45.');
  const week = value.trim();
  if (!WEEK_RE.test(week)) throw new Error('Music release week must look like 2026-W45.');
  return week;
}

function newId(): string {
  return `rel_${randomUUID().replace(/-/g, '')}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
