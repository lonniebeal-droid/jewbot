/**
 * File read/write with unified diff preview. Path-jailed to project root.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createTwoFilesPatch } from 'diff';
import { assertInsideProject } from '../safety';

export interface DiffPreview {
  filePath: string;
  original: string;
  proposed: string;
  unifiedDiff: string;
}

export class FileWorkspace {
  constructor(public readonly projectRoot: string) {}

  private resolve(rel: string): string {
    const decision = assertInsideProject(this.projectRoot, rel);
    if (!decision.ok) throw new Error(decision.reason);
    return path.resolve(this.projectRoot, rel);
  }

  async read(rel: string): Promise<string> {
    return fs.readFile(this.resolve(rel), 'utf8');
  }

  async proposeEdit(rel: string, proposed: string): Promise<DiffPreview> {
    const abs = this.resolve(rel);
    let original = '';
    try {
      original = await fs.readFile(abs, 'utf8');
    } catch {
      original = '';
    }
    const unifiedDiff = createTwoFilesPatch(rel, rel, original, proposed, 'a', 'b');
    return { filePath: rel, original, proposed, unifiedDiff };
  }

  async applyEdit(preview: DiffPreview, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new Error('Apply requires confirmation');
    const abs = this.resolve(preview.filePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, preview.proposed, 'utf8');
  }

  async listDir(rel = '.'): Promise<string[]> {
    const abs = this.resolve(rel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    return entries.map((e) => (e.isDirectory() ? e.name + '/' : e.name));
  }
}
