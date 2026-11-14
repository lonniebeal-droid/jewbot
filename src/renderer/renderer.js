/* global jewbot */
const transcript = document.getElementById('transcript');
const goalEl = document.getElementById('goal');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const phaseEl = document.getElementById('phase');
const hintEl = document.getElementById('hint');
const termOut = document.getElementById('termOut');
const termCommand = document.getElementById('termCommand');
const termRun = document.getElementById('termRun');
const termKill = document.getElementById('termKill');
const termState = document.getElementById('termState');
const sshOut = document.getElementById('sshOut');
const sshCommand = document.getElementById('sshCommand');
const sshRun = document.getElementById('sshRun');
const sshKill = document.getElementById('sshKill');
const sshConnectBtn = document.getElementById('sshConnect');
const sshDisconnectBtn = document.getElementById('sshDisconnect');
const sshState = document.getElementById('sshState');
const sshHostSelect = document.getElementById('sshHost');

let mode = 'agent';
let chatHistory = [];
let activeRequest = null;
let assistantBody = null;
let lastAssistantBody = null;
let assistantText = '';
let pendingTool = null;
let activeTermSession = null;
let termSawChunk = false;
let confirmChain = Promise.resolve();
let capturingTerm = false;
let earlyTermEvents = [];
let activeSshSession = null;
let activeSshExec = null;
let sshSawChunk = false;
let capturingSsh = false;
let earlySshEvents = [];
let sshUiChain = Promise.resolve();
let cascadeRunState = 'idle';

function rid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function syncStopButton() {
  stopBtn.disabled = !activeRequest && cascadeRunState === 'idle';
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  goalEl.disabled = busy;
  document.getElementById('modeAgent').disabled = busy;
  document.getElementById('modeChat').disabled = busy;
  document.getElementById('openProject').disabled = busy;
  syncStopButton();
}

function scrollDown() {
  transcript.scrollTop = transcript.scrollHeight;
}

function addMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = role === 'user' ? 'You' : role === 'error' ? 'Error' : 'Jewbot';
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = text;
  wrap.appendChild(who);
  wrap.appendChild(body);
  transcript.appendChild(wrap);
  scrollDown();
  return body;
}

function addToolCard(name, args) {
  const wrap = document.createElement('div');
  wrap.className = 'tool' + (name === 'run_terminal' || name === 'ssh_exec' ? ' tool-terminal' : '');
  const title = document.createElement('div');
  title.className = 'tool-name';
  title.textContent = name;
  const pre = document.createElement('pre');
  pre.dataset.args = JSON.stringify(args ?? {}, null, 2);
  pre.textContent = pre.dataset.args;
  wrap.appendChild(title);
  wrap.appendChild(pre);
  transcript.appendChild(wrap);
  scrollDown();
  return pre;
}

function beginAssistant() {
  assistantText = '';
  assistantBody = addMessage('assistant', '');
  lastAssistantBody = assistantBody;
  pendingTool = null;
}

function appendToken(text) {
  if (!assistantBody) beginAssistant();
  assistantText += text;
  assistantBody.textContent = assistantText;
  scrollDown();
}

function closeAssistant() {
  assistantBody = null;
}

function setTermState(text) {
  termState.textContent = text;
}

function appendTerm(text, kind) {
  if (termOut.dataset.empty === '1') {
    termOut.textContent = '';
    termOut.dataset.empty = '0';
  }
  const span = document.createElement('span');
  span.className = kind || 'stdout';
  span.textContent = text;
  termOut.appendChild(span);
  termOut.scrollTop = termOut.scrollHeight;
}

