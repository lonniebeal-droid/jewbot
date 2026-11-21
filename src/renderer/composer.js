/**
 * Composer hunk review. The batch itself lives in the main process.
 */
(function () {
  const list = document.getElementById('composerList');
  const addBtn = document.getElementById('composerAdd');
  if (!list || !window.jewbot || !window.jewbot.composerState) return;

  function render(state) {
    list.textContent = '';
    const files = (state && state.files) || [];
    if (!files.length) {
      list.textContent = 'No batch yet.';
      return;
    }
    for (const file of files) {
      const block = document.createElement('div');
      block.className = 'tool';
      const title = document.createElement('div');
      title.className = 'diff-path';
      title.textContent = file.path;
      block.appendChild(title);
      const fileRow = document.createElement('div');
      fileRow.className = 'row';
      const acceptFile = document.createElement('button');
      acceptFile.type = 'button';
      acceptFile.textContent = 'Accept file';
      acceptFile.addEventListener('click', () => decide({ scope: 'file', path: file.path, decision: 'accept' }));
      const rejectFile = document.createElement('button');
      rejectFile.type = 'button';
      rejectFile.className = 'secondary';
      rejectFile.textContent = 'Reject file';
      rejectFile.addEventListener('click', () => decide({ scope: 'file', path: file.path, decision: 'reject' }));
      fileRow.appendChild(acceptFile);
      fileRow.appendChild(rejectFile);
      block.appendChild(fileRow);
      for (const hunk of file.hunks || []) {
        const row = document.createElement('div');
        row.className = 'composer-hunk';
        const pre = document.createElement('pre');
        pre.textContent = hunk.decision + '\n- ' + hunk.search + '\n+ ' + hunk.replace;
        row.appendChild(pre);
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.textContent = 'Accept hunk';
        accept.addEventListener('click', () => decide({ scope: 'hunk', id: hunk.id, decision: 'accept' }));
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'secondary';
        reject.textContent = 'Reject hunk';
        reject.addEventListener('click', () => decide({ scope: 'hunk', id: hunk.id, decision: 'reject' }));
        row.appendChild(accept);
        row.appendChild(reject);
        block.appendChild(row);
      }
      list.appendChild(block);
    }
  }

  function decide(payload) {
    window.jewbot.composerDecide(payload).then(render).catch(() => {});
  }

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const buffer = window.__jewbotEditor || {};
      const path = buffer.path || '';
      const proposed = buffer.text || '';
      if (!path) return;
      window.jewbot.composerAdd({ path, proposed }).then(render).catch(() => {});
    });
  }
  const applyBtn = document.getElementById('composerApply');
  if (applyBtn) applyBtn.addEventListener('click', () => window.jewbot.composerApply().then(render).catch(() => {}));
  const undoBtn = document.getElementById('composerUndo');
  if (undoBtn) undoBtn.addEventListener('click', () => window.jewbot.composerUndo().then(render).catch(() => {}));
  window.jewbot.composerState().then(render).catch(() => {});
})();
