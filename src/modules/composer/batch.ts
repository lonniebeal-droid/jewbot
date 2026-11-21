/**
 * One review for many agent edits. Accept or reject a file or a hunk.
 * Apply writes the accepted text. Undo restores every file from that apply.
 */

import { structuredPatch } from 'diff';
import type { FileWorkspace } from '../files';

export type HunkDecision = 'pending' | 'accept' | 'reject';

export interface ComposerHunk {
  id: string;
  path: string;
  search: string;
  replace: string;
  decision: HunkDecision;
}

export interface ComposerFile {
  path: string;
  original: string;
  hunks: ComposerHunk[];
}

interface UndoSnap {
  path: string;
  previous: string;
}

export class ComposerBatch {
  readonly files: ComposerFile[] = [];
  private undoSnaps: UndoSnap[] | null = null;
  private seq = 0;

  addFile(filePath: string, original: string, proposed: string): ComposerFile {
    const path = filePath.trim().replace(/\\/g, '/');
    const patch = structuredPatch(path, path, original, proposed, '', '', { context: 0 });
    const hunks: ComposerHunk[] = patch.hunks.map((hunk) => {
      this.seq += 1;
      const search = hunk.lines.filter((line) => !line.startsWith('+')).map((line) => line.slice(1)).join('\n');
      const replace = hunk.lines.filter((line) => !line.startsWith('-')).map((line) => line.slice(1)).join('\n');
      return { id: `hunk_${this.seq}`, path, search, replace, decision: 'pending' };
    });
    const file: ComposerFile = { path, original, hunks };
    this.files.push(file);
    return file;
  }

  acceptFile(filePath: string): void {
    this.setFile(filePath, 'accept');
  }

  rejectFile(filePath: string): void {
    this.setFile(filePath, 'reject');
  }

  acceptHunk(id: string): void {
    this.hunk(id).decision = 'accept';
  }

  rejectHunk(id: string): void {
    this.hunk(id).decision = 'reject';
  }

  composed(filePath: string): string {
    const file = this.file(filePath);
    let text = file.original;
    for (const hunk of file.hunks) {
      if (hunk.decision !== 'accept') continue;
      const at = text.indexOf(hunk.search);
      if (at < 0) throw new Error(`Hunk ${hunk.id} no longer matches ${file.path}`);
      text = text.slice(0, at) + hunk.replace + text.slice(at + hunk.search.length);
    }
    return text;
  }

  async apply(files: FileWorkspace): Promise<{ written: string[] }> {
    const snaps: UndoSnap[] = [];
    const written: string[] = [];
    for (const file of this.files) {
      if (!file.hunks.some((hunk) => hunk.decision === 'accept')) continue;
      const next = this.composed(file.path);
      const preview = await files.proposeEdit(file.path, next);
      if (!preview.unchanged) await files.applyEdit(preview, true);
      snaps.push({ path: file.path, previous: file.original });
      written.push(file.path);
      file.original = next;
      for (const hunk of file.hunks) {
        if (hunk.decision === 'accept') hunk.decision = 'reject';
      }
    }
    this.undoSnaps = snaps;
    return { written };
  }

  /** One undo puts every file from the last apply back. */
  async undo(files: FileWorkspace): Promise<{ restored: string[] }> {
    if (!this.undoSnaps) throw new Error('Nothing to undo');
    const restored: string[] = [];
    for (const snap of this.undoSnaps) {
      const preview = await files.proposeEdit(snap.path, snap.previous);
      if (!preview.unchanged) await files.applyEdit(preview, true);
      const file = this.file(snap.path);
      file.original = snap.previous;
      restored.push(snap.path);
    }
    this.undoSnaps = null;
    return { restored };
  }

  private setFile(filePath: string, decision: HunkDecision): void {
    for (const hunk of this.file(filePath).hunks) hunk.decision = decision;
  }

  private file(filePath: string): ComposerFile {
    const path = filePath.trim().replace(/\\/g, '/');
    const file = this.files.find((row) => row.path === path);
    if (!file) throw new Error(`Composer has no file ${path}`);
    return file;
  }

  private hunk(id: string): ComposerHunk {
    for (const file of this.files) {
      const hunk = file.hunks.find((row) => row.id === id);
      if (hunk) return hunk;
    }
    throw new Error(`Unknown hunk ${id}`);
  }
}