function askConfirm(command, reason, category) {
  const run = () =>
    new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      const title = document.getElementById('confirmTitle');
      const blurb = document.getElementById('confirmBlurb');
      const yes = document.getElementById('confirmYes');
      const secret = category === 'secret_path';
      const releaseDone = category === 'music_release_done';
      title.textContent = secret ? 'Open secret file?' : releaseDone ? 'Mark release done?' : 'Confirm destructive command';
      yes.textContent = secret ? 'Open' : releaseDone ? 'Mark done' : 'Run anyway';
      yes.className = secret || releaseDone ? '' : 'danger';
      blurb.textContent = secret
        ? 'Jewbot will not read this secret unless you open it. Cancel leaves it unread.'
        : releaseDone
          ? 'This only records completion after your distributor/store steps. It does not upload, log in, or pay. Cancel leaves the release unchanged.'
          : 'Jewbot will not run this unless you confirm. Cancel leaves it unrun.';
      document.getElementById('confirmCategory').textContent = category || 'destructive';
      document.getElementById('confirmReason').textContent =
        reason || (secret ? 'This path is secret.' : releaseDone ? 'Marking a release done only records completion.' : 'This command is destructive.');
      document.getElementById('confirmCommand').textContent = command || '';
      modal.hidden = false;
      const no = document.getElementById('confirmNo');
      const finish = (ok) => {
        modal.hidden = true;
        title.textContent = 'Confirm destructive command';
        yes.textContent = 'Run anyway';
        yes.className = 'danger';
        blurb.textContent = 'Jewbot will not run this unless you confirm. Cancel leaves it unrun.';
        yes.onclick = null;
        no.onclick = null;
        document.removeEventListener('keydown', onKey);
        resolve(ok);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      };
      yes.onclick = () => finish(true);
      no.onclick = () => finish(false);
      document.addEventListener('keydown', onKey);
      no.focus();
    });
  const next = confirmChain.then(run, run);
  confirmChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function fillAbout(s) {
  const version = (s && s.version) || '0.1.0';
  const milestone = (s && s.milestone) || 'M7';
  document.getElementById('version').textContent = 'v' + version;
  document.getElementById('milestone').textContent = milestone;
  const lines = [
    'Jewbot ' + version,
    'Milestone ' + milestone,
    'Electron ' + ((s && s.electron) || 'unknown'),
    'Platform: ' + ((s && s.platform) || 'unknown') + ' ' + ((s && s.arch) || ''),
    'Code signing: ' + ((s && s.signing) || 'off') + ' (unsigned)',
    'Notarization: ' + ((s && s.notarization) || 'off'),
    'Signing and notarization cost money and stay an owner decision.',
    s && s.allowPaidApis ? 'Spend: paid APIs enabled' : 'Spend: $0 · local Ollama only',
  ];
  document.getElementById('aboutBody').textContent = lines.join('\n');
}

function openAbout() {
  document.getElementById('aboutModal').hidden = false;
  document.getElementById('aboutClose').focus();
}

function closeAbout() {
  document.getElementById('aboutModal').hidden = true;
}

async function refresh() {
  const statusEl = document.getElementById('status');
  try {
    const s = await window.jewbot.status();
    fillAbout(s);
    const root = s.projectRoot || '';
    const rootEl = document.getElementById('projectRoot');
    rootEl.textContent = root;
    rootEl.title = root;
    const model = (s.ollama && s.ollama.model) || '';
    const host = (s.ollama && s.ollama.host) || '';
    document.getElementById('spend').textContent = s.allowPaidApis ? 'Paid APIs enabled' : '$0 · local Ollama only';
    const lines = [
      'Version: ' + ((s.version) || '0.1.0') + ' · ' + (s.milestone || 'M7') + ' · unsigned',
      s.ollamaOk ? 'Ollama: reachable' : 'Ollama: not reachable',
      'Host: ' + host,
      'Model: ' + model,
      'Models: ' + (s.models && s.models.length ? s.models.join(', ') : '(none)'),
      'Project: ' + root,
      'Spend: ' + (s.spendGate || 'local-only'),
      '',
      'Terminal cwd is this project.',
      'Context index skips secrets, binaries, and gitignored paths.',
      'File edits show a diff and wait for Accept.',
      'Destructive commands wait for confirmation.',
      'SSH hosts: ' + (s.hosts && s.hosts.length ? s.hosts.map((host) => host.name).join(', ') : '(none configured)'),
    ];
    if (s.ollamaError) lines.push('', s.ollamaError);
    if (!s.ollamaOk) {
      lines.push('', 'Start Ollama, then pull a model:', '  ollama serve', '  ollama pull ' + (model || 'qwen2.5-coder:7b'));
    }
    statusEl.textContent = lines.join('\n');
    if (window.jewbot.cascadeList) renderCascade(await window.jewbot.cascadeList());
    await refreshSsh();
    await refreshModules();
  } catch (e) {
    statusEl.textContent = String(e);
  }
}

async function refreshModules() {
  const list = document.getElementById('modulesList');
  const state = document.getElementById('modulesState');
  if (!list || !state || !window.jewbot || !window.jewbot.modulesList) return;
  try {
    const mods = await window.jewbot.modulesList();
    list.textContent = '';
    const rows = mods || [];
    state.textContent = rows.length ? rows.length + ' registered' : 'none';
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = '(no modules)';
      list.appendChild(empty);
      return;
    }
    for (const mod of rows) {
      const li = document.createElement('li');
      li.className = 'modules-item';
      li.dataset.module = mod.id;
      li.dataset.health = mod.health === 'ok' ? 'ok' : 'down';
      li.title = mod.description || '';
      const name = document.createElement('span');
      name.textContent = mod.title + ' (' + mod.id + ')';
      const health = document.createElement('span');
      health.className = mod.health === 'ok' ? 'ok' : 'bad';
      health.textContent = mod.health === 'ok' ? 'ok' : 'down';
      li.appendChild(name);
      li.appendChild(health);
      list.appendChild(li);
    }
  } catch (err) {
    state.textContent = 'down';
    list.textContent = String(err);
  }
}

