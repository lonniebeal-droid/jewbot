/**
 * Monaco pane binding. The real editor is mounted in the renderer when the
 * local monaco-editor package is present. Tests use a fake editor object.
 */

export const MONACO_CONTAINER_ID = 'monacoEditor';

export const MONACO_EDITOR_OPTIONS = {
  theme: 'vs-dark',
  automaticLayout: true,
  fontSize: 13,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on' as const,
};

export interface MonacoLike {
  getValue(): string;
  setValue(value: string): void;
  onDidChangeModelContent(cb: () => void): { dispose(): void };
  dispose(): void;
}

export interface MonacoBinding {
  push(text: string): void;
  dispose(): void;
}

/**
 * Keep the Monaco model aligned with a tab. Programmatic setValue does not
 * count as a human edit. Later keystrokes do.
 */
export function bindMonaco(editor: MonacoLike, initial: string, onHuman: (text: string) => void): MonacoBinding {
  let silent = true;
  editor.setValue(initial);
  const sub = editor.onDidChangeModelContent(() => {
    if (silent) return;
    onHuman(editor.getValue());
  });
  silent = false;
  return {
    push(text: string) {
      if (editor.getValue() === text) return;
      silent = true;
      editor.setValue(text);
      silent = false;
    },
    dispose() {
      sub.dispose();
      editor.dispose();
    },
  };
}
