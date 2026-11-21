/**
 * M9 editor. Tabs, dirty markers, and save policy live here.
 * The window mounts Monaco on #monacoEditor.
 */

import type { JewbotModule } from '../plugin/types';

export { completeInline, createCompletionController } from './complete';
export type { CompletionController, GhostState } from './complete';
export { bindMonaco, MONACO_CONTAINER_ID, MONACO_EDITOR_OPTIONS } from './monaco';
export type { MonacoBinding, MonacoLike } from './monaco';
export { EditorSession, tabLabel } from './session';
export type { BufferOrigin, EditorTab, SaveOutcome } from './session';

export const jewbotModule: JewbotModule = {
  id: 'editor',
  title: 'Editor',
  description:
    'Monaco editor pane with file tabs. Human saves write immediately. Agent edits stay on the M3 diff until Accept.',
  version: '0.2.0',
  capabilities: ['edit', 'local-only'],
  tools: [
    { name: 'editor_open', description: 'Open a project file in a Monaco tab. Does not write.' },
    { name: 'editor_save', description: 'Save the active tab. Human typing writes. Agent text returns a diff for Accept.' },
  ],
  health() {
    return { ok: true, detail: 'monaco pane ready' };
  },
};