async function refreshSsh() {
  if (!window.jewbot || !window.jewbot.sshList) return;
  const hostsEl = document.getElementById('sshHosts');
  const sessionsEl = document.getElementById('sshSessions');
  try {
    const info = await window.jewbot.sshList();
    const hosts = (info && info.hosts) || [];
    const previous = sshHostSelect.value;
    sshHostSelect.textContent = '';
    if (!hosts.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(no hosts configured)';
      sshHostSelect.appendChild(opt);
      hostsEl.textContent = info && info.error
        ? info.error
        : 'No hosts configured. Add ~/.jewbot/hosts.json (see README).';
    } else {
      hosts.forEach((host) => {
        const opt = document.createElement('option');
        opt.value = host.name;
        opt.textContent = host.name + ' · ' + host.username + '@' + host.host;
        sshHostSelect.appendChild(opt);
      });
      if (previous) sshHostSelect.value = previous;
      hostsEl.textContent = hosts
        .map((host) => host.name + ' · ' + host.username + '@' + host.host + ':' + host.port + ' · ' + host.auth)
        .join('\n');
    }
    const sessions = (info && info.sessions) || [];
    sessionsEl.textContent = sessions.length
      ? sessions.map((session) => session.name + ' · ' + session.fingerprint).join('\n')
      : '(no sessions)';
  } catch (err) {
    hostsEl.textContent = String(err);
  }
}

function setMode(next) {
  mode = next;
  document.getElementById('modeAgent').classList.toggle('active', mode === 'agent');
  document.getElementById('modeChat').classList.toggle('active', mode === 'chat');
  hintEl.textContent =
    mode === 'agent'
      ? 'Agent can list, search, read, and edit files in this project, and run commands on allowlisted SSH hosts. A compact tree is included; the whole repo is not. Edits show a diff and apply only after Accept. Destructive commands ask first.'
      : 'Chat streams tokens from Ollama with no tools. A compact project snapshot is included; the whole repo is not.';
}

function renderDiff(pre, unified) {
  const lines = String(unified).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const span = document.createElement('span');
    if (line.startsWith('+') && !line.startsWith('+++')) span.className = 'diff-add';
    else if (line.startsWith('-') && !line.startsWith('---')) span.className = 'diff-del';
    else if (line.startsWith('@@')) span.className = 'diff-hunk';
    span.textContent = line + (i === lines.length - 1 ? '' : '\n');
    pre.appendChild(span);
  }
}

function mountDiffCard(ev) {
  const wrap = document.createElement('div');
  wrap.className = 'tool diff-card';
  wrap.dataset.editId = ev.editId || '';

  const title = document.createElement('div');
  title.className = 'tool-name';
  title.textContent = (ev.tool || 'edit') + (ev.created ? ' · new file' : '');
  const pathEl = document.createElement('div');
  pathEl.className = 'diff-path';
  pathEl.textContent = ev.path || '';
  wrap.appendChild(title);
  wrap.appendChild(pathEl);
  if (ev.secret) {
    const banner = document.createElement('div');
    banner.className = 'secret-banner';
    banner.textContent = 'Secret path. Accept writes it. Existing contents stay on this screen and are not sent back to the model.';
    wrap.appendChild(banner);
  }
  const pre = document.createElement('pre');
  pre.className = 'diff-body';
  renderDiff(pre, ev.unifiedDiff || '');
  wrap.appendChild(pre);

  const actions = document.createElement('div');
  actions.className = 'diff-actions';
  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'secondary diff-reject';
  reject.textContent = 'Reject';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'diff-accept';
  accept.textContent = 'Accept';
  actions.appendChild(reject);
  actions.appendChild(accept);
  wrap.appendChild(actions);

  const status = document.createElement('div');
  status.className = 'diff-status';
  status.dataset.diff = '1';
  status.dataset.editId = ev.editId || '';
  status.textContent = 'Waiting for Accept or Reject';
  wrap.appendChild(status);

  if (pendingTool && pendingTool.parentElement && pendingTool.dataset.diff !== '1') {
    pendingTool.parentElement.replaceWith(wrap);
  } else {
    transcript.appendChild(wrap);
  }

  const choose = (accepted) => {
    if (accept.disabled) return;
    accept.disabled = true;
    reject.disabled = true;
    status.textContent = accepted ? 'Accepting…' : 'Rejecting…';
    document.removeEventListener('keydown', onKey);
    if (window.jewbot && ev.editId) window.jewbot.editReply({ editId: ev.editId, accepted: accepted === true });
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !reject.disabled) {
      e.preventDefault();
      choose(false);
    }
  };
  reject.onclick = () => choose(false);
  accept.onclick = () => choose(true);
  document.addEventListener('keydown', onKey);
  wrap.cleanupDiffKey = () => document.removeEventListener('keydown', onKey);
  reject.focus();
  scrollDown();
  return status;
}

