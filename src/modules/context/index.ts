/**
 * Project-aware context: repo structure respecting .gitignore.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import ignore from 'ignore';

export interface ContextSummary {
  root: string;
  files: string[];
  truncated: boolean;
}

const ALWAYS_IGNORE = ['node_modules/', 'dist/', '.git/', '.jewbot/', '*.gguf', '.env', '.env.*'];

export class ContextIndexer {
  constructor(public readonly projectRoot: string) {}

  private async loadIgnore(): Promise<ReturnType<typeof ignore>> {
    const ig = ignore().add(ALWAYS_IGNORE);
    try {
      const raw = await fs.readFile(path.join(this.projectRoot, '.gitignore'), 'utf8');
      ig.add(raw);
    } catch {
      // no .gitignore
    }
    return ig;
  }

  async summarize(maxFiles = 400): Promise<ContextSummary> {
    const ig = await this.loadIgnore();
    const files: string[] = [];
    let truncated = false;

    const walk = async (dir: string, relBase: string) => {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
        const testPath = ent.isDirectory() ? rel + '/' : rel;
        if (ig.ignores(testPath) || ig.ignores(rel)) continue;
        if (ent.isDirectory()) await walk(path.join(dir, ent.name), rel);
        else files.push(rel);
      }
    };

    await walk(this.projectRoot, '');
    return { root: this.projectRoot, files, truncated };
  }

  formatForPrompt(summary: ContextSummary): string {
    const head = summary.files.slice(0, 200).join('\n');
    const more = summary.truncated || summary.files.length > 200 ? '\n… (truncated)' : '';
    return `Project root: ${summary.root}\nFiles:\n${head}${more}`;
  }
}
