/**
 * Monaco editor pane. Loads the local monaco-editor package when
 * dist/renderer/vs/loader.js was copied. Otherwise the same #monacoEditor
 * host is a textarea with the same tabs, dirty marker, and save policy.
 */
(function () {
  const tree = document.getElementById('editorTree');
  const tabsEl = document.getElementById('editorTabs');
  const host = document.getElementById('monacoEditor');
  const state = document.getElementById('editorState');
  const saveBtn = document.getElementById('editorSave');
  if (!tree || !tabsEl || !host || !window.jewbot || !window.jewbot.editorOpen) return;

  let active = null;
  let surface = null;
  let ghost = '';
  let completeTimer = null;
  let monacoEditor = null;
  let inlineProposal = null;

  function ensureSurface() {
    if (surface) return surface;
    surface = document.createElement('textarea');
    surface.id = 'editorSurface';
    surface.spellcheck = false;
    surface.setAttribute('aria-label', 'Monaco editor');
    host.appendChild(surface);
    surface.addEventListener('input', () => {
      if (!active || !window.jewbot.editorEdit) return;
      window.jewbot.editorEdit({ path: active, text: surface.value }).then(renderTabs).catch(() => {});
      scheduleGhost();
    });
    surface.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' && ghost) {
        event.preventDefault();
        const start = surface.selectionStart;
        const next = surface.value.slice(0, start) + ghost + surface.value.slice(start);
        ghost = '';
        surface.value = next;
        window.jewbot.editorEdit({ path: active, text: next }).then(renderTabs).catch(() => {});
      } else if (event.key === 'Escape' && ghost) {
        event.preventDefault();
        ghost = '';
        if (state) state.textContent = 'Monaco';
      }
    });
    mountMonaco();
    return surface;
  }

  function mountMonaco() {
    const loader = document.createElement('script');
    loader.src = './vs/loader.js';
    loader.onerror = () => {};
    loader.onload = () => {
      const req = window.require;
      if (!req) return;
      window.MonacoEnvironment = {
        getWorker: function () {
          const url = URL.createObjectURL(new Blob(['self.onmessage=function(){}'], { type: 'text/javascript' }));
          return new Worker(url);
        },
      };
      req.config({ paths: { vs: './vs' } });
      req(['vs/editor/editor.main'], function () {
        if (!window.monaco || !window.monaco.editor) return;
        const value = surface ? surface.value : '';
        if (surface) surface.remove();
        const editor = window.monaco.editor.create(host, {
          value: value,
          language: 'plaintext',
          theme: 'vs-dark',
          automaticLayout: true,
          fontSize: 13,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
        });
        monacoEditor = editor;
        surface = {
          get value() { return editor.getValue(); },
          set value(next) { editor.setValue(next); },
          get selectionStart() {
            const pos = editor.getPosition();
            return pos ? editor.getModel().getOffsetAt(pos) : editor.getValue().length;
          },
          get selectionEnd() {
            const sel = editor.getSelection();
            return sel ? editor.getModel().getOffsetAt(sel.getEndPosition()) : editor.getValue().length;
          },
        };
        editor.onDidChangeModelContent(() => {
          if (!active || !window.jewbot.editorEdit) return;
          window.jewbot.editorEdit({ path: active, text: editor.getValue() }).then(renderTabs).catch(() => {});
        });
        if (state) state.textContent = 'Monaco';
      });
    };
    document.body.appendChild(loader);
  }

  function renderTabs(info) {
    if (!info) return;
    tabsEl.innerHTML = '';
    const labels = info.labels || [];
    for (const label of labels) {
      const path = String(label).replace(/ •$/, '');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'editor-tab' + (label.endsWith(' •') ? ' dirty' : '') + (path === info.active ? ' active' : '');
      button.textContent = label;
      button.addEventListener('click', () => openPath(path));
      tabsEl.appendChild(button);
    }
    if (state) state.textContent = info.origin === 'agent' ? 'Monaco · review' : 'Monaco';
  }

  function publishBuffer() {
    window.__jewbotEditor = { path: active, text: surface ? surface.value : '' };
  }

  async function openPath(rel) {
    const info = await window.jewbot.editorOpen(rel);
    active = info.active;
    ensureSurface().value = info.text || '';
    renderTabs(info);
  }

  async function refreshTree() {
    if (!window.jewbot.editorList) return;
    const entries = await window.jewbot.editorList('.');
    tree.textContent = '';
    for (const name of entries) {
      if (String(name).endsWith('/')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = name;
      button.style.margin = '0 6px 6px 0';
      button.addEventListener('click', () => openPath(name));
      tree.appendChild(button);
    }
  }

  function scheduleGhost() {
    if (!window.jewbot.editorComplete || !surface) return;
    clearTimeout(completeTimer);
    const prefix = surface.value.slice(0, surface.selectionStart || surface.value.length);
    const suffix = surface.value.slice(surface.selectionStart || surface.value.length);
    completeTimer = setTimeout(() => {
      window.jewbot.editorComplete({ prefix, suffix }).then((result) => {
        ghost = result && !result.disabled ? result.ghost : '';
        if (state) state.textContent = result && result.disabled ? 'Monaco · completions off' : ghost ? 'Monaco · Tab to accept' : 'Monaco';
      }).catch(() => {});
    }, 250);
  }

  async function saveActive() {
    if (!active || !window.jewbot.editorSave) return;
    const outcome = await window.jewbot.editorSave(active);
    if (outcome && outcome.kind === 'review' && window.jewbot.editorAccept) {
      const accept = window.confirm('Accept the agent edit to ' + outcome.path + '?');
      if (accept) await window.jewbot.editorAccept(outcome.path);
    }
    const info = await window.jewbot.editorOpen(active);
    ensureSurface().value = info.text || '';
    renderTabs(info);
  }

  function selectedText() {
    if (monacoEditor && monacoEditor.getModel && monacoEditor.getSelection) {
      return monacoEditor.getModel().getValueInRange(monacoEditor.getSelection());
    }
    const el = document.getElementById('editorSurface');
    if (!el || el.selectionStart == null) return '';
    return el.value.slice(el.selectionStart, el.selectionEnd);
  }

  async function inlineEdit() {
    if (!active || !window.jewbot.editorInline) return;
    const selection = selectedText();
    if (!selection) return;
    const prompt = window.prompt('Inline edit', '');
    if (!prompt) return;
    const proposal = await window.jewbot.editorInline({
      path: active,
      fileText: surface.value,
      selection: selection,
      prompt: prompt,
    });
    inlineProposal = proposal;
    const box = document.getElementById('inlineEdit');
    const diff = document.getElementById('inlineDiff');
    if (diff) diff.textContent = proposal.unifiedDiff;
    if (box) box.hidden = false;
  }

  const inlineAccept = document.getElementById('inlineAccept');
  const inlineReject = document.getElementById('inlineReject');
  if (inlineAccept) {
    inlineAccept.addEventListener('click', () => {
      if (!inlineProposal || !window.jewbot.editorInlineAccept) return;
      window.jewbot.editorInlineAccept(inlineProposal).then((info) => {
        if (surface) surface.value = inlineProposal.proposed;
        inlineProposal = null;
        const box = document.getElementById('inlineEdit');
        if (box) box.hidden = true;
        renderTabs(info);
      }).catch(() => {});
    });
  }
  if (inlineReject) {
    inlineReject.addEventListener('click', () => {
      inlineProposal = null;
      const box = document.getElementById('inlineEdit');
      if (box) box.hidden = true;
    });
  }

  if (saveBtn) saveBtn.addEventListener('click', () => saveActive().catch(() => {}));
  function editorFocused() {
    const el = document.activeElement;
    if (el && host.contains(el)) return true;
    if (monacoEditor && monacoEditor.hasTextFocus && monacoEditor.hasTextFocus()) return true;
    return false;
  }

  document.addEventListener('keydown', (event) => {
    if (!editorFocused()) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveActive().catch(() => {});
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      inlineEdit().catch((err) => {
        if (state) state.textContent = err instanceof Error ? err.message : String(err);
      });
    }
  });
  refreshTree().catch(() => {});
})();