function finishDiffCard(statusEl, observation) {
  const obs = observation || '';
  const applied = obs.startsWith('APPLIED');
  const rejected = obs.startsWith('REJECTED');
  statusEl.textContent = applied ? 'Applied' : rejected ? 'Rejected' : obs.startsWith('ERROR') || obs.startsWith('REFUSED') ? 'Not applied' : 'Done';
  statusEl.className = 'diff-status ' + (applied ? 'ok' : 'bad');
  const card = statusEl.closest('.diff-card');
  if (!card) return;
  if (typeof card.cleanupDiffKey === 'function') card.cleanupDiffKey();
  card.querySelectorAll('.diff-accept, .diff-reject').forEach((button) => {
    button.disabled = true;
  });
  if (!applied) return;
  const actions = card.querySelector('.diff-actions');
  if (!actions || card.querySelector('.diff-undo')) return;
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'secondary diff-undo';
  undo.textContent = 'Undo';
  const editId = statusEl.dataset.editId || card.dataset.editId || '';
  undo.onclick = async () => {
    undo.disabled = true;
    try {
      const res = await window.jewbot.editUndo(editId);
      statusEl.textContent = res && res.ok ? 'Undone' : 'Undo failed: ' + ((res && res.reason) || 'unknown');
      statusEl.className = 'diff-status ' + (res && res.ok ? 'ok' : 'bad');
    } catch (err) {
      statusEl.textContent = 'Undo failed: ' + err;
      statusEl.className = 'diff-status bad';
    }
  };
  actions.appendChild(undo);
}

function footerFromObservation(observation) {
  if (!observation) return '';
  const lines = String(observation).split('\n');
  const keep = lines.filter((line) => /^(exit_code|timed_out|truncated|killed|BLOCKED|ERROR):/.test(line) || line.startsWith('BLOCKED:') || line.startsWith('ERROR:'));
  if (keep.length) return keep.join('\n');
  return lines.slice(0, 4).join('\n');
}

function onStreamEvent(ev) {
  if (!activeRequest || ev.requestId !== activeRequest) return;
  if (ev.type === 'token' && ev.text) appendToken(ev.text);
  else if (ev.type === 'message_done') closeAssistant();
  else if (ev.type === 'status') phaseEl.textContent = ev.status || '';
  else if (ev.type === 'tool_call') {
    closeAssistant();
    pendingTool = addToolCard(ev.name || 'tool', ev.args || {});
  } else if (ev.type === 'edit_preview') {
    closeAssistant();
    pendingTool = mountDiffCard(ev);
  } else if ((ev.type === 'terminal_chunk' || ev.type === 'ssh_chunk') && pendingTool) {
    if (pendingTool.dataset.live !== '1') {
      pendingTool.textContent = (pendingTool.dataset.args || '') + '\n\n';
      pendingTool.dataset.live = '1';
    }
    const span = document.createElement('span');
    span.className = ev.stream === 'stderr' ? 'stderr' : 'stdout';
    span.textContent = ev.text || '';
    pendingTool.appendChild(span);
    scrollDown();
  } else if (ev.type === 'confirm_required') {
    const command = ev.command || '';
    const confirmId = ev.confirmId;
    askConfirm(command, ev.reason, ev.category).then((ok) => {
      if (confirmId && window.jewbot) window.jewbot.confirmReply({ confirmId, approved: ok === true });
    });
  } else if (ev.type === 'tool_result' && pendingTool) {
    if (pendingTool.dataset.diff === '1') {
      finishDiffCard(pendingTool, ev.observation || '');
      pendingTool = null;
      scrollDown();
    } else if (pendingTool.dataset.live === '1') {
      const foot = document.createElement('div');
      foot.className = 'term-foot';
      foot.textContent = footerFromObservation(ev.observation);
      pendingTool.appendChild(foot);
    } else {
      const args = pendingTool.dataset.args || '';
      pendingTool.textContent = args + (ev.observation ? '\n\n' + ev.observation : '');
    }
    pendingTool = null;
    scrollDown();
  } else if (ev.type === 'final') {
    const target = assistantBody || lastAssistantBody;
    if (target) target.textContent = ev.text || '';
    else if (ev.text) addMessage('assistant', ev.text);
    assistantText = ev.text || '';
    closeAssistant();
  } else if (ev.type === 'error') {
    if (assistantBody && assistantText === '' && assistantBody.parentElement) {
      assistantBody.parentElement.remove();
    }
    closeAssistant();
    addMessage('error', ev.message || 'Agent error');
  } else if (ev.type === 'done') {
    if (mode === 'chat' && assistantText) {
      chatHistory.push({ role: 'assistant', content: assistantText });
    }
    closeAssistant();
    phaseEl.textContent = ev.status || '';
    activeRequest = null;
    setBusy(false);
    goalEl.focus();
  }
}

