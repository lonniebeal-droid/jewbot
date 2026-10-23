/* global jewbot */
const transcript = document.getElementById('transcript');
const goalEl = document.getElementById('goal');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const phaseEl = document.getElementById('phase');
const hintEl = document.getElementById('hint');

let mode = 'agent';
let chatHistory = [];
let activeRequest = null;
let assistantBody = null;
let lastAssistantBody = null;
let assistantText = '';
let pendingTool = null;

function rid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  goalEl.disabled = busy;
  stopBtn.disabled = !busy;
  document.getElementById('modeAgent').disabled = busy;
  document.getElementById('modeChat').disabled = busy;
  document.getElementById('openProject').disabled = busy;
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
  wrap.className = 'tool';
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

async function refresh() {
  const statusEl = document.getElementById('status');
  try {
    const s = await window.jewbot.status();
    document.getElementById('milestone').textContent = s.milestone || 'M1';
    const root = s.projectRoot || '';
    const rootEl = document.getElementById('projectRoot');
    rootEl.textContent = root;
    rootEl.title = root;
    const model = (s.ollama && s.ollama.model) || '';
    const host = (s.ollama && s.ollama.host) || '';
    document.getElementById('spend').textContent = s.allowPaidApis
      ? 'Paid APIs enabled'
      : '$0 · local Ollama only';
    const lines = [
      s.ollamaOk ? 'Ollama: reachable' : 'Ollama: not reachable',
      'Host: ' + host,
      'Model: ' + model,
      'Models: ' + ((s.models && s.models.length) ? s.models.join(', ') : '(none)'),
      'Project: ' + root,
      'Spend: ' + (s.spendGate || 'local-only'),
    ];
    if (s.ollamaError) lines.push('', s.ollamaError);
    if (!s.ollamaOk) {
      lines.push('', 'Start Ollama, then pull a model:', '  ollama serve', '  ollama pull ' + (model || 'qwen2.5-coder:7b'));
    }
    statusEl.textContent = lines.join('\n');
  } catch (e) {
    statusEl.textContent = String(e);
  }
}

function setMode(next) {
  mode = next;
  document.getElementById('modeAgent').classList.toggle('active', mode === 'agent');
  document.getElementById('modeChat').classList.toggle('active', mode === 'chat');
  hintEl.textContent = mode === 'agent'
    ? 'Agent streams tokens, then calls list_dir and read_file inside the open project.'
    : 'Chat streams tokens from Ollama with no tools. History stays in this window.';
}

function onStreamEvent(ev) {
  if (!activeRequest || ev.requestId !== activeRequest) return;
  if (ev.type === 'token' && ev.text) appendToken(ev.text);
  else if (ev.type === 'message_done') closeAssistant();
  else if (ev.type === 'status') phaseEl.textContent = ev.status || '';
  else if (ev.type === 'tool_call') {
    closeAssistant();
    pendingTool = addToolCard(ev.name || 'tool', ev.args || {});
  }   else if (ev.type === 'tool_result' && pendingTool) {
    const args = pendingTool.dataset.args || '';
    pendingTool.textContent = args + (ev.observation ? '\n\n' + ev.observation : '');
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
goalEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

if (window.jewbot && window.jewbot.onStreamEvent) {
  window.jewbot.onStreamEvent(onStreamEvent);
  refresh();
} else {
  document.getElementById('status').textContent = 'Open this UI from the Electron app (npm start).';
}
