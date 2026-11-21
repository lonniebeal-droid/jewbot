/**
 * Model manager. Delete asks in the window before the confirm grant is minted.
 */
(function () {
  const out = document.getElementById('modelsOut');
  function host() {
    return (document.getElementById('modelsHost').value || 'http://127.0.0.1:11434').trim();
  }
  function write(text) {
    if (out) out.textContent = text;
  }
  document.getElementById('modelsList').onclick = async () => {
    const res = await window.jewbot.modelsList(host());
    write(res.error || (res.models || []).join('\n') || '(no models)');
  };
  document.getElementById('modelsPull').onclick = async () => {
    const name = document.getElementById('modelsName').value.trim();
    const res = await window.jewbot.modelsPull({ host: host(), name });
    write(res.ok ? `pulled ${name}` : res.error || 'pull failed');
  };
  document.getElementById('modelsDelete').onclick = async () => {
    const name = document.getElementById('modelsName').value.trim();
    if (!window.confirm(`Delete local model ${name} on ${host()}?`)) return;
    const res = await window.jewbot.modelsDelete({ host: host(), name });
    write(res.ok ? `deleted ${name}` : res.error || 'delete was not confirmed');
  };
  document.getElementById('modelsSave').onclick = async () => {
    const res = await window.jewbot.modelsSettings({
      models: {
        chat: document.getElementById('modelChat').value.trim(),
        autocomplete: document.getElementById('modelComplete').value.trim(),
        embeddings: document.getElementById('modelEmbed').value.trim(),
        inlineEdit: document.getElementById('modelInline').value.trim(),
      },
    });
    write(JSON.stringify(res.models || {}));
  };
})();