function onTerminalEvent(ev) {
  if (capturingTerm) {
    earlyTermEvents.push(ev);
    return;
  }
  applyTerminalEvent(ev);
}

function applyTerminalEvent(ev) {
  if (!ev || ev.sessionId !== activeTermSession) return;
  if (ev.type === 'chunk') {
    termSawChunk = true;
    appendTerm(ev.text || '', ev.stream === 'stderr' ? 'stderr' : 'stdout');
  } else if (ev.type === 'exit') {
    const code = ev.exitCode === null || ev.exitCode === undefined ? 'null' : String(ev.exitCode);
    const bits = ['exit ' + code];
    if (ev.killed) bits.push('killed');
    if (ev.timedOut) bits.push('timed out');
    if (ev.truncated) bits.push('truncated');
    appendTerm('\n[' + bits.join(', ') + ']\n', 'term-meta');
    if (!termSawChunk && ev.stdout) appendTerm(ev.stdout, 'stdout');
    if (!termSawChunk && ev.stderr) appendTerm(ev.stderr, 'stderr');
    activeTermSession = null;
    termSawChunk = false;
    setTermState('idle');
    termRun.disabled = false;
    termKill.disabled = true;
    termCommand.disabled = false;
  }
}

async function runTerminal() {
  const command = termCommand.value.trim();
  if (!command || !window.jewbot) return;
  if (activeTermSession) {
    appendTerm('\n[not run] a command is still running — Kill it first\n', 'term-meta');
    return;
  }
  termRun.disabled = true;
  termCommand.disabled = true;
  let res = await startTerminal(command);
  if (res && !res.ok && res.needsConfirmation) {
    const yes = await askConfirm(command, res.reason, res.category);
    if (!yes) {
      appendTerm('\n[not run] confirmation cancelled\n', 'term-meta');
      termRun.disabled = false;
      termCommand.disabled = false;
      setTermState('idle');
      return;
    }
    const grant = await window.jewbot.terminalConfirm(command);
    if (!grant || !grant.executionId) {
      appendTerm('\n[not run] confirmation was not granted\n', 'term-meta');
      termRun.disabled = false;
      termCommand.disabled = false;
      setTermState('idle');
      return;
    }
    res = await startTerminal(command, grant.executionId);
  }
  if (!res || !res.started) {
    appendTerm('\n[not run] ' + ((res && res.reason) || 'blocked') + '\n', 'term-meta');
    termRun.disabled = false;
    termCommand.disabled = false;
    setTermState('idle');
  }
}

async function startTerminal(command, executionId) {
  earlyTermEvents = [];
  capturingTerm = true;
  try {
    const res = await window.jewbot.terminalStart(executionId ? { command, executionId } : { command });
    if (!res || !res.ok || !res.sessionId) {
      capturingTerm = false;
      earlyTermEvents = [];
      return res;
    }
    activeTermSession = res.sessionId;
    termSawChunk = false;
    appendTerm('$ ' + command + '\n', 'term-meta');
    setTermState('running');
    termKill.disabled = false;
    while (earlyTermEvents.length) applyTerminalEvent(earlyTermEvents.shift());
    capturingTerm = false;
    return res;
  } catch (err) {
    capturingTerm = false;
    earlyTermEvents = [];
    throw err;
  }
}

function setSshState(text) {
  sshState.textContent = text;
}

function appendSsh(text, kind) {
  if (sshOut.dataset.empty === '1') {
    sshOut.textContent = '';
    sshOut.dataset.empty = '0';
  }
  const span = document.createElement('span');
  span.className = kind || 'stdout';
  span.textContent = text;
  sshOut.appendChild(span);
  sshOut.scrollTop = sshOut.scrollHeight;
}

