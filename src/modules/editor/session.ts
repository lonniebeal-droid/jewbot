/**
 * Editor tabs for the Monaco pane.
 *
 * Human typing saves straight to the project jail. Agent text stays a preview
 * until the owner Accepts, using the same FileWorkspace diff path as M3.
 */

import type { DiffPreview, FileWorkspace } from '../files';

export type BufferOrigin = 'human' | 'agent';

export interface EditorTab {
  path: string;
  savedText: string;
  text: string;
  origin: BufferOrigin;
  dirty: boolean;
}

export type SaveOutcome =
  | { kind: 'clean'; path: string }
  | { kind: 'saved'; path: string }
  | { kind: 'review'; path: string; preview: DiffPreview };

export function tabLabel(tab: EditorTab): string {
  return tab.dirty ? `${tab.path} •` : tab.path;
}

export class EditorSession {
  readonly tabs: EditorTab[] = [];
  active: string | null = null;

  open(path: string, text: string): EditorTab {
    const key = normalizePath(path);
    const existing = this.tabs.find((tab) => tab.path === key);
    if (existing) {
      this.active = key;
      return existing;
    }
    const tab: EditorTab = { path: key, savedText: text, text, origin: 'human', dirty: false };
    this.tabs.push(tab);
    this.active = key;
    return tab;
  }

  focus(path: string): EditorTab {
    const tab = this.require(path);
    this.active = tab.path;
    return tab;
  }

  close(path: string): void {
    const key = normalizePath(path);
    const index = this.tabs.findIndex((tab) => tab.path === key);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    if (this.active === key) this.active = this.tabs[0]?.path ?? null;
  }

  /** Keystrokes from the person at the keyboard. A later save writes directly. */
  editHuman(path: string, text: string): EditorTab {
    const tab = this.require(path);
    tab.text = text;
    tab.origin = 'human';
    tab.dirty = text !== tab.savedText;
    return tab;
  }

  /** Model proposal. Save does not write until the owner Accepts the diff. */
  proposeAgent(path: string, text: string): EditorTab {
    const key = normalizePath(path);
    let tab = this.tabs.find((row) => row.path === key);
    if (!tab) {
      tab = { path: key, savedText: '', text, origin: 'agent', dirty: true };
      this.tabs.push(tab);
    } else {
      tab.text = text;
      tab.origin = 'agent';
      tab.dirty = text !== tab.savedText;
    }
    this.active = key;
    return tab;
  }

  async save(path: string, files: FileWorkspace): Promise<SaveOutcome> {
    const tab = this.require(path);
    if (!tab.dirty) return { kind: 'clean', path: tab.path };
    if (tab.origin === 'agent') {
      const preview = await files.proposeEdit(tab.path, tab.text);
      return { kind: 'review', path: tab.path, preview };
    }
    const preview = await files.proposeEdit(tab.path, tab.text);
    if (!preview.unchanged) await files.applyEdit(preview, true);
    tab.savedText = tab.text;
    tab.dirty = false;
    tab.origin = 'human';
    return { kind: 'saved', path: tab.path };
  }

  /** Owner pressed Accept on an agent diff. Writes, then the tab matches disk. */
  async acceptAgent(path: string, files: FileWorkspace): Promise<EditorTab> {
    const tab = this.require(path);
    if (tab.origin !== 'agent') throw new Error('This tab is not waiting on an agent diff.');
    const preview = await files.proposeEdit(tab.path, tab.text);
    if (!preview.unchanged) await files.applyEdit(preview, true);
    tab.savedText = tab.text;
    tab.dirty = false;
    tab.origin = 'human';
    return tab;
  }

  labels(): string[] {
    return this.tabs.map(tabLabel);
  }

  private require(path: string): EditorTab {
    const key = normalizePath(path);
    const tab = this.tabs.find((row) => row.path === key);
    if (!tab) throw new Error(`No editor tab for ${key}`);
    return tab;
  }
}

function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!trimmed || trimmed === '.' || trimmed.includes('\0')) throw new Error('Invalid editor path');
  return trimmed;
}
