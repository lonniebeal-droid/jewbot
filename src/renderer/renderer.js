/* global jewbot */
async function refresh() {
  try {
    const s = await window.jewbot.status();
    document.getElementById('milestone').textContent = s.milestone || 'M0';
    document.getElementById('status').textContent = JSON.stringify(s, null, 2);
    document.getElementById('out').textContent = 'Ready.';
  } catch (e) {
    document.getElementById('out').textContent = String(e);
  }
}

document.getElementById('refresh').onclick = refresh;
document.getElementById('run').onclick = async () => {
  const goal = document.getElementById('goal').value || 'Summarize this project structure.';
  document.getElementById('out').textContent = 'Running…';
  try {
    const result = await window.jewbot.agentRun(goal);
    document.getElementById('out').textContent = JSON.stringify(result, null, 2);
  } catch (e) {
    document.getElementById('out').textContent = String(e);
  }
};

refresh();