function enqueueSshUi(run) {
  const next = sshUiChain.then(run, run);
  sshUiChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function askSshSecret(ev) {
  return enqueueSshUi(
    () =>
      new Promise((resolve) => {
        const modal = document.getElementById('sshSecretModal');
        const input = document.getElementById('sshSecretInput');
        const title = document.getElementById('sshSecretTitle');
        const blurb = document.getElementById('sshSecretBlurb');
        const passphrase = ev.kind !== 'password';
        title.textContent = passphrase ? 'SSH passphrase' : 'SSH password';
        blurb.textContent =
          (ev.username || 'user') +
          '@' +
          (ev.host || ev.name || 'host') +
          ' — held in memory for this session only. It is not saved and is not sent to the model.';
        input.value = '';
        modal.hidden = false;
        const finish = (secret) => {
          input.value = '';
          modal.hidden = true;
          ok.onclick = null;
          cancel.onclick = null;
          input.onkeydown = null;
          document.removeEventListener('keydown', onKey);
          resolve(secret);
        };
        const ok = document.getElementById('sshSecretOk');
        const cancel = document.getElementById('sshSecretCancel');
        const onKey = (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            finish(null);
          }
        };
        ok.onclick = () => finish(input.value || null);
        cancel.onclick = () => finish(null);
        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(input.value || null);
          }
        };
        document.addEventListener('keydown', onKey);
        input.focus();
      }),
  );
}

function askSshHostKey(ev) {
  return enqueueSshUi(
    () =>
      new Promise((resolve) => {
        const modal = document.getElementById('sshHostModal');
        const dialog = document.getElementById('sshHostDialog');
        const title = document.getElementById('sshHostTitle');
        const reason = document.getElementById('sshHostReason');
        const yes = document.getElementById('sshHostYes');
        const no = document.getElementById('sshHostNo');
        const mismatch = ev.mismatch === true;
        title.textContent = mismatch ? 'Host key changed' : 'Confirm host key';
        reason.textContent = mismatch
          ? 'The fingerprint does not match the key stored for this host. Reject unless you expected the machine to change.'
          : 'First connection. Confirm this fingerprint matches the machine before trusting it.';
        yes.textContent = mismatch ? 'Trust the new key' : 'Trust this key';
        dialog.classList.toggle('mismatch', mismatch);
        document.getElementById('sshHostWhere').textContent =
          (ev.name || '') + ' · ' + (ev.host || '') + ':' + (ev.port || '') + ' · ' + (ev.algorithm || '');
        document.getElementById('sshHostFingerprint').textContent = ev.fingerprint || '';
        modal.hidden = false;
        const finish = (ok) => {
          modal.hidden = true;
          dialog.classList.remove('mismatch');
          yes.onclick = null;
          no.onclick = null;
          document.removeEventListener('keydown', onKey);
          resolve(ok === true);
        };
        const onKey = (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
          }
        };
        yes.onclick = () => finish(true);
        no.onclick = () => finish(false);
        document.addEventListener('keydown', onKey);
        no.focus();
      }),
  );
}

function applySshExecEvent(ev) {
  if (!ev) return;
  if (ev.type === 'chunk') {
    if (activeSshExec && ev.execId && ev.execId !== activeSshExec) return;
    sshSawChunk = true;
    appendSsh(ev.text || '', ev.stream === 'stderr' ? 'stderr' : 'stdout');
    return;
  }
  if (ev.type === 'exit') {
    if (activeSshExec && ev.execId && ev.execId !== activeSshExec) return;
    const code = ev.exitCode === null || ev.exitCode === undefined ? 'null' : String(ev.exitCode);
    const bits = ['exit ' + code];
    if (ev.killed) bits.push('killed');
    if (ev.timedOut) bits.push('timed out');
    if (ev.truncated) bits.push('truncated');
    if (ev.status) bits.push(ev.status);
    appendSsh('\n[' + bits.join(', ') + ']\n', 'term-meta');
    if (!sshSawChunk && ev.stdout) appendSsh(ev.stdout, 'stdout');
    if (!sshSawChunk && ev.stderr) appendSsh(ev.stderr, 'stderr');
    activeSshExec = null;
    sshSawChunk = false;
    if (activeSshSession) setSshState('connected');
    sshRun.disabled = !activeSshSession;
    sshKill.disabled = true;
    sshCommand.disabled = false;
  }
}

function onSshEvent(ev) {
  if (!ev || !ev.type) return;
  if (ev.type === 'secret_required') {
    askSshSecret(ev).then((secret) => {
      if (ev.promptId && window.jewbot) window.jewbot.sshSecretReply({ promptId: ev.promptId, secret: secret });
    });
    return;
  }
  if (ev.type === 'hostkey_required') {
    askSshHostKey(ev).then((ok) => {
      if (ev.confirmId && window.jewbot) window.jewbot.sshHostKeyReply({ confirmId: ev.confirmId, approved: ok === true });
    });
    return;
  }
  if (ev.type === 'connected') {
    activeSshSession = ev.sessionId;
    setSshState('connected');
    sshRun.disabled = false;
    sshDisconnectBtn.disabled = false;
    appendSsh('connected ' + (ev.name || '') + ' ' + (ev.fingerprint || '') + '\n', 'term-meta');
    void refreshSsh();
    return;
  }
  if (ev.type === 'disconnected') {
    if (!activeSshSession || ev.sessionId === activeSshSession) {
      activeSshSession = null;
      activeSshExec = null;
      setSshState('idle');
      sshRun.disabled = true;
      sshKill.disabled = true;
      sshDisconnectBtn.disabled = true;
      sshCommand.disabled = false;
    }
    appendSsh('disconnected ' + (ev.name || '') + '\n', 'term-meta');
    void refreshSsh();
    return;
  }
  if (ev.type === 'chunk' || ev.type === 'exit') {
    if (capturingSsh) {
      earlySshEvents.push(ev);
      return;
    }
    applySshExecEvent(ev);
  }
}

