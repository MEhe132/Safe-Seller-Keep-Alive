const DEFAULT_URLS = [
  'https://www.g2g.com/offers/list',
  'https://www.u7buy.com/member/chat'
];

let cachedState = {
  isRunning: false,
  nextRunTime: null
};

let recoveryInFlight = false;

function getFormValues() {
  const urlsText = document.getElementById('urlsInput').value;
  const urls = urlsText
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean);

  const minSec = Math.max(60, parseInt(document.getElementById('minSecInput').value, 10) || 600);
  const maxSec = Math.max(minSec, parseInt(document.getElementById('maxSecInput').value, 10) || 1000);
  const maxHours = Math.max(0, parseFloat(document.getElementById('maxHoursInput').value) || 0);
  const preventSleep = document.getElementById('preventSleepCheckbox').checked;

  return { urls, minSec, maxSec, maxHours, preventSleep };
}

function updateSleepBarUI(isRunning, preventSleep) {
  const sleepBar = document.getElementById('sleepBar');
  const pill = document.getElementById('sleepStatusPill');

  if (isRunning && preventSleep) {
    sleepBar.className = 'sleep-bar awake-active';
    pill.className = 'sleep-status-pill active';
    pill.textContent = 'NO-SLEEP ON';
  } else if (!preventSleep) {
    sleepBar.className = 'sleep-bar';
    pill.className = 'sleep-status-pill';
    pill.textContent = 'DISABLED';
  } else {
    sleepBar.className = 'sleep-bar';
    pill.className = 'sleep-status-pill';
    pill.textContent = 'STANDBY';
  }
}

function renderLogs(logs = []) {
  const logBox = document.getElementById('logBox');
  logBox.textContent = '';

  if (logs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'log-entry';
    empty.textContent = 'No activity yet. Click "⚡ Test 1 Refresh Now" or "▶ Start Auto".';
    logBox.appendChild(empty);
    return;
  }

  for (const item of logs) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = item;
    logBox.appendChild(div);
  }
}

async function updateCountdownDisplay() {
  const countdownEl = document.getElementById('countdownText');
  if (!cachedState.isRunning || !cachedState.nextRunTime) {
    countdownEl.textContent = 'Not scheduled';
    return;
  }

  const remainingMs = cachedState.nextRunTime - Date.now();

  // If the laptop was shut down and turned back on, remainingMs will be <= 0.
  // Automatically trigger recovery so it schedules a fresh countdown instead of sticking at 0s!
  if (remainingMs <= -1500 && !recoveryInFlight) {
    recoveryInFlight = true;
    countdownEl.textContent = 'Resuming...';
    try {
      await chrome.runtime.sendMessage({ type: 'ENSURE_HEALTHY' });
      await refreshUIFromStorage(false);
    } catch {
      // Ignore if SW is still waking
    } finally {
      recoveryInFlight = false;
    }
    return;
  }

  const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  countdownEl.textContent = mins > 0 ? `${mins}m ${secs}s (${remainingSec}s)` : `${remainingSec}s`;
}

async function refreshUIFromStorage(populateInputs = false) {
  try {
    const data = await chrome.storage.local.get({
      isRunning: false,
      minSec: 600,
      maxSec: 1000,
      maxHours: 8,
      preventSleep: true,
      urls: DEFAULT_URLS,
      nextRunTime: null,
      refreshCount: 0,
      pauseReason: '',
      logs: []
    });

    if (data.minSec < 60) {
      data.minSec = 600;
      data.maxSec = 1000;
      await chrome.storage.local.set({ minSec: 600, maxSec: 1000 });
    }

    cachedState.isRunning = data.isRunning;
    cachedState.nextRunTime = data.nextRunTime;

    if (populateInputs) {
      document.getElementById('urlsInput').value = (data.urls || DEFAULT_URLS).join('\n');
      document.getElementById('minSecInput').value = data.minSec;
      document.getElementById('maxSecInput').value = data.maxSec;
      document.getElementById('maxHoursInput').value = data.maxHours;
      document.getElementById('preventSleepCheckbox').checked = Boolean(data.preventSleep);
    }

    updateSleepBarUI(data.isRunning, document.getElementById('preventSleepCheckbox').checked);

    const badge = document.getElementById('stateBadge');
    const btnToggle = document.getElementById('btnToggle');
    const warningBanner = document.getElementById('warningBanner');

    if (data.pauseReason) {
      warningBanner.style.display = 'block';
      warningBanner.textContent = `⚠️ ${data.pauseReason}`;
      badge.textContent = 'AUTO-PAUSED';
      badge.className = 'badge paused';
    } else {
      warningBanner.style.display = 'none';
      if (data.isRunning) {
        badge.textContent = 'RUNNING';
        badge.className = 'badge running';
      } else {
        badge.textContent = 'STOPPED';
        badge.className = 'badge';
      }
    }

    if (data.isRunning) {
      btnToggle.textContent = '⏹ Stop Auto';
      btnToggle.className = 'primary btn-stop';
    } else {
      btnToggle.textContent = '▶ Start Auto';
      btnToggle.className = 'primary btn-start';
    }

    document.getElementById('cycleCount').textContent = String(data.refreshCount || 0);
    await updateCountdownDisplay();
    renderLogs(data.logs || []);
  } catch (err) {
    console.error('Failed to load UI state:', err);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Check if timer needs recovery after laptop restart
  try {
    await chrome.runtime.sendMessage({ type: 'ENSURE_HEALTHY' });
  } catch {
    // Ignore
  }

  await refreshUIFromStorage(true);

  setInterval(() => {
    updateCountdownDisplay();
  }, 1000);

  chrome.storage.onChanged.addListener(async () => {
    await refreshUIFromStorage(false);
  });

  document.getElementById('preventSleepCheckbox').addEventListener('change', async (e) => {
    const preventSleep = e.target.checked;
    await chrome.runtime.sendMessage({
      type: 'TOGGLE_SLEEP_LOCK',
      payload: { preventSleep }
    });
    await refreshUIFromStorage(false);
  });

  document.getElementById('btnToggle').addEventListener('click', async () => {
    const payload = getFormValues();
    if (cachedState.isRunning) {
      await chrome.runtime.sendMessage({ type: 'STOP' });
    } else {
      // Directly reset counter in storage from popup.js as well so it ALWAYS starts at 0
      await chrome.storage.local.set({ refreshCount: 0 });
      document.getElementById('cycleCount').textContent = '0';
      await chrome.runtime.sendMessage({ type: 'START', payload });
    }
    await refreshUIFromStorage(false);
  });

  document.getElementById('btnResetCount').addEventListener('click', async () => {
    await chrome.storage.local.set({ refreshCount: 0 });
    document.getElementById('cycleCount').textContent = '0';
  });

  document.getElementById('btnTestNow').addEventListener('click', async () => {
    const payload = getFormValues();
    await chrome.runtime.sendMessage({ type: 'TEST_NOW', payload });
    await refreshUIFromStorage(false);
  });

  document.getElementById('btnClearLogs').addEventListener('click', async () => {
    await chrome.storage.local.set({ logs: [], refreshCount: 0 });
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
    await refreshUIFromStorage(false);
  });
});
