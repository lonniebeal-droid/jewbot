/**
 * Git sidebar. Push, reset, and clean ask the owner, then use the confirm grant.
 * Nothing here pushes on its own.
 */
(function () {
  const out = document.getElementById('gitOut');
  if (!out || !window.jewbot || !window.jewbot.gitRun) return;

  function pathArg() {
    const value = (document.getElementById('gitPath') || {}).value || '';
    return value.trim() ? [value.trim()] : [];
  }

  function show(result) {
    if (!result) return;
    if (result.needsConfirmation) {
      out.textContent = 'Waiting for confirmation. Nothing ran.\n' + (result.command || '');
      return;
    }
    out.textContent = (result.stdout || '') + (result.stderr || '') + (result.reason || '');
  }

  function run(action, args) {
    window.jewbot.gitRun({ action: action, args: args || [] }).then(show).catch((err) => {
      out.textContent = err instanceof Error ? err.message : String(err);
    });
  }

  function guarded(action, args) {
    const command = 'git ' + action + (args && args.length ? ' ' + args.join(' ') : '');
    if (!window.confirm('This git command needs confirmation and will not run until you accept:\n' + command)) {
      out.textContent = 'Cancelled. Nothing ran.';
      return;
    }
    window.jewbot.gitConfirm({ action: action, args: args || [] }).then(show).catch((err) => {
      out.textContent = err instanceof Error ? err.message : String(err);
    });
  }

  document.getElementById('gitRefresh').addEventListener('click', () => run('status'));
  document.getElementById('gitDiff').addEventListener('click', () => run('diff', pathArg()));
  document.getElementById('gitStage').addEventListener('click', () => run('stage', pathArg()));
  document.getElementById('gitUnstage').addEventListener('click', () => run('unstage', pathArg()));
  document.getElementById('gitSwitch').addEventListener('click', () => {
    const name = (document.getElementById('gitBranch') || {}).value || '';
    if (!name.trim()) return;
    run('switch', [name.trim()]);
  });
  document.getElementById('gitCommit').addEventListener('click', () => {
    const message = (document.getElementById('gitMessage') || {}).value || '';
    if (!message.trim()) return;
    run('commit', [message.trim()]);
  });
  document.getElementById('gitSuggest').addEventListener('click', () => {
    window.jewbot.gitSuggest().then((result) => {
      const input = document.getElementById('gitMessage');
      if (input && result && result.message) input.value = result.message;
      if (result && result.error) out.textContent = result.error;
    }).catch((err) => {
      out.textContent = err instanceof Error ? err.message : String(err);
    });
  });
  document.getElementById('gitPush').addEventListener('click', () => guarded('push', []));
  document.getElementById('gitReset').addEventListener('click', () => guarded('reset', ['--hard']));
  document.getElementById('gitClean').addEventListener('click', () => guarded('clean', ['-fd']));
})();