async function connectSsh() {
  const name = sshHostSelect.value;
  if (!name || !window.jewbot || !window.jewbot.sshConnect) return;
  setSshState('connecting');
  sshConnectBtn.disabled = true;
  try {
    const res = await window.jewbot.sshConnect(name);
    if (!res || !res.ok) {
      appendSsh('\n[not connected] ' + ((res && res.reason) || 'failed') + '\n', 'stderr');
      if (!activeSshSession) setSshState('idle');
    }
  } catch (err) {
    appendSsh('\n[not connected] ' + err + '\n', 'stderr');
    if (!activeSshSession) setSshState('idle');
  } finally {
    sshConnectBtn.disabled = false;
  }
}

async function runSsh() {
  const command = sshCommand.value.trim();
  if (!command || !activeSshSession || !window.jewbot) return;
  if (activeSshExec) {
    appendSsh('\n[not run] a command is still running — Kill it first\n', 'term-meta');
    return;
  }
  sshRun.disabled = true;
  sshCommand.disabled = true;
  let res = await startSsh(command);
  if (res && !res.ok && res.needsConfirmation) {
    const yes = await askConfirm(command, res.reason, res.category);
    if (!yes) {
      appendSsh('\n[not run] confirmation cancelled\n', 'term-meta');
      sshRun.disabled = false;
      sshCommand.disabled = false;
      setSshState(activeSshSession ? 'connected' : 'idle');
      return;
    }
    const grant = await window.jewbot.sshConfirm(command);
    if (!grant || !grant.executionId) {
      appendSsh('\n[not run] confirmation was not granted\n', 'term-meta');
      sshRun.disabled = false;
      sshCommand.disabled = false;
      return;
    }
    res = await startSsh(command, grant.executionId);
  }
  if (!res || !res.started) {
    appendSsh('\n[not run] ' + ((res && res.reason) || 'blocked') + '\n', 'term-meta');
    sshRun.disabled = false;
    sshCommand.disabled = false;
    if (activeSshSession) setSshState('connected');
  }
}

async function startSsh(command, executionId) {
  earlySshEvents = [];
  capturingSsh = true;
  try {
    const payload = executionId
      ? { target: activeSshSession, command, executionId }
      : { target: activeSshSession, command };
    const res = await window.jewbot.sshExec(payload);
    if (!res || !res.ok || !res.execId) {
      capturingSsh = false;
      earlySshEvents = [];
      return res;
    }
    activeSshExec = res.execId;
    sshSawChunk = false;
    appendSsh('$ ' + command + '\n', 'term-meta');
    setSshState('running');
    sshKill.disabled = false;
    while (earlySshEvents.length) applySshExecEvent(earlySshEvents.shift());
    capturingSsh = false;
    return res;
  } catch (err) {
    capturingSsh = false;
    earlySshEvents = [];
    throw err;
  }
}

function send() {
  const text = goalEl.value.trim();
  if (!text || activeRequest) return;
  if (!window.jewbot) {
    addMessage('error', 'Preload bridge missing. Launch with npm start.');
    return;
  }
  goalEl.value = '';
  addMessage('user', text);
  beginAssistant();
  const requestId = rid();
  activeRequest = requestId;
  phaseEl.textContent = 'streaming';
  setBusy(true);
  if (mode === 'agent') {
    window.jewbot.startAgent({ requestId, goal: text });
  } else {
    chatHistory.push({ role: 'user', content: text });
    window.jewbot.startChat({ requestId, messages: chatHistory.slice(-20) });
  }
}

document.getElementById('refresh').onclick = refresh;
document.getElementById('send').onclick = send;
document.getElementById('stop').onclick = () => {
  if (activeRequest && window.jewbot) window.jewbot.cancelStream(activeRequest);
  if (window.jewbot && window.jewbot.cascadeStop) void window.jewbot.cascadeStop();
};
document.getElementById('modeAgent').onclick = () => setMode('agent');
document.getElementById('modeChat').onclick = () => setMode('chat');
document.getElementById('openProject').onclick = async () => {
  try {
    const picked = await window.jewbot.pickProjectRoot();
    if (!picked.canceled) await refresh();
  } catch (e) {
    addMessage('error', String(e));
  }
};
document.getElementById('termRun').onclick = () => {
  void runTerminal();
};
document.getElementById('termKill').onclick = () => {
  if (activeTermSession && window.jewbot) void window.jewbot.terminalKill(activeTermSession);
};
sshConnectBtn.onclick = () => {
  void connectSsh();
};
sshDisconnectBtn.onclick = () => {
  if (activeSshSession && window.jewbot) void window.jewbot.sshDisconnect(activeSshSession);
};
sshRun.onclick = () => {
  void runSsh();
};
sshKill.onclick = () => {
  if (activeSshExec && window.jewbot) void window.jewbot.sshKill(activeSshExec);
};
sshCommand.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void runSsh();
  }
});
goalEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
termCommand.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void runTerminal();
  }
});

function renderCascade(snap) {
  const stateEl = document.getElementById('cascadeState');
  const list = document.getElementById('cascadeList');
  if (!stateEl || !list) return;
  const tasks = (snap && snap.tasks) || [];
  cascadeRunState = (snap && snap.runState) || 'idle';
  stateEl.textContent = snap && snap.error ? snap.error : cascadeRunState;
  list.textContent = '';
  if (!tasks.length) {
    const empty = document.createElement('li');
    empty.className = 'muted';
    empty.textContent = 'No tasks yet.';
    list.appendChild(empty);
  }
  tasks.forEach((task) => {
    const li = document.createElement('li');
    li.className = 'cascade-item';
    li.dataset.task = task.title || '';
    li.dataset.status = task.status || '';
    li.dataset.reason = task.reason || '';
    const head = document.createElement('div');
    const status = document.createElement('span');
    status.className = 'st-' + (task.status || 'pending');
    status.textContent = task.status || 'pending';
    head.appendChild(document.createTextNode((task.title || 'Untitled') + ' — '));
    head.appendChild(status);
    li.appendChild(head);
    if (task.reason) {
      const reason = document.createElement('div');
      reason.className = 'reason';
      reason.textContent = task.reason;
      li.appendChild(reason);
    }
    if (task.status === 'blocked' || task.status === 'failed') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'secondary';
      retry.textContent = 'Requeue';
      retry.onclick = () => {
        if (window.jewbot) void window.jewbot.cascadeRequeue(task.id);
      };
      li.appendChild(retry);
    }
    if (task.status !== 'running') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.style.marginLeft = '6px';
      remove.onclick = () => {
        if (window.jewbot) void window.jewbot.cascadeRemove(task.id);
      };
      li.appendChild(remove);
    }
    list.appendChild(li);
  });
  syncStopButton();
}

async function addCascadeTask() {
  const title = document.getElementById('cascadeTitle').value.trim();
  const prompt = document.getElementById('cascadePrompt').value.trim();
  const acceptance = document.getElementById('cascadeAccept').value.trim();
  if (!title || !prompt) {
    document.getElementById('cascadeState').textContent = 'Title and prompt are required';
    return;
  }
  try {
    const res = await window.jewbot.cascadeAdd({ title, prompt, acceptance: acceptance || undefined });
    if (!res || !res.ok) {
      document.getElementById('cascadeState').textContent = (res && res.reason) || 'Could not add task';
      return;
    }
    document.getElementById('cascadeTitle').value = '';
    document.getElementById('cascadePrompt').value = '';
    document.getElementById('cascadeAccept').value = '';
  } catch (err) {
    document.getElementById('cascadeState').textContent = String(err);
  }
}

if (window.jewbot && window.jewbot.onStreamEvent) {
  window.jewbot.onStreamEvent(onStreamEvent);
  if (window.jewbot.onTerminalEvent) window.jewbot.onTerminalEvent(onTerminalEvent);
  if (window.jewbot.onSshEvent) window.jewbot.onSshEvent(onSshEvent);
  if (window.jewbot.onCascadeEvent) window.jewbot.onCascadeEvent(renderCascade);
  document.getElementById('cascadeStart').onclick = () => {
    void window.jewbot.cascadeStart();
  };
  document.getElementById('cascadePause').onclick = () => {
    void window.jewbot.cascadePause();
  };
  document.getElementById('cascadeStop').onclick = () => {
    void window.jewbot.cascadeStop();
  };
  document.getElementById('cascadeAdd').onclick = () => {
    void addCascadeTask();
  };
  document.getElementById('aboutOpen').onclick = () => openAbout();
  document.getElementById('aboutClose').onclick = () => closeAbout();
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById('aboutModal').hidden === false) {
      closeAbout();
    }
  });
  refresh();
} else {
  document.getElementById('status').textContent = 'Open this UI from the Electron app (npm start).';
}
